#!/usr/bin/env bash
# Expected-state definitions for the near-duplicates baseline merge driver.

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || return 1
# shellcheck source=scripts/git/baseline-merge-driver-lib.sh
. "$script_dir/baseline-merge-driver-lib.sh" || return 1

# shellcheck disable=SC2034 # Consumed by the sourced installer/checker.
DRIVER_NAME="near-duplicates-baseline"
INSTALLED_DRIVER_RELATIVE_PATH="musi/baseline-merge-driver.sh"
# shellcheck disable=SC2034 # Consumed by the sourced installer/checker.
driver_command=$(musi_baseline_driver_command \
  "$INSTALLED_DRIVER_RELATIVE_PATH" \
  "near-duplicates-baseline-merge-driver" \
  "near-duplicates")
# shellcheck disable=SC2034 # Consumed by the sourced installer.
MERGE_DRIVER_CONFIG_NAME_VALUE="near-duplicates baseline regeneration guidance"
NEAR_DUPLICATES_INFO_ATTRIBUTES_BEGIN="# BEGIN musi near-duplicates baseline driver attributes"
NEAR_DUPLICATES_INFO_ATTRIBUTES_END="# END musi near-duplicates baseline driver attributes"
NEAR_DUPLICATES_INFO_ATTRIBUTES="/sensor-near-duplicates.baseline.json merge=near-duplicates-baseline"

render_merge_driver_attributes() {
  render_baseline_merge_attributes \
    "$1" "$2" \
    "$NEAR_DUPLICATES_INFO_ATTRIBUTES_BEGIN" \
    "$NEAR_DUPLICATES_INFO_ATTRIBUTES_END" \
    "$NEAR_DUPLICATES_INFO_ATTRIBUTES"
}
