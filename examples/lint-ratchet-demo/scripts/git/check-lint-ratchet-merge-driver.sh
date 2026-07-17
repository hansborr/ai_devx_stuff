#!/usr/bin/env bash
# Read-only health check for the lint-ratchet baseline merge driver.
#
# Thin per-metric entry point: the metric strings live here, the expected
# state lives in lint-ratchet-merge-driver-lib.sh, and the shared check body
# lives in check-baseline-merge-driver.sh.
set -euo pipefail

MERGE_DRIVER_METRIC_LABEL="lint-ratchet"
MERGE_DRIVER_INSTALL_COMMAND="bun run lint:ratchet:install-merge-driver"
MERGE_DRIVER_LIB_BASENAME="lint-ratchet-merge-driver-lib.sh"

shim_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd 2>/dev/null) || {
  printf 'WARN: %s merge driver is missing or stale - run %s\n' \
    "$MERGE_DRIVER_METRIC_LABEL" "$MERGE_DRIVER_INSTALL_COMMAND"
  exit 0
}
# shellcheck source=scripts/git/check-baseline-merge-driver.sh
. "$shim_dir/check-baseline-merge-driver.sh"
