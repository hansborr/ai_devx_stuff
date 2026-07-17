#!/usr/bin/env bash
# Install local Git config for the lint-ratchet baseline merge driver.
#
# Thin per-metric entry point: the metric strings live here, the expected
# state lives in lint-ratchet-merge-driver-lib.sh, and the shared orchestration
# body lives in install-baseline-merge-driver.sh.
set -uo pipefail

MERGE_DRIVER_METRIC_LABEL="lint-ratchet"
MERGE_DRIVER_CHECK_COMMAND="bun run lint:ratchet:merge-driver:check"
# shellcheck disable=SC2034 # Consumed by the sourced shared installer body.
MERGE_DRIVER_INSTALL_COMMAND="bun run lint:ratchet:install-merge-driver"
MERGE_DRIVER_LIB_BASENAME="lint-ratchet-merge-driver-lib.sh"

shim_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || {
  printf '%s merge driver install: WARN: %s %s or bun run doctor will report this until fixed.\n' \
    "$MERGE_DRIVER_METRIC_LABEL" "could not resolve the installer directory" \
    "$MERGE_DRIVER_CHECK_COMMAND" >&2
  exit 0
}
# shellcheck source=scripts/git/install-baseline-merge-driver.sh
. "$shim_dir/install-baseline-merge-driver.sh"
