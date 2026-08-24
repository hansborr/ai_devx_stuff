#!/usr/bin/env bash
# Shared installer body for the per-metric baseline merge drivers.
#
# Sourced by the thin install-<metric>-merge-driver.sh entry points, never run
# directly. The sourcing shim must define, before sourcing this file:
#   MERGE_DRIVER_METRIC_LABEL    human label used in every message ("lint-ratchet")
#   MERGE_DRIVER_CHECK_COMMAND   package script that reports a broken install
#   MERGE_DRIVER_INSTALL_COMMAND package script that repairs local Git config
#   MERGE_DRIVER_LIB_BASENAME    per-metric expected-state lib in scripts/git/
# The lib then supplies DRIVER_NAME, INSTALLED_DRIVER_RELATIVE_PATH,
# driver_command, MERGE_DRIVER_CONFIG_NAME_VALUE, and
# render_merge_driver_attributes; the tracked driver script is the one generic
# scripts/git/baseline-merge-driver.sh body every baseline shares (its basename
# derived from INSTALLED_DRIVER_RELATIVE_PATH), keyed at merge time by the metric
# baked into driver_command.
#
# Installer semantics are advisory (warn_and_exit exits 0): package `prepare`
# and the Git hooks must never hard-fail on a broken local Git environment.

for merge_driver_required_var in MERGE_DRIVER_METRIC_LABEL MERGE_DRIVER_CHECK_COMMAND \
  MERGE_DRIVER_INSTALL_COMMAND MERGE_DRIVER_LIB_BASENAME; do
  if [ -z "${!merge_driver_required_var:-}" ]; then
    printf 'baseline merge driver install: WARN: %s must be set by the sourcing per-metric installer.\n' \
      "$merge_driver_required_var" >&2
    exit 0
  fi
done

warn_and_exit() {
  printf '%s merge driver install: WARN: %s %s or bun run doctor will report this until fixed.\n' \
    "$MERGE_DRIVER_METRIC_LABEL" "$*" "$MERGE_DRIVER_CHECK_COMMAND" >&2
  exit 0
}

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) \
  || warn_and_exit "could not resolve the installer directory"
# The lib path is per-metric; point ShellCheck at one representative lib so it
# can resolve the variables and render fn every lib defines.
# shellcheck source=scripts/git/knip-unused-exports-merge-driver-lib.sh
. "$script_dir/$MERGE_DRIVER_LIB_BASENAME" \
  || warn_and_exit "missing $script_dir/$MERGE_DRIVER_LIB_BASENAME"

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  warn_and_exit "run from inside a Git worktree."
}

cd "$repo_root" || warn_and_exit "could not cd to repo root: $repo_root"

# Every baseline installs one generic driver body; the metric key baked into
# driver_command selects the per-baseline descriptor inside it. The installed
# copy basename is derived from INSTALLED_DRIVER_RELATIVE_PATH so it tracks the
# shared file the lib points at.
installed_driver_basename=${INSTALLED_DRIVER_RELATIVE_PATH##*/}
driver_script="$repo_root/scripts/git/$installed_driver_basename"
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
temp_driver_script=""
temp_attributes=""

cleanup() {
  if [ -n "$temp_driver_script" ]; then
    rm -f "$temp_driver_script"
  fi
  if [ -n "$temp_attributes" ]; then
    rm -f "$temp_attributes"
  fi
}
trap cleanup EXIT

if ! files_match_by_hash "$driver_script" "$installed_driver_script"; then
  mkdir -p "$installed_driver_dir" \
    || warn_and_exit "could not create installed driver directory: $installed_driver_dir"
  temp_driver_script=$(mktemp "$installed_driver_dir/$installed_driver_basename.XXXXXX") \
    || warn_and_exit "could not create temporary driver under $installed_driver_dir"
  cp "$driver_script" "$temp_driver_script" \
    || warn_and_exit "could not copy driver to temporary file: $temp_driver_script"
  chmod 755 "$temp_driver_script" \
    || warn_and_exit "could not chmod temporary driver: $temp_driver_script"
  mv -f "$temp_driver_script" "$installed_driver_script" \
    || warn_and_exit "could not atomically update installed driver: $installed_driver_script"
  temp_driver_script=""
  changed=1
fi

# Every per-metric installer writes the shared local Git config and
# info/attributes file, including installers launched from sibling worktrees.
# Serialize that complete transaction under their Git common directory so a
# config.lock race cannot make one installer exit before repairing attributes,
# and each attributes render starts from the preceding writer's committed state.
attributes_lock="$installed_driver_dir/baseline-merge-driver-attributes.lock"
mkdir -p "$installed_driver_dir" \
  || warn_and_exit "could not create merge driver lock directory: $installed_driver_dir"
command -v flock >/dev/null 2>&1 \
  || warn_and_exit "flock is required; install util-linux on Linux or run brew install flock on macOS."
exec {attributes_lock_fd}>"$attributes_lock" \
  || warn_and_exit "could not open merge driver attributes lock: $attributes_lock"
flock "$attributes_lock_fd" \
  || warn_and_exit "could not acquire merge driver attributes lock: $attributes_lock"

set_config_if_stale() {
  local key="$1" desired="$2" current
  current="$(git config --local --get "$key" 2>/dev/null || true)"
  if [ "$current" = "$desired" ]; then
    return 0
  fi
  git config --local "$key" "$desired" \
    || warn_and_exit "could not write local Git config $key; run $MERGE_DRIVER_INSTALL_COMMAND after fixing local Git config permissions."
  changed=1
}

set_config_if_stale "merge.$DRIVER_NAME.name" "$MERGE_DRIVER_CONFIG_NAME_VALUE"
set_config_if_stale "merge.$DRIVER_NAME.driver" "$driver_command"
set_config_if_stale "merge.$DRIVER_NAME.recursive" "binary"

info_attributes=$(git rev-parse --git-path info/attributes 2>/dev/null) \
  || warn_and_exit "could not resolve .git/info/attributes."
info_attributes_dir=$(dirname "$info_attributes")
mkdir -p "$info_attributes_dir" \
  || warn_and_exit "could not create attributes directory: $info_attributes_dir"

temp_attributes=$(mktemp "$info_attributes_dir/attributes.XXXXXX") \
  || warn_and_exit "could not create temporary attributes file under $info_attributes_dir"

render_merge_driver_attributes "$info_attributes" "$temp_attributes" \
  || warn_and_exit "could not render desired attributes into $temp_attributes"

if ! files_match_by_hash "$temp_attributes" "$info_attributes"; then
  mv "$temp_attributes" "$info_attributes" \
    || warn_and_exit "could not update $info_attributes"
  temp_attributes=""
  changed=1
fi

exec {attributes_lock_fd}>&- \
  || warn_and_exit "could not release merge driver attributes lock: $attributes_lock"

if [ "$changed" -eq 1 ]; then
  cat <<EOF
$MERGE_DRIVER_METRIC_LABEL merge driver installed.
  driver: merge.$DRIVER_NAME.driver
  installed driver: $installed_driver_script
  attributes: $info_attributes
EOF
fi
