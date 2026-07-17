#!/usr/bin/env bash
# Expected-state definitions for the knip unused-exports baseline merge driver.

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || return 1
# shellcheck source=scripts/git/baseline-merge-driver-lib.sh
. "$script_dir/baseline-merge-driver-lib.sh" || return 1

# shellcheck disable=SC2034 # Consumed by the sourcing installer and checker.
DRIVER_NAME="knip-unused-exports-baseline"
INSTALLED_DRIVER_RELATIVE_PATH="musi/baseline-merge-driver.sh"
# shellcheck disable=SC2034 # Consumed by the sourcing installer and checker.
driver_command=$(musi_baseline_driver_command \
  "$INSTALLED_DRIVER_RELATIVE_PATH" \
  "knip-unused-exports-baseline-merge-driver" \
  "knip-unused-exports")
# shellcheck disable=SC2034 # Consumed by the sourcing installer.
MERGE_DRIVER_CONFIG_NAME_VALUE="knip unused-exports baseline regeneration guidance"
KNIP_INFO_ATTRIBUTES_BEGIN="# BEGIN musi knip unused-exports baseline driver attributes"
KNIP_INFO_ATTRIBUTES_END="# END musi knip unused-exports baseline driver attributes"
KNIP_INFO_ATTRIBUTES="/sensor-knip-unused-exports.baseline.json merge=knip-unused-exports-baseline"

render_merge_driver_attributes() {
  render_baseline_merge_attributes \
    "$1" "$2" \
    "$KNIP_INFO_ATTRIBUTES_BEGIN" \
    "$KNIP_INFO_ATTRIBUTES_END" \
    "$KNIP_INFO_ATTRIBUTES"
}
