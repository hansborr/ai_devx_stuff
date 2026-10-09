#!/bin/bash

# Hook-specific test support for the ai-hooks shell test suites. Sourced by the
# aggregate runner (test.sh) and the focused per-hook scripts (e.g.
# test-ratchet-regression.sh) so both share one definition of the hook-JSON
# assertions and the hook shim builders. `fail()` and the generic assertions
# come from scripts/tests/lib/test-assertions.sh, which this file sources so
# ai-hooks suites keep getting them from here. Keep this file scoped to test
# support only: pure helper functions with no hook fixtures or stateful setup.

# shellcheck source=../tests/lib/test-assertions.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../tests/lib/test-assertions.sh"

assert_hook_json() {
  local output="$1"

  jq -e . >/dev/null <<< "$output" || fail "invalid hook JSON: $output"
}

assert_hook_continue_json() {
  local output="$1"

  assert_hook_json "$output"
  jq -e '.continue == true and length == 1' >/dev/null <<< "$output" \
    || fail "expected continue hook JSON, got: $output"
}

make_git_optional_locks_guard_shim() {
  local shim_dir="$1"

  mkdir -p "$shim_dir"
  cat > "$shim_dir/git" <<'GIT_OPTIONAL_LOCKS_SHIM'
#!/bin/bash
set -euo pipefail

state=OK
if [ "${GIT_OPTIONAL_LOCKS-}" != "0" ]; then
  state=MISSING
fi
printf '%s\t%s\n' "$state" "$*" >> "$AI_TEST_GIT_OPTIONAL_LOCKS_LOG"
[ "$state" = "OK" ] || exit 42
exec "$AI_TEST_REAL_GIT" "$@"
GIT_OPTIONAL_LOCKS_SHIM
  chmod +x "$shim_dir/git"
}

# Writes a fake `bun` that only records it was invoked (touching
# AI_PRISMA_TEST_SENTINEL) so prisma-generate wiring tests can assert the hook
# shelled out without running the real generator.
make_prisma_sentinel_bun_shim() {
  local shim_dir="$1"

  mkdir -p "$shim_dir"
  cat > "$shim_dir/bun" <<'PRISMA_SENTINEL_BUN_SHIM'
#!/bin/bash
touch "$AI_PRISMA_TEST_SENTINEL"
exit 0
PRISMA_SENTINEL_BUN_SHIM
  chmod +x "$shim_dir/bun"
}
