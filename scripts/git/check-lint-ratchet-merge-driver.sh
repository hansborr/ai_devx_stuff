#!/usr/bin/env bash
# Read-only health check for the lint-ratchet baseline merge driver.
set -euo pipefail

REPAIR_LINE="WARN: lint-ratchet merge driver is missing or stale - run bun run lint:ratchet:install-merge-driver"

print_repair_line() {
  printf '%s\n' "$REPAIR_LINE"
}

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd 2>/dev/null) || {
  print_repair_line
  exit 0
}
# shellcheck source=scripts/git/lint-ratchet-merge-driver-lib.sh
. "$script_dir/lint-ratchet-merge-driver-lib.sh" 2>/dev/null || {
  print_repair_line
  exit 0
}

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  print_repair_line
  exit 0
}

cd "$repo_root"

driver_script="$repo_root/scripts/git/lint-ratchet-baseline-merge-driver.sh"

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

  if ! render_lint_ratchet_attributes "$info_attributes" "$temp_attributes"; then
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
  printf 'PASS: lint-ratchet merge driver is installed and current\n'
else
  print_repair_line
fi
