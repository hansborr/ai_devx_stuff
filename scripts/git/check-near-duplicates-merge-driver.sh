#!/usr/bin/env bash
set -euo pipefail

MERGE_DRIVER_METRIC_LABEL="near-duplicates"
MERGE_DRIVER_INSTALL_COMMAND="bun run sensor:near-duplicates:install-merge-driver"
MERGE_DRIVER_LIB_BASENAME="near-duplicates-merge-driver-lib.sh"

shim_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd 2>/dev/null) || {
  printf 'WARN: %s merge driver is missing or stale - run %s\n' \
    "$MERGE_DRIVER_METRIC_LABEL" "$MERGE_DRIVER_INSTALL_COMMAND"
  exit 0
}
# shellcheck source=scripts/git/check-baseline-merge-driver.sh
. "$shim_dir/check-baseline-merge-driver.sh"
