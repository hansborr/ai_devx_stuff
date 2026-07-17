# shellcheck shell=bash
# shellcheck disable=SC2034 # Public arrays are populated for sourcing callers.
# The full main ESLint lane is split only at package source boundaries. Package
# configs, server scripts/prisma, root scripts/configs, E2E, JS, and JSON stay
# together in the remainder so their dedicated parser projects keep working.

declare -ga MUSI_ESLINT_MAIN_PARTITIONS=(shared server client remainder)
declare -ga MUSI_ESLINT_MAIN_PARTITION_ARGS=()

musi_eslint_main_partition_for_path() {
  local path="${1#./}"
  case "$path" in
    packages/shared/src/*) printf 'shared\n' ;;
    packages/server/src/*) printf 'server\n' ;;
    packages/client/src/*) printf 'client\n' ;;
    *) printf 'remainder\n' ;;
  esac
}

musi_eslint_main_full_partition_args() {
  local partition="$1"
  case "$partition" in
    shared)
      MUSI_ESLINT_MAIN_PARTITION_ARGS=(packages/shared/src)
      ;;
    server)
      MUSI_ESLINT_MAIN_PARTITION_ARGS=(packages/server/src)
      ;;
    client)
      MUSI_ESLINT_MAIN_PARTITION_ARGS=(packages/client/src)
      ;;
    remainder)
      MUSI_ESLINT_MAIN_PARTITION_ARGS=(
        .
        --ignore-pattern 'packages/shared/src/**'
        --ignore-pattern 'packages/server/src/**'
        --ignore-pattern 'packages/client/src/**'
      )
      ;;
    *)
      printf 'eslint-main: unknown partition %s\n' "$partition" >&2
      return 2
      ;;
  esac
}
