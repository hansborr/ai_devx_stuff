#!/usr/bin/env bash

# Shared temp-directory bookkeeping for the shell smokes under scripts/tests.
#
# A suite that installs one `trap 'rm -rf …' EXIT` per fixture has to re-list
# every earlier fixture in every later trap, so a forgotten name leaks silently
# and the trap string grows with the file. Instead, each fixture registers
# itself here and one EXIT cleanup — installed by sourcing this file — removes
# them all.
#
# Usage:
#   . "$SCRIPT_DIR/lib/test-tmpdir.sh"
#   fixture_dir="$(musi_test_tmp_dir)"
#
# The registry file and its EXIT handler are created together at source time so
# there is no window in which a registry exists with nothing to clean it up. A
# suite that needs extra teardown replaces the handler and chains the cleanup
# itself, e.g. `trap 'kill_holder; musi_test_tmp_cleanup' EXIT` — any EXIT trap
# installed after sourcing must call musi_test_tmp_cleanup or the fixtures leak.
#
# The registry is a file rather than a shell array so that a directory created
# inside a command substitution or a case subshell is still torn down by the
# parent's EXIT handler.

MUSI_TEST_TMP_REGISTRY="$(mktemp)"

musi_test_tmp_dir() {
  local musi_test_tmp_new
  musi_test_tmp_new="$(mktemp -d)"
  printf '%s\n' "$musi_test_tmp_new" >> "$MUSI_TEST_TMP_REGISTRY"
  printf '%s' "$musi_test_tmp_new"
}

musi_test_tmp_cleanup() {
  local musi_test_tmp_entry
  [[ -f "$MUSI_TEST_TMP_REGISTRY" ]] || return 0
  while IFS= read -r musi_test_tmp_entry; do
    [[ -z "$musi_test_tmp_entry" ]] || rm -rf "$musi_test_tmp_entry"
  done < "$MUSI_TEST_TMP_REGISTRY"
  rm -f "$MUSI_TEST_TMP_REGISTRY"
}

trap 'musi_test_tmp_cleanup' EXIT
