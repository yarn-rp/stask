#!/usr/bin/env bash
# install.sh — one-time install for Helsinki's QA sandbox.
#
# Validates credentials, links the worktree stask binary, and regenerates a
# seed snapshot by running the real `stask setup` wizard against a throwaway
# HOME with dummy credentials. Re-run this whenever lib/setup/*.mjs changes.
#
# Requires:
#   - ~/.stask-qa/credentials.json      (copy credentials.example.json and fill in)
#   - gh auth status passing            (and write access to the dummy repo)
#   - openclaw binary on PATH
#   - npm (to run `npm link`)

set -euo pipefail

SANDBOX_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SANDBOX_DIR/../.." && pwd)"
CREDS="$HOME/.stask-qa/credentials.json"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }
step()  { printf '\033[36m→\033[0m %s\n' "$*"; }

# ── 1. Credentials ──────────────────────────────────────────────
if [ ! -f "$CREDS" ]; then
  red "Missing $CREDS"
  dim  "Copy the template and fill it in:"
  dim  "  mkdir -p ~/.stask-qa"
  dim  "  cp $SANDBOX_DIR/credentials.example.json $CREDS"
  dim  "  chmod 600 $CREDS"
  exit 1
fi
chmod 600 "$CREDS" 2>/dev/null || true

# Basic shape check
node -e "
  const c = require('$CREDS');
  const need = ['github.repo', 'slack.humanUserId', 'slack.apps.professor.botToken', 'slack.apps.professor.appToken', 'slack.apps.berlin.botToken', 'slack.apps.tokyo.botToken', 'slack.apps.helsinki.botToken'];
  const missing = need.filter(p => p.split('.').reduce((o,k) => o && o[k], c) === undefined);
  if (missing.length) { console.error('credentials.json missing:', missing.join(', ')); process.exit(3); }
" || exit 3

REPO=$(node -e "console.log(require('$CREDS').github.repo)")

# ── 2. Tooling ──────────────────────────────────────────────────
command -v gh >/dev/null       || { red "gh CLI required"; exit 1; }
gh auth status >/dev/null 2>&1 || { red "run: gh auth login"; exit 1; }
command -v openclaw >/dev/null || { red "openclaw binary required on PATH"; exit 1; }
command -v npm >/dev/null      || { red "npm required"; exit 1; }

# Confirm gh can see the dummy repo (write access is implied by running setup later)
gh repo view "$REPO" --json name >/dev/null 2>&1 || {
  red "gh cannot view $REPO — check the name in credentials.json and 'gh auth status'"
  exit 1
}

# ── 2b. Clean up artifacts from a prior install (best-effort) ───
# If seed/ exists we previously created a channel + canvas in Slack; archive
# them first so re-runs don't accumulate cruft. Pass --skip-cleanup to bypass
# (e.g. when the credentials already point at a different workspace).
if [ -d "$SANDBOX_DIR/seed" ] && [[ " $* " != *" --skip-cleanup "* ]]; then
  step "Cleaning artifacts from prior install"
  bash "$SANDBOX_DIR/cleanup.sh" 2>&1 | sed 's/^/  /' || dim "  (cleanup reported errors — continuing)"
  echo
fi

# ── 3. Link the worktree stask binary ───────────────────────────
step "Linking stask worktree at $REPO_ROOT"
(cd "$REPO_ROOT" && npm link >/dev/null)

# ── 4. Scratch environment ──────────────────────────────────────
# Fetch gh-dependent values and clone the dummy repo BEFORE swapping HOME —
# `gh` reads its auth from $HOME/.config/gh, which won't exist in the scratch HOME.
GH_LOGIN=$(gh api user --jq '.login')
GH_NAME=$(gh api user --jq '.name // ""')
# Grab the raw token too — `stask setup` re-invokes `gh api user` from within
# the swapped HOME, and `gh` honors $GH_TOKEN when its config dir is missing.
export GH_TOKEN=$(gh auth token)

SCRATCH=$(mktemp -d /tmp/stask-qa-seed.XXXXXX)
trap 'rm -rf "$SCRATCH"' EXIT

step "Cloning $REPO into scratch"
gh repo clone "$REPO" "$SCRATCH/dummy-repo" -- --quiet 2>&1 | sed 's/^/  /' || {
  red "gh repo clone failed — check $REPO exists and you have access"
  exit 1
}

# Now it's safe to switch HOME
export HOME="$SCRATCH"
mkdir -p "$HOME/.openclaw"

# ── 5. Render answers file ──────────────────────────────────────
ANSWERS="$SCRATCH/setup-answers.json"
node "$SANDBOX_DIR/fixtures/render-answers.mjs" \
  "$CREDS" \
  "$SANDBOX_DIR/fixtures/setup-answers.template.json" \
  "$SCRATCH/dummy-repo" \
  "$GH_LOGIN" \
  "$GH_NAME" \
  > "$ANSWERS"

# ── 6. Run stask setup non-interactively ────────────────────────
step "Running stask setup (creates channel/list/canvas in your dummy Slack)"
export STASK_SETUP_ANSWERS="$ANSWERS"
export STASK_SKIP_GATEWAY_RESTART=1
export STASK_SKIP_SKILLS_INSTALL=1

(cd "$SCRATCH/dummy-repo" && stask setup "$SCRATCH/dummy-repo") || {
  red "stask setup failed — scratch kept at $SCRATCH for inspection"
  trap - EXIT
  exit 1
}

# ── 7. Snapshot seed ────────────────────────────────────────────
step "Snapshotting seed"
rm -rf "$SANDBOX_DIR/seed"
mkdir -p "$SANDBOX_DIR/seed/home"
rsync -a "$SCRATCH/.openclaw" "$SANDBOX_DIR/seed/home/"
rsync -a "$SCRATCH/.stask"    "$SANDBOX_DIR/seed/home/"
rsync -a "$SCRATCH/dummy-repo" "$SANDBOX_DIR/seed/"

# Version hash — activate.sh warns if stask/lib/setup changed since install
( cd "$REPO_ROOT" && find lib/setup commands/setup.mjs -type f -name '*.mjs' -exec shasum -a 256 {} + \
    | sort | shasum -a 256 | cut -d' ' -f1 ) > "$SANDBOX_DIR/SEED_VERSION"

green "✓ Seed installed at $SANDBOX_DIR/seed"
echo
echo "Activate with:"
echo "  source $SANDBOX_DIR/activate.sh"
