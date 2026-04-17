# activate.sh — QA sandbox entry point. MUST be sourced, not executed.
#
# Creates an ephemeral $HOME, populates it from the seed snapshot, and
# traps `rm -rf` on shell exit so nothing leaks.
#
# Usage:
#   source test/qa-sandbox/activate.sh           # seeded sandbox (default)
#   source test/qa-sandbox/activate.sh --empty   # empty $HOME for testing `stask setup` itself
#
# After sourcing, $HOME is a temp dir containing a ready-to-test 4-agent team.

# Guard: must be sourced
if [ "${BASH_SOURCE[0]:-}" = "$0" ]; then
  printf '\033[31merror:\033[0m activate.sh must be sourced, not executed\n' >&2
  printf '  source %s\n' "${BASH_SOURCE[0]:-activate.sh}" >&2
  exit 1
fi

_SANDBOX_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_REPO_ROOT="$(cd "$_SANDBOX_DIR/../.." && pwd)"
_EMPTY=0
for arg in "$@"; do
  case "$arg" in
    --empty) _EMPTY=1 ;;
  esac
done

# ── Seed freshness check ─────────────────────────────────────────
if [ "$_EMPTY" = "0" ]; then
  if [ ! -d "$_SANDBOX_DIR/seed" ]; then
    printf '\033[31merror:\033[0m no seed found at %s/seed\n' "$_SANDBOX_DIR" >&2
    printf '  run: bash %s/install.sh\n' "$_SANDBOX_DIR" >&2
    return 1
  fi
  _CURRENT_HASH=$( cd "$_REPO_ROOT" \
    && find lib/setup commands/setup.mjs -type f -name '*.mjs' -exec shasum -a 256 {} + \
    | sort | shasum -a 256 | cut -d' ' -f1 )
  _SEED_HASH=$(cat "$_SANDBOX_DIR/SEED_VERSION" 2>/dev/null || echo "")
  if [ "$_CURRENT_HASH" != "$_SEED_HASH" ]; then
    printf '\033[33mwarning:\033[0m lib/setup has changed since install — seed may be stale\n' >&2
    printf '  re-run: bash %s/install.sh\n' "$_SANDBOX_DIR" >&2
  fi
fi

# ── Remember real HOME for cleanup/debugging ─────────────────────
export STASK_QA_SANDBOX_REAL_HOME="$HOME"

# ── Export gh auth token so gh works after HOME swap ─────────────
# `gh` stores auth under $HOME/.config/gh, which won't exist in the scratch
# HOME. Grabbing the token now and exporting $GH_TOKEN lets gh run normally.
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  export GH_TOKEN=$(gh auth token 2>/dev/null)
fi

# ── Create ephemeral HOME ────────────────────────────────────────
# Deliberately do NOT export STASK_HOME — despite the name, it points at the
# *project*'s .stask/ (per lib/resolve-home.mjs:121), not the home-central one.
# Setting it would break auto-resolution when cwd is inside $HOME/dummy-repo.
export HOME=$(mktemp -d /tmp/stask-qa.XXXXXX)
export STASK_QA_SANDBOX=1

if [ "$_EMPTY" = "1" ]; then
  mkdir -p "$HOME/.openclaw"
  ( cd "$HOME" && mkdir -p dummy-repo && cd dummy-repo && git init -q )
  printf '\033[32m✓\033[0m empty sandbox at %s (for testing `stask setup`)\n' "$HOME"
else
  rsync -a "$_SANDBOX_DIR/seed/home/.openclaw" "$HOME/"
  rsync -a "$_SANDBOX_DIR/seed/home/.stask"    "$HOME/"
  rsync -a "$_SANDBOX_DIR/seed/dummy-repo"     "$HOME/"
  printf '\033[32m✓\033[0m seeded sandbox at %s\n' "$HOME"
  printf '  %s\n' "cd \$HOME/dummy-repo && stask list"
fi

# ── Wire gh as a git credential helper ───────────────────────────
# Lets `git push` inside the sandbox authenticate via $GH_TOKEN without
# prompting for a password. Writes to $HOME/.gitconfig which is ephemeral.
if [ -n "${GH_TOKEN:-}" ]; then
  gh auth setup-git >/dev/null 2>&1 || true
fi

# ── Cleanup trap — runs when the shell exits ────────────────────
# Keep the user's real HOME restored even if the trap fires.
_stask_qa_cleanup() {
  if [ -n "${STASK_QA_SANDBOX:-}" ] && [ -d "$HOME" ] && [[ "$HOME" == /tmp/stask-qa.* ]]; then
    rm -rf "$HOME"
  fi
  if [ -n "${STASK_QA_SANDBOX_REAL_HOME:-}" ]; then
    export HOME="$STASK_QA_SANDBOX_REAL_HOME"
    unset STASK_QA_SANDBOX_REAL_HOME
  fi
  unset STASK_QA_SANDBOX GH_TOKEN
}
trap _stask_qa_cleanup EXIT

unset _SANDBOX_DIR _REPO_ROOT _EMPTY _CURRENT_HASH _SEED_HASH arg
