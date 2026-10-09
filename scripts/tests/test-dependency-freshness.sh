#!/usr/bin/env bash
# smoke-order: 070
# smoke-subjects: scripts/dependency-freshness.sh
# smoke-subjects: scripts/tests/test-dependency-freshness.sh
# Pure-shell tests for dependency freshness status and digest-marker logic.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=/dev/null
. "$SCRIPT_DIR/../dependency-freshness.sh"

PASS=0
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

assert_status() {
  local repo="$1"
  local expected="$2"
  local got
  got="$(musi_dependency_status "$repo")"
  [[ "$got" == "$expected" ]] || fail "expected status $expected, got $got"
}

repo="$TMP_ROOT/repo"
mkdir -p "$repo"

assert_status "$repo" warn
musi_dependency_message "$repo" | grep -qF "no bun.lock" || fail "missing lock message"
ok "missing lockfile reports a warning"

printf 'lock\n' > "$repo/bun.lock"
assert_status "$repo" missing
musi_dependency_message "$repo" | grep -qF "node_modules missing" || fail "missing node_modules message"
ok "missing install reports missing state"

mkdir -p "$repo/node_modules"
assert_status "$repo" stale
musi_dependency_message "$repo" | grep -qF "node_modules/.bin missing" || fail "missing .bin message"
ok "missing install marker reports stale state"

mkdir -p "$repo/node_modules/.bin"
touch -t 202604260101 "$repo/bun.lock"
touch -t 202604260102 "$repo/node_modules/.bin"
assert_status "$repo" fresh
ok "install marker newer than lockfile reports fresh state"

touch -t 202604260103 "$repo/bun.lock"
touch -t 202604260102 "$repo/node_modules/.bin"
assert_status "$repo" stale
musi_dependency_message "$repo" | grep -qF "bun.lock newer" || fail "stale lockfile message"
ok "lockfile newer than install marker reports stale state"

# --- content-digest marker path (mtime-race-immune) -------------------------
# These cases need a digest tool; skip cleanly when none is available so the
# suite still passes on a host without sha256sum/shasum.
if [[ -n "$(musi_dependency_digest "$repo/bun.lock")" ]]; then
  # bun.lock mtime is still NEWER than .bin from the case above — the exact
  # state that tripped the phantom 'stale'. A matching digest marker must
  # override the mtime comparison and report fresh.
  musi_dependency_write_marker "$repo"
  [[ -f "$repo/node_modules/.musi-install-digest" ]] \
    || fail "write_marker did not create digest marker"
  assert_status "$repo" fresh
  ok "matching digest marker reports fresh despite newer lockfile mtime"

  # Mutating bun.lock content (a real dependency change) must flip to stale
  # even though the marker exists.
  printf 'lock changed\n' > "$repo/bun.lock"
  assert_status "$repo" stale
  musi_dependency_message "$repo" | grep -qF "changed since last install" \
    || fail "digest-mismatch stale message"
  ok "digest marker mismatch reports stale after lockfile content change"

  # Re-recording the marker after the change clears the stale signal.
  musi_dependency_write_marker "$repo"
  assert_status "$repo" fresh
  ok "rewriting digest marker after change reports fresh again"

  # A missing .bin still short-circuits to stale before the digest path,
  # even with a marker present.
  rm -rf "$repo/node_modules/.bin"
  assert_status "$repo" stale
  musi_dependency_message "$repo" | grep -qF "node_modules/.bin missing" \
    || fail "missing .bin should win over digest path"
  ok "missing .bin reports stale even when a digest marker exists"
  mkdir -p "$repo/node_modules/.bin"
else
  printf 'ok - digest tool unavailable; skipping content-digest cases\n'
fi

printf 'dependency freshness tests passed\n'
