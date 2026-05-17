#!/usr/bin/env bash
# Pure-shell smoke tests for scripts/test-changed.sh selection behavior.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_CHANGED="$SCRIPT_DIR/test-changed.sh"
VITEST_RUNNER="$SCRIPT_DIR/vitest.sh"
OUTPUT_FILTER="$SCRIPT_DIR/ai-hooks/output-filter.sh"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

SANDBOX="$(mktemp -d /tmp/musi-test-changed-test.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

mkdir -p "$SANDBOX/bin"
cat > "$SANDBOX/bin/vitest" <<'STUB'
#!/usr/bin/env bash
printf 'stub vitest %s\n' "$*" >> "${STUB_LOG:-/dev/null}"
if [ "${STUB_VITEST_NOISE:-0}" = "1" ]; then
  printf 'useful before\n'
  printf '(node:123) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.\n'
  printf '(Use `node --trace-deprecation ...` to show where the warning was created)\n'
  printf 'useful after\n'
fi
if [ "${STUB_VITEST_SUMMARY:-0}" = "1" ]; then
  printf '\n Test Files  1 passed (1)\n'
  printf '      Tests  1 passed (1)\n'
  printf '   Duration  100ms\n'
fi
exit "${STUB_VITEST_EXIT:-0}"
STUB
chmod +x "$SANDBOX/bin/vitest"

