#!/usr/bin/env bash
# Shared expected-state helpers for generated-baseline Git merge drivers.

# The .git/info/attributes block-rewriting lives in TypeScript
# (baseline-info-attributes.ts) so its legacy-migration and unterminated-block
# rules are unit-testable rather than encoded in awk. Resolve it next to this lib
# at source time, so a fixture that runs the real installer from the repo tree
# finds the real renderer without having to copy it in.
_baseline_lib_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || return 1
_baseline_info_attributes_renderer="$_baseline_lib_dir/baseline-info-attributes.ts"

# Render the clone-local merge.<name>.driver command. The baseline shares one
# installed driver body (musi/baseline-merge-driver.sh); the driver key baked in
# here selects the per-baseline descriptor inside that generic body.
baseline_driver_command() {
  local installed_driver_relative_path="$1" argv0="$2" driver_key="$3"
  printf '%s\n' "bash -c 'set -e; driver=\"\$(git rev-parse --git-common-dir)/$installed_driver_relative_path\"; exec bash \"\$driver\" $driver_key \"\$@\"' $argv0 %O %A %B %L %P"
}

# Print the sha256 of $1; fail when no hash tool is available so callers
# treat unverifiable files as not matching (fail closed: the installer
# refreshes anyway, the checker never reports a false PASS).
file_hash() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    return 1
  fi
}

files_match_by_hash() {
  local left="$1" right="$2" left_hash right_hash
  [ -f "$left" ] || return 1
  [ -f "$right" ] || return 1
  left_hash=$(file_hash "$left") || return 1
  right_hash=$(file_hash "$right") || return 1
  [ -n "$left_hash" ] && [ "$left_hash" = "$right_hash" ]
}

# Render one driver's desired .git/info/attributes block into $2 from the
# current attributes file $1 (which may not exist). Callers pass their block
# markers and newline-delimited attribute rows, so installing one driver never
# creates or rewrites sibling systems' mappings. The migration, in-place refresh,
# and unterminated-block fail-loud rules live in baseline-info-attributes.ts;
# this shim only forwards the arguments to it. Returns non-zero on any render or
# write failure (including a missing bun runtime) so callers never install or
# compare a truncated render.
render_baseline_merge_attributes() {
  local current_attributes="$1" rendered="$2"
  local managed_begin="$3" managed_end="$4" managed_attributes="$5"

  command -v bun >/dev/null 2>&1 || return 1
  bun run "$_baseline_info_attributes_renderer" \
    "$current_attributes" "$rendered" "$managed_begin" "$managed_end" "$managed_attributes"
}
