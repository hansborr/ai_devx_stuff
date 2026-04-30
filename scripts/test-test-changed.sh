#!/usr/bin/env bash
# Pure-shell smoke tests for scripts/test-changed.sh selection behavior.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_CHANGED="$SCRIPT_DIR/test-changed.sh"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

SANDBOX="$(mktemp -d /tmp/musi-test-changed-test.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

mkdir -p "$SANDBOX/bin"
cat > "$SANDBOX/bin/bun" <<'STUB'
#!/usr/bin/env bash
printf 'stub bun %s\n' "$*" >> "${STUB_LOG:-/dev/null}"
exit 0
STUB
chmod +x "$SANDBOX/bin/bun"

new_repo() {
  local name="$1"
  local repo="$SANDBOX/$name"
  mkdir -p "$repo/scripts" "$repo/packages/server/src" "$repo/packages/client/src" "$repo/docs"
  git -C "$SANDBOX" init -q -b main "$repo"
  cp "$TEST_CHANGED" "$repo/scripts/test-changed.sh"
  printf 'base\n' > "$repo/packages/server/src/base.ts"
  printf 'base\n' > "$repo/packages/client/src/base.ts"
  printf 'base\n' > "$repo/docs/readme.md"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  git -C "$repo" add .
  git -C "$repo" commit -qm base
  printf '%s\n' "$repo"
}

run_test_changed() {
  local repo="$1"; shift
  (
    cd "$repo"
    STUB_LOG="$repo/bun.log" PATH="$SANDBOX/bin:$PATH" \
      bash scripts/test-changed.sh "$@"
  )
}

bash -n "$TEST_CHANGED" || fail "test-changed.sh fails bash -n"
ok "test-changed.sh passes bash -n"

repo="$(new_repo clean)"
: > "$repo/bun.log"
output="$(run_test_changed "$repo")" || fail "clean repo should not fail: $output"
grep -qF 'test:changed: no files changed vs main.' <<< "$output" \
  || fail "clean repo should announce no changed files: $output"
[ ! -s "$repo/bun.log" ] || fail "clean repo should not invoke Vitest"
ok "clean repo skips Vitest"

repo="$(new_repo server-change)"
printf 'changed\n' > "$repo/packages/server/src/base.ts"
: > "$repo/bun.log"
run_test_changed "$repo" >/dev/null || fail "server change should run"
grep -qF 'stub bun run vitest run --passWithNoTests --project=server --changed main' "$repo/bun.log" \
  || fail "server change should run server project with --changed: $(cat "$repo/bun.log")"
ok "server-only changes run server changed tests"

repo="$(new_repo docs-change)"
printf 'changed\n' > "$repo/docs/readme.md"
: > "$repo/bun.log"
output="$(run_test_changed "$repo")" || fail "docs change should not fail: $output"
grep -qF 'test:changed: no Vitest-relevant changes vs main.' <<< "$output" \
  || fail "docs change should announce no relevant changes: $output"
[ ! -s "$repo/bun.log" ] || fail "docs change should not invoke Vitest"
ok "non-Vitest changes skip Vitest"

repo="$(new_repo global-config)"
printf '{}\n' > "$repo/package.json"
git -C "$repo" add package.json
: > "$repo/bun.log"
run_test_changed "$repo" >/dev/null || fail "global config change should run"
grep -qF 'stub bun run vitest run --passWithNoTests' "$repo/bun.log" \
  || fail "global config should run Vitest: $(cat "$repo/bun.log")"
if grep -q -- '--changed' "$repo/bun.log"; then
  fail "global config should force a full run without --changed: $(cat "$repo/bun.log")"
fi
ok "global config changes force full Vitest run"

repo="$SANDBOX/no-main"
mkdir -p "$repo/scripts"
git -C "$SANDBOX" init -q "$repo"
cp "$TEST_CHANGED" "$repo/scripts/test-changed.sh"
: > "$repo/bun.log"
output="$(run_test_changed "$repo" 2>&1)" || fail "missing base should fall back to full suite: $output"
grep -qF "neither 'main' nor 'origin/main' exists" <<< "$output" \
  || fail "missing base fallback should be announced: $output"
grep -qF 'stub bun run vitest run --passWithNoTests' "$repo/bun.log" \
  || fail "missing base should run full Vitest suite: $(cat "$repo/bun.log")"
ok "missing base ref falls back to full Vitest suite"

printf 'test-changed tests passed (%d)\n' "$PASS"