new_repo() {
  local name="$1"
  local repo="$SANDBOX/$name"
  mkdir -p "$repo/scripts/ai-hooks" "$repo/packages/server/src" "$repo/packages/client/src" "$repo/docs"
  git -C "$SANDBOX" init -q -b main "$repo"
  cp "$TEST_CHANGED" "$repo/scripts/test-changed.sh"
  cp "$VITEST_RUNNER" "$repo/scripts/vitest.sh"
  cp "$OUTPUT_FILTER" "$repo/scripts/ai-hooks/output-filter.sh"
  printf 'export default {};\n' > "$repo/scripts/vitest.config.ts"
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
grep -qF 'stub vitest run --passWithNoTests --project=server --changed main' "$repo/bun.log" \
  || fail "server change should run server project with --changed: $(cat "$repo/bun.log")"
ok "server-only changes run server changed tests"

repo="$(new_repo staged-source-deletion)"
git -C "$repo" rm -q packages/server/src/base.ts
: > "$repo/bun.log"
run_test_changed "$repo" >/dev/null || fail "staged source deletion should run"
grep -qF 'stub vitest run --passWithNoTests --project=server' "$repo/bun.log" \
  || fail "staged source deletion should run server project tests: $(cat "$repo/bun.log")"
if grep -q -- '--changed' "$repo/bun.log"; then
  fail "staged source deletions should run affected project in full: $(cat "$repo/bun.log")"
fi
ok "staged source deletions run affected project tests in full"

repo="$(new_repo script-codemod-change)"
mkdir -p "$repo/scripts/codemods"
printf 'changed\n' > "$repo/scripts/codemods/trpc-shared-input.ts"
git -C "$repo" add scripts/codemods/trpc-shared-input.ts
: > "$repo/bun.log"
run_test_changed "$repo" >/dev/null || fail "codemod script change should run"
grep -qF 'stub vitest run --passWithNoTests --project=scripts' "$repo/bun.log" \
  || fail "codemod script change should run scripts project: $(cat "$repo/bun.log")"
if grep -q -- '--changed' "$repo/bun.log"; then
  fail "codemod script changes should run scripts project in full: $(cat "$repo/bun.log")"
fi
ok "codemod script changes run scripts project tests"

repo="$(new_repo script-code-intel-change)"
printf 'changed\n' > "$repo/scripts/code-intel.ts"
git -C "$repo" add scripts/code-intel.ts
: > "$repo/bun.log"
run_test_changed "$repo" >/dev/null || fail "code-intel script change should run"
grep -qF 'stub vitest run --passWithNoTests --project=scripts' "$repo/bun.log" \
  || fail "code-intel script change should run scripts project: $(cat "$repo/bun.log")"
if grep -q -- '--changed' "$repo/bun.log"; then
  fail "code-intel script changes should run scripts project in full: $(cat "$repo/bun.log")"
fi
ok "code-intel script changes run scripts project tests"

repo="$(new_repo script-drift-ai-change)"
printf 'changed\n' > "$repo/scripts/drift-ai.ts"
git -C "$repo" add scripts/drift-ai.ts
: > "$repo/bun.log"
run_test_changed "$repo" >/dev/null || fail "drift-ai script change should run"
grep -qF 'stub vitest run --passWithNoTests --project=scripts' "$repo/bun.log" \
  || fail "drift-ai script change should run scripts project: $(cat "$repo/bun.log")"
if grep -q -- '--changed' "$repo/bun.log"; then
  fail "drift-ai script changes should run scripts project in full: $(cat "$repo/bun.log")"
fi
ok "drift-ai script changes run scripts project tests"

repo="$(new_repo script-drift-ai-nested-change)"
mkdir -p "$repo/scripts/drift-ai"
printf 'changed\n' > "$repo/scripts/drift-ai/duplicates.ts"
git -C "$repo" add scripts/drift-ai/duplicates.ts
: > "$repo/bun.log"
run_test_changed "$repo" >/dev/null || fail "nested drift-ai script change should run"
grep -qF 'stub vitest run --passWithNoTests --project=scripts' "$repo/bun.log" \
  || fail "nested drift-ai script change should run scripts project: $(cat "$repo/bun.log")"
if grep -q -- '--changed' "$repo/bun.log"; then
  fail "nested drift-ai script changes should run scripts project in full: $(cat "$repo/bun.log")"
fi
ok "nested drift-ai script changes run scripts project tests"

repo="$(new_repo script-drift-ai-fixture-change)"
mkdir -p "$repo/scripts/drift-ai/fixtures"
printf '{}\n' > "$repo/scripts/drift-ai/fixtures/jscpd-report.basic.json"
git -C "$repo" add scripts/drift-ai/fixtures/jscpd-report.basic.json
: > "$repo/bun.log"
run_test_changed "$repo" >/dev/null || fail "drift-ai fixture change should run"
grep -qF 'stub vitest run --passWithNoTests --project=scripts' "$repo/bun.log" \
  || fail "drift-ai fixture change should run scripts project: $(cat "$repo/bun.log")"
if grep -q -- '--changed' "$repo/bun.log"; then
  fail "drift-ai fixture changes should run scripts project in full: $(cat "$repo/bun.log")"
fi
ok "drift-ai fixture changes run scripts project tests"

repo="$(new_repo script-drift-e2e-change)"
mkdir -p "$repo/scripts/drift"
printf 'changed\n' > "$repo/scripts/drift/locator-usage.ts"
git -C "$repo" add scripts/drift/locator-usage.ts
: > "$repo/bun.log"
run_test_changed "$repo" >/dev/null || fail "drift:e2e script change should run"
grep -qF 'stub vitest run --passWithNoTests --project=scripts' "$repo/bun.log" \
  || fail "drift:e2e script change should run scripts project: $(cat "$repo/bun.log")"
if grep -q -- '--changed' "$repo/bun.log"; then
  fail "drift:e2e script changes should run scripts project in full: $(cat "$repo/bun.log")"
fi
ok "drift:e2e script changes run scripts project tests"

repo="$(new_repo script-logs-audit-change)"
printf 'changed\n' > "$repo/scripts/logs-audit.ts"
git -C "$repo" add scripts/logs-audit.ts
: > "$repo/bun.log"
run_test_changed "$repo" >/dev/null || fail "logs-audit script change should run"
grep -qF 'stub vitest run --passWithNoTests --project=scripts' "$repo/bun.log" \
  || fail "logs-audit script change should run scripts project: $(cat "$repo/bun.log")"
if grep -q -- '--changed' "$repo/bun.log"; then
  fail "logs-audit script changes should run scripts project in full: $(cat "$repo/bun.log")"
fi
ok "logs-audit script changes run scripts project tests"

repo="$(new_repo script-logs-audit-test-change)"
printf 'changed\n' > "$repo/scripts/logs-audit.test.ts"
git -C "$repo" add scripts/logs-audit.test.ts
: > "$repo/bun.log"
run_test_changed "$repo" >/dev/null || fail "logs-audit test change should run"
grep -qF 'stub vitest run --passWithNoTests --project=scripts' "$repo/bun.log" \
  || fail "logs-audit test change should run scripts project: $(cat "$repo/bun.log")"
if grep -q -- '--changed' "$repo/bun.log"; then
  fail "logs-audit test changes should run scripts project in full: $(cat "$repo/bun.log")"
fi
ok "logs-audit test changes run scripts project tests"

repo="$(new_repo script-nested-test-change)"
mkdir -p "$repo/scripts/other-tool"
printf 'changed\n' > "$repo/scripts/other-tool/other-tool.test.ts"
git -C "$repo" add scripts/other-tool/other-tool.test.ts
: > "$repo/bun.log"
run_test_changed "$repo" >/dev/null || fail "nested script test change should run"
grep -qF 'stub vitest run --passWithNoTests --project=scripts' "$repo/bun.log" \
  || fail "nested script test change should run scripts project: $(cat "$repo/bun.log")"
if grep -q -- '--changed' "$repo/bun.log"; then
  fail "nested script test changes should run scripts project in full: $(cat "$repo/bun.log")"
fi
ok "nested script test changes run scripts project tests"

repo="$(new_repo script-logs-audit-fixture-change)"
mkdir -p "$repo/scripts/logs-audit/fixtures"
printf '{}\n' > "$repo/scripts/logs-audit/fixtures/server.jsonl"
git -C "$repo" add scripts/logs-audit/fixtures/server.jsonl
: > "$repo/bun.log"
run_test_changed "$repo" >/dev/null || fail "logs-audit fixture change should run"
grep -qF 'stub vitest run --passWithNoTests --project=scripts' "$repo/bun.log" \
  || fail "logs-audit fixture change should run scripts project: $(cat "$repo/bun.log")"
if grep -q -- '--changed' "$repo/bun.log"; then
  fail "logs-audit fixture changes should run scripts project in full: $(cat "$repo/bun.log")"
fi
ok "logs-audit fixture changes run scripts project tests"

repo="$(new_repo scripts-vitest-config)"
printf 'export default { test: {} };\n' > "$repo/scripts/vitest.config.ts"
: > "$repo/bun.log"
output="$(run_test_changed "$repo")" || fail "scripts Vitest config change should run: $output"
if grep -qF 'test:changed: no Vitest-relevant changes' <<< "$output"; then
  fail "scripts Vitest config change should not be skipped: $output"
fi
grep -qF 'stub vitest run --passWithNoTests --project=scripts' "$repo/bun.log" \
  || fail "scripts Vitest config change should run scripts project: $(cat "$repo/bun.log")"
ok "scripts Vitest config changes run scripts project tests"

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
grep -qF 'stub vitest run --passWithNoTests' "$repo/bun.log" \
  || fail "global config should run Vitest: $(cat "$repo/bun.log")"
if grep -q -- '--changed' "$repo/bun.log"; then
  fail "global config should force a full run without --changed: $(cat "$repo/bun.log")"
fi
ok "global config changes force full Vitest run"

repo="$SANDBOX/no-main"
mkdir -p "$repo/scripts/ai-hooks"
git -C "$SANDBOX" init -q "$repo"
cp "$TEST_CHANGED" "$repo/scripts/test-changed.sh"
cp "$VITEST_RUNNER" "$repo/scripts/vitest.sh"
cp "$OUTPUT_FILTER" "$repo/scripts/ai-hooks/output-filter.sh"
: > "$repo/bun.log"
output="$(run_test_changed "$repo" 2>&1)" || fail "missing base should fall back to full suite: $output"
grep -qF "neither 'main' nor 'origin/main' exists" <<< "$output" \
  || fail "missing base fallback should be announced: $output"
grep -qF 'stub vitest run --passWithNoTests' "$repo/bun.log" \
  || fail "missing base should run full Vitest suite: $(cat "$repo/bun.log")"
ok "missing base ref falls back to full Vitest suite"

repo="$(new_repo noisy-output)"
printf 'changed\n' > "$repo/packages/server/src/base.ts"
: > "$repo/bun.log"
set +e
output="$(STUB_VITEST_NOISE=1 STUB_VITEST_EXIT=7 run_test_changed "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -eq 7 ] || fail "noisy failing run should preserve exit 7 (got $exit_code): $output"
grep -qF 'useful before' <<< "$output" || fail "filtered output dropped useful prelude: $output"
grep -qF 'useful after' <<< "$output" || fail "filtered output dropped useful tail: $output"
if grep -qF 'client.query()' <<< "$output"; then
  fail "known pg warning should be filtered from live test output: $output"
