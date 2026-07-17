#!/usr/bin/env bash
set -uo pipefail

MERGE_DRIVER_METRIC_LABEL="near-duplicates"
MERGE_DRIVER_CHECK_COMMAND="bun run sensor:near-duplicates:merge-driver:check"
MERGE_DRIVER_INSTALL_COMMAND="bun run sensor:near-duplicates:install-merge-driver"
MERGE_DRIVER_LIB_BASENAME="near-duplicates-merge-driver-lib.sh"

shim_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || {
  printf '%s merge driver install: WARN: could not resolve installer directory; run %s\n' \
    "$MERGE_DRIVER_METRIC_LABEL" "$MERGE_DRIVER_CHECK_COMMAND" >&2
  exit 0
}
# shellcheck source=scripts/git/install-baseline-merge-driver.sh
. "$shim_dir/install-baseline-merge-driver.sh"
