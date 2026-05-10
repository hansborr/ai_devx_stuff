#!/usr/bin/env bash
# Pure-shell tests for MODULE-INDEX.md generation and drift checks.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GENERATOR="$SCRIPT_DIR/generate-module-index.sh"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

SANDBOX="$(mktemp -d /tmp/musi-module-index-test.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

repo="$SANDBOX/repo"
mkdir -p "$repo/scripts" "$repo/packages/example" "$repo/packages/later"
git -C "$SANDBOX" init -q "$repo"
cp "$GENERATOR" "$repo/scripts/generate-module-index.sh"

cat > "$repo/packages/example/MODULE.md" <<'DOC'
# Example Module

Concepts: presence, campaign rooms, socket broadcasts

Orientation.
DOC

cat > "$repo/packages/later/MODULE.md" <<'DOC'
# Later Concepts Module

Orientation.

Concepts: should not index
DOC

(
  cd "$repo"
  bash scripts/generate-module-index.sh
)
grep -qF '[Example Module](packages/example/MODULE.md) - `packages/example/` - Concepts: presence, campaign rooms, socket broadcasts' \
  "$repo/MODULE-INDEX.md" || fail "generated index missing example module entry"
grep -qF '[Later Concepts Module](packages/later/MODULE.md) - `packages/later/`' \
  "$repo/MODULE-INDEX.md" || fail "generated index missing later module entry"
if grep -qF 'should not index' "$repo/MODULE-INDEX.md"; then
  fail "generated index should ignore non-header concept lines"
fi
ok "write mode generates MODULE-INDEX.md with concept breadcrumbs"

(
  cd "$repo"
  bash scripts/generate-module-index.sh --check
) >"$SANDBOX/check.out" || fail "--check should pass for a fresh index"
grep -qF 'module:index: OK' "$SANDBOX/check.out" \
  || fail "--check did not print OK"
ok "check mode passes when index is current"

perl -0pi -e 's/# Example Module/# Renamed Example Module/; s/Concepts: presence, campaign rooms, socket broadcasts/Concepts: initiative, campaign rooms, socket broadcasts/' \
  "$repo/packages/example/MODULE.md"
set +e
output="$(
  cd "$repo"
  bash scripts/generate-module-index.sh --check 2>&1
)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "--check should fail when indexed module-doc metadata changes"
rg -qF 'Renamed Example Module' <<< "$output" \
  || fail "metadata drift should show the changed H1 in the diff: $output"
rg -qF 'Concepts: initiative, campaign rooms, socket broadcasts' <<< "$output" \
  || fail "metadata drift should show the changed Concepts breadcrumb in the diff: $output"
rg -qF '[Example Module](packages/example/MODULE.md)' "$repo/MODULE-INDEX.md" \
  || fail "--check should not overwrite the stale index after module-doc metadata changes"
ok "check mode fails when indexed module-doc metadata changes"

(
  cd "$repo"
  bash scripts/generate-module-index.sh
)

printf '\nmanual drift\n' >> "$repo/MODULE-INDEX.md"
set +e
output="$(
  cd "$repo"
  bash scripts/generate-module-index.sh --check 2>&1
)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "--check should fail when index drifts"
grep -qF 'MODULE-INDEX.md is out of date' <<< "$output" \
  || fail "drift failure should explain how to regenerate: $output"
grep -qF 'manual drift' "$repo/MODULE-INDEX.md" \
  || fail "--check should not overwrite the existing index"
ok "check mode fails on drift without rewriting"

if (
  cd "$repo"
  bash scripts/generate-module-index.sh --bogus
) >/dev/null 2>&1; then
  fail "unknown argument should fail"
fi
ok "unknown arguments are rejected"

printf 'generate-module-index tests passed (%d)\n' "$PASS"
