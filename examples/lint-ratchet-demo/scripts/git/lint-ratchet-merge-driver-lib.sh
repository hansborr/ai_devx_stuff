#!/usr/bin/env bash
# Expected-state definitions for the lint-ratchet baseline merge driver.

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || return 1
# shellcheck source=scripts/git/baseline-merge-driver-lib.sh
. "$script_dir/baseline-merge-driver-lib.sh" || return 1

# shellcheck disable=SC2034 # Consumed by the sourcing installer and checker.
DRIVER_NAME="lint-ratchet-baseline"
INSTALLED_DRIVER_RELATIVE_PATH="musi/baseline-merge-driver.sh"
# shellcheck disable=SC2034 # Consumed by the sourcing installer and checker.
driver_command=$(baseline_driver_command \
  "$INSTALLED_DRIVER_RELATIVE_PATH" \
  "lint-ratchet-baseline-merge-driver" \
  "lint-ratchet")
# shellcheck disable=SC2034 # Consumed by the sourcing installer.
MERGE_DRIVER_CONFIG_NAME_VALUE="lint ratchet baseline regeneration guidance"
LINT_RATCHET_INFO_ATTRIBUTES_BEGIN="# BEGIN musi lint-ratchet baseline driver attributes"
LINT_RATCHET_INFO_ATTRIBUTES_END="# END musi lint-ratchet baseline driver attributes"
LINT_RATCHET_INFO_ATTRIBUTES=$(printf '%s\n%s' \
  "/lint-ratchet.debt-log.jsonl merge=union" \
  "/lint-ratchet.baseline.json merge=lint-ratchet-baseline")

render_merge_driver_attributes() {
  render_baseline_merge_attributes \
    "$1" "$2" \
    "$LINT_RATCHET_INFO_ATTRIBUTES_BEGIN" \
    "$LINT_RATCHET_INFO_ATTRIBUTES_END" \
    "$LINT_RATCHET_INFO_ATTRIBUTES"
}
