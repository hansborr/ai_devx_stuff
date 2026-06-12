#!/usr/bin/env bash
# Pure-shell tests for the ESLint 10 React-plugin peer-exception watchdog.
#
# The watchdog reads each plugin's installed package.json only (no network), so
# these tests drive it entirely through fixture files via the
# MUSI_ESLINT_REACT_PKG / MUSI_ESLINT_JSXA11Y_PKG env hooks.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WATCHDOG="$SCRIPT_DIR/../check-eslint-react-peer-exception.sh"

PASS=0
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

# make_case <name> <react-peer|__missing__|__nopeer__> <jsx-peer|__missing__|__nopeer__>
# Writes fixture package.json files and exports the MUSI_ESLINT_* hooks. The
# sentinels point a hook at a non-existent file (__missing__) or write a
# package.json that declares no eslint peer (__nopeer__).
make_case() {
  case_dir="$TMP_ROOT/$1"
  mkdir -p "$case_dir"
  case "$2" in
    __missing__) MUSI_ESLINT_REACT_PKG="$case_dir/react-missing.json" ;;
    __nopeer__)
      printf '%s\n' '{ "peerDependencies": { "react": "*" } }' >"$case_dir/react.json"
      MUSI_ESLINT_REACT_PKG="$case_dir/react.json"
      ;;
    *)
      printf '{ "peerDependencies": { "eslint": "%s" } }\n' "$2" >"$case_dir/react.json"
      MUSI_ESLINT_REACT_PKG="$case_dir/react.json"
      ;;
  esac
  case "$3" in
    __missing__) MUSI_ESLINT_JSXA11Y_PKG="$case_dir/jsx-missing.json" ;;
    __nopeer__)
      printf '%s\n' '{ "peerDependencies": { "react": "*" } }' >"$case_dir/jsx.json"
      MUSI_ESLINT_JSXA11Y_PKG="$case_dir/jsx.json"
      ;;
    *)
      printf '{ "peerDependencies": { "eslint": "%s" } }\n' "$3" >"$case_dir/jsx.json"
      MUSI_ESLINT_JSXA11Y_PKG="$case_dir/jsx.json"
      ;;
  esac
  export MUSI_ESLINT_REACT_PKG MUSI_ESLINT_JSXA11Y_PKG
}

run_watchdog() {
  set +e
  WATCHDOG_OUT="$(bash "$WATCHDOG" 2>&1)"
  WATCHDOG_CODE=$?
  set -e
}

# The real installed peer ranges (both cap at 9, so both exclude ESLint 10).
REACT_BLOCKS='^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9.7'
JSX_BLOCKS='^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9'
# The expected upstream fix: append an ESLint 10 disjunct.
REACT_ADMITS='^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9.7 || ^10'
JSX_ADMITS='^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9 || ^10'

# Case 1: both plugins still exclude ESLint 10 -> exception still needed.
make_case both-block "$REACT_BLOCKS" "$JSX_BLOCKS"
run_watchdog
[ "$WATCHDOG_CODE" -eq 0 ] || fail "both-block: expected exit 0, got $WATCHDOG_CODE ($WATCHDOG_OUT)"
printf '%s' "$WATCHDOG_OUT" | grep -q "exception still needed" || fail "both-block: missing message ($WATCHDOG_OUT)"
ok "both plugins exclude v10 exits 0"

# Case 2: only react admits v10 -> exception still needed (jsx-a11y lags).
make_case react-only "$REACT_ADMITS" "$JSX_BLOCKS"
run_watchdog
[ "$WATCHDOG_CODE" -eq 0 ] || fail "react-only: expected exit 0, got $WATCHDOG_CODE ($WATCHDOG_OUT)"
printf '%s' "$WATCHDOG_OUT" | grep -q "jsx-a11y" || fail "react-only: should still flag jsx-a11y ($WATCHDOG_OUT)"
ok "only react admits v10 exits 0"

# Case 3: only jsx-a11y admits v10 -> exception still needed (react lags).
make_case jsx-only "$REACT_BLOCKS" "$JSX_ADMITS"
run_watchdog
[ "$WATCHDOG_CODE" -eq 0 ] || fail "jsx-only: expected exit 0, got $WATCHDOG_CODE ($WATCHDOG_OUT)"
printf '%s' "$WATCHDOG_OUT" | grep -q "eslint-plugin-react peer" || fail "jsx-only: should still flag react ($WATCHDOG_OUT)"
ok "only jsx-a11y admits v10 exits 0"

# Case 4: both admit v10 -> exception obsolete, fail with removal guidance.
make_case both-admit "$REACT_ADMITS" "$JSX_ADMITS"
run_watchdog
[ "$WATCHDOG_CODE" -eq 1 ] || fail "both-admit: expected exit 1, got $WATCHDOG_CODE ($WATCHDOG_OUT)"
printf '%s' "$WATCHDOG_OUT" | grep -q "obsolete" || fail "both-admit: missing guidance ($WATCHDOG_OUT)"
printf '%s' "$WATCHDOG_OUT" | grep -q "Delete scripts/check-eslint-react-peer-exception.sh" || fail "both-admit: missing removal action ($WATCHDOG_OUT)"
ok "both plugins admit v10 exits 1 with removal guidance"

# Case 5: a plugin package.json is missing -> hard error (cannot evaluate).
make_case missing-pkg __missing__ "$JSX_BLOCKS"
run_watchdog
[ "$WATCHDOG_CODE" -eq 2 ] || fail "missing-pkg: expected exit 2, got $WATCHDOG_CODE ($WATCHDOG_OUT)"
printf '%s' "$WATCHDOG_OUT" | grep -q "not found" || fail "missing-pkg: missing diagnostic ($WATCHDOG_OUT)"
ok "missing plugin package exits 2"

# Case 6: a plugin declares no eslint peer -> hard error (cannot evaluate).
make_case no-peer "$REACT_BLOCKS" __nopeer__
run_watchdog
[ "$WATCHDOG_CODE" -eq 2 ] || fail "no-peer: expected exit 2, got $WATCHDOG_CODE ($WATCHDOG_OUT)"
printf '%s' "$WATCHDOG_OUT" | grep -q "no usable eslint peer" || fail "no-peer: missing diagnostic ($WATCHDOG_OUT)"
ok "missing eslint peer exits 2"

# Case 7: a malformed/non-semver peer range -> hard error (cannot evaluate).
# Bun.semver.satisfies() reports a garbage range as matching everything, so the
# guard must reject it rather than silently treating it as "admits v10".
make_case bad-range "garbage not a range" "$JSX_BLOCKS"
run_watchdog
[ "$WATCHDOG_CODE" -eq 2 ] || fail "bad-range: expected exit 2, got $WATCHDOG_CODE ($WATCHDOG_OUT)"
printf '%s' "$WATCHDOG_OUT" | grep -q "uninterpretable range" || fail "bad-range: missing diagnostic ($WATCHDOG_OUT)"
ok "malformed peer range exits 2"

printf '\nall %d eslint-react peer-exception watchdog checks passed\n' "$PASS"
