#!/usr/bin/env bash
# session-begin.sh — prep a QA test session in the correct order.
#
# The ordering trap this avoids: `npm link` must run in the REAL HOME so the
# symlink lands in the real global node_modules. If you source activate.sh
# first, HOME is swapped to the sandbox and npm has no global prefix there.
#
# Usage:
#   source test/qa-sandbox/session-begin.sh <task-id>
#   # e.g. source test/qa-sandbox/session-begin.sh T-032
#
# On success, $HOME is the sandbox, cwd is the task's worktree, the worktree's
# `stask` is linked as the global binary, and $STASK_QA_SANDBOX=1.
#
# MUST be sourced (it exports env into the caller's shell and changes cwd).

if [ "${BASH_SOURCE[0]:-}" = "$0" ]; then
  printf '\033[31merror:\033[0m session-begin.sh must be sourced, not executed\n' >&2
  exit 1
fi

_SB_TASK_ID="${1:-}"
if [ -z "$_SB_TASK_ID" ]; then
  printf '\033[31merror:\033[0m task id required\n  usage: source session-begin.sh T-032\n' >&2
  return 1
fi

_SB_SANDBOX_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_SB_REPO_ROOT="$(cd "$_SB_SANDBOX_DIR/../.." && pwd)"

# ── 1. Ask stask where this task's worktree lives ───────────────
# `stask show` must run from inside a registered project; any real
# `.stask/` works. Use the stask repo as a neutral anchor.
printf '\033[36m→\033[0m Looking up worktree for %s\n' "$_SB_TASK_ID"
_SB_WORKTREE=$(cd "$_SB_REPO_ROOT" && stask show "$_SB_TASK_ID" 2>/dev/null \
  | awk -F'[()]' '/Worktree:/{print $2; exit}')

if [ -z "$_SB_WORKTREE" ] || [ ! -d "$_SB_WORKTREE" ]; then
  printf '\033[31merror:\033[0m no worktree for %s (did the worker finish In-Progress?)\n' "$_SB_TASK_ID" >&2
  unset _SB_TASK_ID _SB_SANDBOX_DIR _SB_REPO_ROOT _SB_WORKTREE
  return 1
fi
printf '  worktree: %s\n' "$_SB_WORKTREE"

# ── 2. npm link in REAL HOME — must be before activate.sh ───────
if [ -n "${STASK_QA_SANDBOX:-}" ]; then
  printf '\033[33mwarning:\033[0m sandbox already active; deactivating first so npm link uses real HOME\n' >&2
  # shellcheck source=./deactivate.sh
  source "$_SB_SANDBOX_DIR/deactivate.sh"
fi

printf '\033[36m→\033[0m cd + npm link (real HOME: %s)\n' "$HOME"
cd "$_SB_WORKTREE"
npm link 2>&1 | grep -v '^$' | sed 's/^/  /' || {
  printf '\033[31merror:\033[0m npm link failed in %s\n' "$_SB_WORKTREE" >&2
  unset _SB_TASK_ID _SB_SANDBOX_DIR _SB_REPO_ROOT _SB_WORKTREE
  return 1
}

# ── 3. Enter the sandbox ────────────────────────────────────────
printf '\033[36m→\033[0m Activating sandbox\n'
# shellcheck source=./activate.sh
source "$_SB_SANDBOX_DIR/activate.sh"

# ── 4. Final assertions ─────────────────────────────────────────
if [ "${STASK_QA_SANDBOX:-}" != "1" ] || [ "$HOME" = "$STASK_QA_SANDBOX_REAL_HOME" ]; then
  printf '\033[31merror:\033[0m sandbox failed to activate\n' >&2
  unset _SB_TASK_ID _SB_SANDBOX_DIR _SB_REPO_ROOT _SB_WORKTREE
  return 1
fi

printf '\033[32m\u2713 ready to test %s\033[0m\n' "$_SB_TASK_ID"
printf '  cwd:  %s\n' "$(pwd)"
printf '  HOME: %s\n' "$HOME"
printf '  stask -> %s\n' "$(which stask)"
printf '\033[2m  when done: source %s/deactivate.sh\033[0m\n' "$_SB_SANDBOX_DIR"

unset _SB_TASK_ID _SB_SANDBOX_DIR _SB_REPO_ROOT _SB_WORKTREE
