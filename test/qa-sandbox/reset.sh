# reset.sh — wipe the current sandbox directory and re-seed. MUST be sourced.
#
# Thin wrapper around `activate.sh --fresh`. Kept as a separate command for
# muscle memory and visibility in docs.

if [ "${BASH_SOURCE[0]:-}" = "$0" ]; then
  printf '\033[31merror:\033[0m reset.sh must be sourced\n' >&2
  exit 1
fi

_RESET_SANDBOX_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./activate.sh
source "$_RESET_SANDBOX_DIR/activate.sh" --fresh "$@"
unset _RESET_SANDBOX_DIR