fi
ok "test:changed filters known live Vitest noise on failure"

repo="$(new_repo compact-success)"
printf 'changed\n' > "$repo/packages/server/src/base.ts"
: > "$repo/bun.log"
output="$(STUB_VITEST_SUMMARY=1 run_test_changed "$repo")" \
  || fail "compact success run should succeed: $output"
grep -qF 'Vitest OK: 1 test passed in 1 file.' <<< "$output" \
  || fail "passing Vitest output should collapse to a one-line summary: $output"
if grep -qF 'Test Files' <<< "$output"; then
  fail "passing Vitest output should not include raw Test Files summary: $output"
fi
ok "test:changed collapses passing Vitest output"

repo="$(new_repo failing-vitest)"
printf 'changed\n' > "$repo/packages/server/src/base.ts"
: > "$repo/bun.log"
set +e
output="$(STUB_VITEST_EXIT=7 run_test_changed "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -eq 7 ] || fail "Vitest runner should preserve exit 7 (got $exit_code): $output"
ok "test:changed preserves Vitest exit code"

repo="$(new_repo vitest-wrapper-path)"
mkdir -p "$repo/node_modules/.bin"
cat > "$repo/node_modules/.bin/vitest" <<'STUB'
#!/usr/bin/env bash
printf 'repo vitest %s\n' "$*" >> "${STUB_LOG:-/dev/null}"
exit 0
STUB
chmod +x "$repo/node_modules/.bin/vitest"
: > "$repo/bun.log"
(cd "$repo" && PATH=/usr/bin:/bin STUB_LOG="$repo/bun.log" bash scripts/vitest.sh --version) \
  >/dev/null || fail "Vitest wrapper should find repo-local binary without PATH vitest"
grep -qF 'repo vitest --version' "$repo/bun.log" \
  || fail "Vitest wrapper should run repo-local binary: $(cat "$repo/bun.log")"
ok "Vitest wrapper finds repo-local binary without PATH vitest"

printf 'test-changed tests passed (%d)\n' "$PASS"
