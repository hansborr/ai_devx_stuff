#!/usr/bin/env bash
# Expected-state definitions for the max-lines exceptions baseline merge driver.

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || return 1
# shellcheck source=scripts/git/baseline-merge-driver-lib.sh
. "$script_dir/baseline-merge-driver-lib.sh" || return 1

# shellcheck disable=SC2034 # Consumed by the sourcing installer and checker.
DRIVER_NAME="max-lines-exceptions-baseline"
INSTALLED_DRIVER_RELATIVE_PATH="musi/baseline-merge-driver.sh"
# shellcheck disable=SC2034 # Consumed by the sourcing installer and checker.
driver_command=$(musi_baseline_driver_command \
  "$INSTALLED_DRIVER_RELATIVE_PATH" \
  "max-lines-exceptions-baseline-merge-driver" \
  "max-lines-exceptions")
# shellcheck disable=SC2034 # Consumed by the sourcing installer.
MERGE_DRIVER_CONFIG_NAME_VALUE="max-lines exceptions baseline regeneration guidance"
MAX_LINES_INFO_ATTRIBUTES_BEGIN="# BEGIN musi max-lines exceptions baseline driver attributes"
MAX_LINES_INFO_ATTRIBUTES_END="# END musi max-lines exceptions baseline driver attributes"
MAX_LINES_INFO_ATTRIBUTES="/eslint-config/max-lines-exceptions.baseline.json merge=max-lines-exceptions-baseline"

render_merge_driver_attributes() {
  render_baseline_merge_attributes \
    "$1" "$2" \
    "$MAX_LINES_INFO_ATTRIBUTES_BEGIN" \
    "$MAX_LINES_INFO_ATTRIBUTES_END" \
    "$MAX_LINES_INFO_ATTRIBUTES"
}
