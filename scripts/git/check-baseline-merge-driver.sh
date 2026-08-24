#!/usr/bin/env bash
# Shared read-only health-check body for the per-metric baseline merge drivers.
#
# Sourced by the thin check-<metric>-merge-driver.sh entry points, never run
# directly. The sourcing shim must define, before sourcing this file:
#   MERGE_DRIVER_METRIC_LABEL    human label used in every message ("lint-ratchet")
#   MERGE_DRIVER_INSTALL_COMMAND package script that repairs local Git config
#   MERGE_DRIVER_LIB_BASENAME    per-metric expected-state lib in scripts/git/
# The lib then supplies DRIVER_NAME, INSTALLED_DRIVER_RELATIVE_PATH,
# driver_command, and render_merge_driver_attributes; the tracked driver script
# is the one generic scripts/git/baseline-merge-driver.sh body every baseline
# shares (its basename derived from INSTALLED_DRIVER_RELATIVE_PATH).
#
# Check semantics are advisory: every failure prints the repair line and exits
# 0 so doctor and the verify wrappers report drift without hard-failing.

for merge_driver_required_var in MERGE_DRIVER_METRIC_LABEL \
  MERGE_DRIVER_INSTALL_COMMAND MERGE_DRIVER_LIB_BASENAME; do
  if [ -z "${!merge_driver_required_var:-}" ]; then
    printf 'baseline merge driver check: WARN: %s must be set by the sourcing per-metric checker.\n' \
      "$merge_driver_required_var" >&2
    exit 0
  fi
done

REPAIR_LINE="WARN: $MERGE_DRIVER_METRIC_LABEL merge driver is missing or stale - run $MERGE_DRIVER_INSTALL_COMMAND"

print_repair_line() {
  printf '%s\n' "$REPAIR_LINE"
}

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd 2>/dev/null) || {
  print_repair_line
  exit 0
}
# The lib path is per-metric; point ShellCheck at one representative lib so it
# can resolve the variables and render fn every lib defines.
# shellcheck source=scripts/git/knip-unused-exports-merge-driver-lib.sh
. "$script_dir/$MERGE_DRIVER_LIB_BASENAME" 2>/dev/null || {
  print_repair_line
  exit 0
}

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  print_repair_line
  exit 0
}

cd "$repo_root" || {
  print_repair_line
  exit 0
}

# Every baseline shares one generic driver body; derive its basename from the
# path the lib points at rather than from DRIVER_NAME.
installed_driver_basename=${INSTALLED_DRIVER_RELATIVE_PATH##*/}
driver_script="$repo_root/scripts/git/$installed_driver_basename"

git_common_dir=$(git rev-parse --git-common-dir 2>/dev/null) || {
  print_repair_line
  exit 0
}
case "$git_common_dir" in
  /*) git_common_dir_path="$git_common_dir" ;;
  *) git_common_dir_path="$repo_root/$git_common_dir" ;;
esac
git_common_dir_abs=$(cd "$git_common_dir_path" && pwd -P 2>/dev/null) || {
  print_repair_line
  exit 0
}
installed_driver_script="$git_common_dir_abs/$INSTALLED_DRIVER_RELATIVE_PATH"

config_is_current() {
  [ "$(git config --local --get "merge.$DRIVER_NAME.driver" 2>/dev/null || true)" = "$driver_command" ] \
    && [ "$(git config --local --get "merge.$DRIVER_NAME.recursive" 2>/dev/null || true)" = "binary" ]
}

attributes_are_current() {
  local info_attributes temp_attributes
  info_attributes=$(git rev-parse --git-path info/attributes 2>/dev/null) || return 1
  temp_attributes=$(mktemp) || return 1

  if ! render_merge_driver_attributes "$info_attributes" "$temp_attributes"; then
    rm -f "$temp_attributes"
    return 1
  fi

  if files_match_by_hash "$temp_attributes" "$info_attributes"; then
    rm -f "$temp_attributes"
    return 0
  fi
  rm -f "$temp_attributes"
  return 1
}

if [ -f "$driver_script" ] \
  && config_is_current \
  && files_match_by_hash "$driver_script" "$installed_driver_script" \
  && attributes_are_current; then
  printf 'PASS: %s merge driver is installed and current\n' "$MERGE_DRIVER_METRIC_LABEL"
else
  print_repair_line
fi
