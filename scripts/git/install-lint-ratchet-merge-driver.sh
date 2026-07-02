#!/usr/bin/env bash
# Install local Git config for the lint-ratchet baseline merge driver.
set -uo pipefail

warn_and_exit() {
  printf 'lint-ratchet merge driver install: WARN: %s\n' "$*" >&2
  exit 0
}

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) \
  || warn_and_exit "could not resolve the installer directory"
# shellcheck source=scripts/git/lint-ratchet-merge-driver-lib.sh
. "$script_dir/lint-ratchet-merge-driver-lib.sh" \
  || warn_and_exit "missing $script_dir/lint-ratchet-merge-driver-lib.sh"

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  warn_and_exit "run from inside a Git worktree."
}

cd "$repo_root" || warn_and_exit "could not cd to repo root: $repo_root"

driver_script="$repo_root/scripts/git/lint-ratchet-baseline-merge-driver.sh"
if [ ! -f "$driver_script" ]; then
  warn_and_exit "missing $driver_script"
fi

git_common_dir=$(git rev-parse --git-common-dir 2>/dev/null) \
  || warn_and_exit "could not resolve Git common directory."
case "$git_common_dir" in
  /*) git_common_dir_path="$git_common_dir" ;;
  *) git_common_dir_path="$repo_root/$git_common_dir" ;;
esac
git_common_dir_abs=$(cd "$git_common_dir_path" && pwd -P) \
  || warn_and_exit "could not access Git common directory: $git_common_dir_path"
installed_driver_script="$git_common_dir_abs/$INSTALLED_DRIVER_RELATIVE_PATH"
installed_driver_dir=$(dirname "$installed_driver_script")
changed=0

if ! files_match_by_hash "$driver_script" "$installed_driver_script"; then
  mkdir -p "$installed_driver_dir" \
    || warn_and_exit "could not create installed driver directory: $installed_driver_dir"
  cp "$driver_script" "$installed_driver_script" \
    || warn_and_exit "could not copy driver to $installed_driver_script"
  chmod 755 "$installed_driver_script" \
    || warn_and_exit "could not chmod installed driver: $installed_driver_script"
  changed=1
fi

set_config_if_stale() {
  local key="$1" desired="$2" current
  current="$(git config --local --get "$key" 2>/dev/null || true)"
  if [ "$current" = "$desired" ]; then
    return 0
  fi
  git config --local "$key" "$desired" \
    || warn_and_exit "could not write local Git config $key; run bun run lint:ratchet:install-merge-driver after fixing local Git config permissions."
  changed=1
}

set_config_if_stale "merge.$DRIVER_NAME.name" "lint ratchet baseline regeneration guidance"
set_config_if_stale "merge.$DRIVER_NAME.driver" "$driver_command"
set_config_if_stale "merge.$DRIVER_NAME.recursive" "binary"

info_attributes=$(git rev-parse --git-path info/attributes 2>/dev/null) \
  || warn_and_exit "could not resolve .git/info/attributes."
info_attributes_dir=$(dirname "$info_attributes")
mkdir -p "$info_attributes_dir" \
  || warn_and_exit "could not create attributes directory: $info_attributes_dir"

temp_attributes=""
cleanup() {
  if [ -n "$temp_attributes" ]; then
    rm -f "$temp_attributes"
  fi
}
trap cleanup EXIT

temp_attributes=$(mktemp "$info_attributes_dir/attributes.XXXXXX") \
  || warn_and_exit "could not create temporary attributes file under $info_attributes_dir"

render_lint_ratchet_attributes "$info_attributes" "$temp_attributes" \
  || warn_and_exit "could not render desired attributes into $temp_attributes"

if ! files_match_by_hash "$temp_attributes" "$info_attributes"; then
  mv "$temp_attributes" "$info_attributes" \
    || warn_and_exit "could not update $info_attributes"
  temp_attributes=""
  changed=1
fi

if [ "$changed" -eq 1 ]; then
  cat <<EOF
lint-ratchet merge driver installed.
  driver: merge.$DRIVER_NAME.driver
  installed driver: $installed_driver_script
  attributes: $info_attributes
EOF
fi
