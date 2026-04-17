# activate.sh — QA sandbox entry point. MUST be sourced, not executed.
#
# Sets $HOME to a STABLE sandbox directory (/tmp/stask-qa-active by default)
# that persists across shell invocations. First source seeds it from the
# snapshot; subsequent sources are a fast no-op that just re-export env.
# State created mid-session (tasks, DB rows, git state) survives between
# `bash -c` invocations — critical for multi-step AI-agent sessions.
#
# There is NO exit trap. Tear down with `source deactivate.sh` when the
# test session is genuinely over. If you forget, the next `install.sh`
# cleans up Slack artifacts as its first step.
#
# Usage:
#   source test/qa-sandbox/activate.sh           # seeded sandbox (default)
#   source test/qa-sandbox/activate.sh --empty   # empty $HOME for testing `stask setup` itself
#   source test/qa-sandbox/activate.sh --fresh   # nuke any existing sandbox first, then re-seed
#
# After sourcing, $HOME is /tmp/stask-qa-active with a ready-to-test 4-agent team.

# Guard: must be sourced
if [ "${BASH_SOURCE[0]:-}" = "$0" ]; then
  printf '\033[31merror:\033[0m activate.sh must be sourced, not executed\n' >&2
  printf '  source %s\n' "${BASH_SOURCE[0]:-activate.sh}" >&2
  exit 1
fi

_SANDBOX_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_REPO_ROOT="$(cd "$_SANDBOX_DIR/../.." && pwd)"
_EMPTY=0
_FRESH=0
for arg in "$@"; do
  case "$arg" in
    --empty) _EMPTY=1 ;;
    --fresh) _FRESH=1 ;;
  esac
done

# ── Stable HOME path ─────────────────────────────────────────────
# Override with STASK_QA_STABLE_HOME if you need multiple concurrent sandboxes.
_STABLE_HOME="${STASK_QA_STABLE_HOME:-/tmp/stask-qa-active}"

if [ "$_FRESH" = "1" ] && [ -d "$_STABLE_HOME" ]; then
  rm -rf "$_STABLE_HOME"
fi

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
# Only set it if we don't already have it recorded from a prior activate
# in this shell — we want to always restore to the ORIGINAL real home.
if [ -z "${STASK_QA_SANDBOX_REAL_HOME:-}" ]; then
  export STASK_QA_SANDBOX_REAL_HOME="$HOME"
fi

# ── Export gh auth token so gh works after HOME swap ─────────────
# `gh` stores auth under $HOME/.config/gh, which won't exist in the sandbox
# HOME. Export $GH_TOKEN so gh's "no config" fallback kicks in.
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  export GH_TOKEN=$(gh auth token 2>/dev/null)
fi

# ── Deliberately do NOT export STASK_HOME ────────────────────────
# Despite the name, it points at the *project*'s .stask/ (per
# lib/resolve-home.mjs:121), not the home-central one. Setting it would
# break auto-resolution when cwd is inside $HOME/dummy-repo.

# ── Seed or reuse the stable sandbox directory ──────────────────
_SANDBOX_MARKER="$_STABLE_HOME/.stask-qa-sandbox-active"
_ALREADY_ACTIVE=0
if [ -f "$_SANDBOX_MARKER" ]; then _ALREADY_ACTIVE=1; fi

if [ "$_ALREADY_ACTIVE" = "1" ]; then
  export HOME="$_STABLE_HOME"
  export STASK_QA_SANDBOX=1
  printf '\033[32m✓\033[0m sandbox already active at %s (reusing)\n' "$HOME"
elif [ "$_EMPTY" = "1" ]; then
  mkdir -p "$_STABLE_HOME/.openclaw"
  ( cd "$_STABLE_HOME" && mkdir -p dummy-repo && cd dummy-repo && git init -q )
  touch "$_SANDBOX_MARKER"
  export HOME="$_STABLE_HOME"
  export STASK_QA_SANDBOX=1
  printf '\033[32m✓\033[0m empty sandbox at %s (for testing `stask setup`)\n' "$HOME"
else
  mkdir -p "$_STABLE_HOME"
  rsync -a "$_SANDBOX_DIR/seed/home/.openclaw" "$_STABLE_HOME/"
  rsync -a "$_SANDBOX_DIR/seed/home/.stask"    "$_STABLE_HOME/"
  rsync -a "$_SANDBOX_DIR/seed/dummy-repo"     "$_STABLE_HOME/"
  touch "$_SANDBOX_MARKER"
  export HOME="$_STABLE_HOME"
  export STASK_QA_SANDBOX=1
  printf '\033[32m✓\033[0m seeded sandbox at %s\n' "$HOME"
  printf '  %s\n' "cd \$HOME/dummy-repo && stask list"
fi

# ── Wire gh as a git credential helper ───────────────────────────
# Lets `git push` inside the sandbox authenticate via $GH_TOKEN without
# prompting. Idempotent — safe to re-run on every activation.
if [ -n "${GH_TOKEN:-}" ]; then
  gh auth setup-git >/dev/null 2>&1 || true
fi

unset _SANDBOX_DIR _REPO_ROOT _EMPTY _FRESH _STABLE_HOME _SANDBOX_MARKER \
      _ALREADY_ACTIVE _CURRENT_HASH _SEED_HASH arg
