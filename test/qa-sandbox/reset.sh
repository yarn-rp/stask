# reset.sh — wipe the current sandbox and re-activate with a fresh seed.
# MUST be sourced (same contract as activate.sh).

if [ "${BASH_SOURCE[0]:-}" = "$0" ]; then
  printf '\033[31merror:\033[0m reset.sh must be sourced\n' >&2
  exit 1
fi

if [ -z "${STASK_QA_SANDBOX:-}" ]; then
  printf '\033[33mwarning:\033[0m no active sandbox — starting a fresh one\n' >&2
else
  if [ -d "$HOME" ] && [[ "$HOME" == /tmp/stask-qa.* ]]; then
    rm -rf "$HOME"
  fi
  if [ -n "${STASK_QA_SANDBOX_REAL_HOME:-}" ]; then
    export HOME="$STASK_QA_SANDBOX_REAL_HOME"
  fi
  unset STASK_QA_SANDBOX STASK_QA_SANDBOX_REAL_HOME STASK_HOME
  trap - EXIT
fi

_RESET_SANDBOX_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./activate.sh
source "$_RESET_SANDBOX_DIR/activate.sh" "$@"
unset _RESET_SANDBOX_DIR
