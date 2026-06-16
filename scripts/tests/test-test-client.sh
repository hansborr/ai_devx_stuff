#!/usr/bin/env bash
# Pure-shell smoke tests for scripts/test-client.sh orchestration behavior.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/test-git-env.sh
. "$SCRIPT_DIR/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
TEST_CLIENT="$SCRIPT_DIR/../test-client.sh"
VITEST_RUNNER="$SCRIPT_DIR/../vitest.sh"
OUTPUT_FILTER="$SCRIPT_DIR/../ai-hooks/output-filter.sh"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

SANDBOX="$(mktemp -d /tmp/musi-test-client-test.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

mkdir -p "$SANDBOX/bin"
REAL_BUN="$(command -v bun)"
cat > "$SANDBOX/bin/vitest" <<'STUB'
#!/usr/bin/env bash
printf 'stub vitest %s\n' "$*" >> "${STUB_LOG:-/dev/null}"
exit "${STUB_VITEST_EXIT:-0}"
STUB
chmod +x "$SANDBOX/bin/vitest"
cat > "$SANDBOX/bin/bun" <<STUB
#!/usr/bin/env bash
case "\${1:-}" in
  */scripts/client-test-isolation-runner.ts|scripts/client-test-isolation-runner.ts)
    shift
    printf 'stub client-test-isolation-runner %s\n' "\$*" >> "\${STUB_LOG:-/dev/null}"
    exit "\${STUB_CLIENT_RUNNER_EXIT:-0}"
    ;;
esac
exec "$REAL_BUN" "\$@"
STUB
chmod +x "$SANDBOX/bin/bun"

new_repo() {
  local name="$1"
  local repo="$SANDBOX/$name"
  mkdir -p "$repo/scripts/ai-hooks"
  git -C "$SANDBOX" init -q -b main "$repo"
  cp "$TEST_CLIENT" "$repo/scripts/test-client.sh"
  cp "$VITEST_RUNNER" "$repo/scripts/vitest.sh"
  cp "$OUTPUT_FILTER" "$repo/scripts/ai-hooks/output-filter.sh"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  git -C "$repo" add .
  git -C "$repo" commit -qm base
  printf '%s\n' "$repo"
}

run_test_client() {
  local repo="$1"; shift
  (
    cd "$repo"
    STUB_LOG="$repo/run.log" PATH="$SANDBOX/bin:$PATH" \
      bash scripts/test-client.sh "$@"
  )
}

bash -n "$TEST_CLIENT" || fail "test-client.sh fails bash -n"
ok "test-client.sh passes bash -n"

repo="$(new_repo default)"
: > "$repo/run.log"
run_test_client "$repo" >/dev/null || fail "default client run should succeed"
grep -qF 'stub client-test-isolation-runner ' "$repo/run.log" \
  || fail "default client run should use split runner: $(cat "$repo/run.log")"
if grep -qF 'stub vitest' "$repo/run.log"; then
  fail "default client run should not invoke direct Vitest: $(cat "$repo/run.log")"
fi
ok "default client run uses split runner"

repo="$(new_repo focused-file)"
: > "$repo/run.log"
run_test_client "$repo" packages/client/src/x.test.tsx >/dev/null \
  || fail "focused client file run should succeed"
grep -qF -- 'stub vitest run --passWithNoTests --project=client packages/client/src/x.test.tsx' "$repo/run.log" \
  || fail "focused client file should run direct client Vitest: $(cat "$repo/run.log")"
if grep -qF 'stub client-test-isolation-runner' "$repo/run.log"; then
  fail "focused client file should not invoke split runner: $(cat "$repo/run.log")"
fi
ok "focused client file path falls back to direct client Vitest"

repo="$(new_repo output-file)"
: > "$repo/run.log"
run_test_client "$repo" --reporter=json --outputFile.json=/tmp/client.json >/dev/null \
  || fail "client output-file run should succeed"
grep -qF -- 'stub vitest run --passWithNoTests --project=client --reporter=json --outputFile.json=/tmp/client.json' "$repo/run.log" \
  || fail "client output-file should run direct client Vitest: $(cat "$repo/run.log")"
if grep -qF 'stub client-test-isolation-runner' "$repo/run.log"; then
  fail "client output-file should not invoke split runner: $(cat "$repo/run.log")"
fi
ok "client output-file reporters fall back to direct client Vitest"

repo="$(new_repo passthrough)"
: > "$repo/run.log"
run_test_client "$repo" --reporter=dot >/dev/null || fail "flag-only client run should succeed"
grep -qF 'stub client-test-isolation-runner --reporter=dot' "$repo/run.log" \
  || fail "flag-only client run should use split runner: $(cat "$repo/run.log")"
ok "plain flags stay on the split path"

printf 'test-client tests passed (%d)\n' "$PASS"
