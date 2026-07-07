#!/usr/bin/env bash
# smoke-order: 440
# smoke-subjects: scripts/check-fast-uri-override.sh
# smoke-subjects: scripts/tests/test-check-fast-uri-override.sh
# Pure-shell tests for the fast-uri override watchdog.
#
# The watchdog reads package.json + bun.lock only (no network), so these tests
# drive it entirely through fixture files via the MUSI_FAST_URI_* env hooks.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WATCHDOG="$SCRIPT_DIR/../check-fast-uri-override.sh"

PASS=0
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

# write_case <name> <manifest-contents> <lockfile-contents|__none__>
# Returns the case directory and exports MUSI_FAST_URI_* for the run.
make_case() {
  case_dir="$TMP_ROOT/$1"
  mkdir -p "$case_dir"
  printf '%s\n' "$2" >"$case_dir/package.json"
  if [ "$3" != "__none__" ]; then
    printf '%s\n' "$3" >"$case_dir/bun.lock"
    MUSI_FAST_URI_LOCKFILE="$case_dir/bun.lock"
  else
    MUSI_FAST_URI_LOCKFILE="$case_dir/bun.lock"
  fi
  MUSI_FAST_URI_MANIFEST="$case_dir/package.json"
  export MUSI_FAST_URI_MANIFEST MUSI_FAST_URI_LOCKFILE
}

run_watchdog() {
  set +e
  WATCHDOG_OUT="$(bash "$WATCHDOG" 2>&1)"
  WATCHDOG_CODE=$?
  set -e
}

MANIFEST_WITH_OVERRIDE='{ "overrides": { "fast-uri": "3.1.2" } }'
MANIFEST_NO_OVERRIDE='{ "dependencies": { "fastify": "5.8.5" } }'
LOCK_PINS_VULN='"@fastify/ajv-compiler": { "dependencies": { "fast-uri": "3.1.0" } }'
LOCK_NO_VULN='"@fastify/ajv-compiler": { "dependencies": { "fast-uri": "3.1.2" } }'

# Case 1: override present + a chain still pins the vulnerable 3.1.0 -> pass.
make_case load-bearing "$MANIFEST_WITH_OVERRIDE" "$LOCK_PINS_VULN"
run_watchdog
[ "$WATCHDOG_CODE" -eq 0 ] || fail "load-bearing: expected exit 0, got $WATCHDOG_CODE ($WATCHDOG_OUT)"
printf '%s' "$WATCHDOG_OUT" | grep -q "load-bearing" || fail "load-bearing: missing message ($WATCHDOG_OUT)"
ok "override still load-bearing exits 0"

# Case 2: override present but no chain pins 3.1.0 -> fail with guidance.
make_case redundant "$MANIFEST_WITH_OVERRIDE" "$LOCK_NO_VULN"
run_watchdog
[ "$WATCHDOG_CODE" -eq 1 ] || fail "redundant: expected exit 1, got $WATCHDOG_CODE ($WATCHDOG_OUT)"
printf '%s' "$WATCHDOG_OUT" | grep -q "no longer load-bearing" || fail "redundant: missing guidance ($WATCHDOG_OUT)"
printf '%s' "$WATCHDOG_OUT" | grep -q "overrides" || fail "redundant: missing removal action ($WATCHDOG_OUT)"
ok "redundant override exits 1 with removal guidance"

# Case 3: override already removed from the manifest -> nothing to watch.
make_case removed "$MANIFEST_NO_OVERRIDE" "$LOCK_NO_VULN"
run_watchdog
[ "$WATCHDOG_CODE" -eq 0 ] || fail "removed: expected exit 0, got $WATCHDOG_CODE ($WATCHDOG_OUT)"
printf '%s' "$WATCHDOG_OUT" | grep -q "nothing to watch" || fail "removed: missing message ($WATCHDOG_OUT)"
ok "absent override exits 0"

# Case 4: override present but lockfile missing -> hard error (cannot evaluate).
make_case no-lock "$MANIFEST_WITH_OVERRIDE" "__none__"
run_watchdog
[ "$WATCHDOG_CODE" -eq 2 ] || fail "no-lock: expected exit 2, got $WATCHDOG_CODE ($WATCHDOG_OUT)"
ok "missing lockfile exits 2"

printf '\nall %d fast-uri override watchdog checks passed\n' "$PASS"
