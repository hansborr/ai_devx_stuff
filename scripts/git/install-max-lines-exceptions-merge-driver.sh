#!/usr/bin/env bash
# Install local Git config for the max-lines exceptions baseline merge driver.
#
# Thin per-metric entry point: the metric strings live here, the expected
# state lives in max-lines-exceptions-merge-driver-lib.sh, and the shared
# orchestration body lives in install-baseline-merge-driver.sh.
set -uo pipefail

MERGE_DRIVER_METRIC_LABEL="max-lines exceptions"
MERGE_DRIVER_CHECK_COMMAND="bun run lint:max-lines-exceptions:merge-driver:check"
# shellcheck disable=SC2034 # Consumed by the sourced shared installer body.
MERGE_DRIVER_INSTALL_COMMAND="bun run lint:max-lines-exceptions:install-merge-driver"
MERGE_DRIVER_LIB_BASENAME="max-lines-exceptions-merge-driver-lib.sh"

shim_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || {
  printf '%s merge driver install: WARN: %s %s or bun run doctor will report this until fixed.\n' \
    "$MERGE_DRIVER_METRIC_LABEL" "could not resolve the installer directory" \
    "$MERGE_DRIVER_CHECK_COMMAND" >&2
  exit 0
}
# shellcheck source=scripts/git/install-baseline-merge-driver.sh
. "$shim_dir/install-baseline-merge-driver.sh"
