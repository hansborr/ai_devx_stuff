#!/usr/bin/env bash

# Shared pass/fail bookkeeping and generic assertions for the shell test suites
# under scripts/tests. scripts/ai-hooks/test-support.sh sources it as well, for
# `fail()` and the three asserts; no ai-hooks suite uses `ok()` or `PASS`.
#
# Most scripts/tests suites define their own `fail()` and `ok()`, and
# scripts/ai-hooks/test-support.sh held one shared copy of `fail()` and the
# generic asserts with no pass counter at all. A fix to one copy does not reach
# the others: the `--` guard below landed in test-support.sh alone and was
# never replayed, so scripts/tests/test-typecheck.sh still greps without it.
# Sourcing this file gives one definition of all of them.
#
# Usage:
#   . "$SCRIPT_DIR/lib/test-assertions.sh"
#   ok "the thing happened"
#   assert_contains "$output" "expected phrase"
#
# Source it once, and before the first `ok()`: `PASS=0` runs at source time, so
# a second source — directly as well as through
# scripts/ai-hooks/test-support.sh, say — silently resets the count.
#
# The API is frozen: `PASS`, `fail`, `ok`, `assert_contains`,
# `assert_not_contains` and `assert_no_output`, with the output formats below.
# Every suite that names this file in a `# smoke-subjects:` header reruns on any
# edit here, so do not add helpers to it and do not reword its output.
#
# Keep this file scoped to test support only: pure helper functions with no
# fixtures or stateful setup (no mktemp, no traps). Temp-directory bookkeeping
# lives in test-tmpdir.sh; suite-specific fixtures stay in the suite.

PASS=0

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

# `--` terminates option parsing: without it a needle that starts with `-` (say
# `--dry-run completed`) is read by grep as an option, the assertion errors out
# instead of comparing, and assert_not_contains then passes vacuously.
assert_contains() {
  local haystack="$1"
  local needle="$2"

  grep -qF -- "$needle" <<< "$haystack" || fail "expected [$haystack] to contain [$needle]"
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"

  if grep -qF -- "$needle" <<< "$haystack"; then
    fail "expected [$haystack] not to contain [$needle]"
  fi
}

assert_no_output() {
  local output="$1"
  local label="$2"

  [ -z "$output" ] || fail "$label should emit nothing, got: $output"
}
