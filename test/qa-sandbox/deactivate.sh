# deactivate.sh — end a QA sandbox session. MUST be sourced.
#
# Opposite of activate.sh: runs Slack cleanup (delete canvases + clear
# bookmarks on the project channel), deletes the ephemeral $HOME, and
# clears the sandbox env vars so the shell behaves normally again.
#
# This is the signal an AI agent (or human) gives when their test
# session is finished and shouldn't leak Slack artifacts. If you forget
# to call it, `install.sh` will clean up on the next run anyway — so
# nothing accumulates forever, but the current run's canvas + bookmarks
# will sit there until then.
#
# Usage:
#   source test/qa-sandbox/deactivate.sh
#
# No-op if no sandbox is active.

if [ "${BASH_SOURCE[0]:-}" = "$0" ]; then
  printf '\033[31merror:\033[0m deactivate.sh must be sourced\n' >&2
  exit 1
fi

if [ -z "${STASK_QA_SANDBOX:-}" ]; then
  printf '\033[2mno active sandbox\033[0m\n'
  return 0
fi

_DEACT_SANDBOX_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_DEACT_SANDBOX_HOME="$HOME"
_DEACT_REAL_HOME="${STASK_QA_SANDBOX_REAL_HOME:-$HOME}"

# 1. Restore real HOME so cleanup.sh can read ~/.stask-qa/credentials.json.
export HOME="$_DEACT_REAL_HOME"

# 2. Tear down Slack artifacts (channel stays active, canvases + bookmarks purged).
if [ -z "${STASK_QA_NO_CLEANUP:-}" ]; then
  bash "$_DEACT_SANDBOX_DIR/cleanup.sh" || printf '\033[33mcleanup reported errors \u2014 continuing\033[0m\n' >&2
else
  printf '\033[2mskipping Slack cleanup (STASK_QA_NO_CLEANUP set)\033[0m\n'
fi

# 3. Delete the ephemeral $HOME.
if [ -d "$_DEACT_SANDBOX_HOME" ] && [[ "$_DEACT_SANDBOX_HOME" == /tmp/stask-qa.* ]]; then
  rm -rf "$_DEACT_SANDBOX_HOME"
fi

# 4. Clear sandbox env + cancel the EXIT trap installed by activate.sh.
unset STASK_QA_SANDBOX STASK_QA_SANDBOX_REAL_HOME GH_TOKEN
trap - EXIT

printf '\033[32m\u2713 sandbox deactivated\033[0m\n'
unset _DEACT_SANDBOX_DIR _DEACT_SANDBOX_HOME _DEACT_REAL_HOME
