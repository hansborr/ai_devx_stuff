#!/usr/bin/env bash
# smoke-order: 250
# smoke-subjects: scripts/test-all.sh
# smoke-subjects: scripts/vitest.sh
# smoke-subjects: scripts/client-test-isolation-runner.ts
# smoke-subjects: scripts/ai-hooks/output-filter.sh
# smoke-subjects: scripts/tests/lib/test-git-env.sh
# smoke-subjects: scripts/tests/test-test-all.sh
# Pure-shell smoke tests for scripts/test-all.sh orchestration behavior.
#
# test-all.sh backs `bun run test`: it runs the non-client Vitest projects in
# one direct invocation and the client jsdom suite through the split isolation
# runner, falling back to a single direct Vitest run for coverage / --project
# invocations that the split lanes cannot serve.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/test-git-env.sh
. "$SCRIPT_DIR/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
TEST_ALL="$SCRIPT_DIR/../test-all.sh"
VITEST_RUNNER="$SCRIPT_DIR/../vitest.sh"
OUTPUT_FILTER="$SCRIPT_DIR/../ai-hooks/output-filter.sh"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

SANDBOX="$(mktemp -d /tmp/musi-test-all-test.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

mkdir -p "$SANDBOX/bin"
REAL_BUN="$(command -v bun)"
cat > "$SANDBOX/bin/vitest" <<'STUB'
#!/usr/bin/env bash
printf 'stub vitest %s\n' "$*" >> "${STUB_LOG:-/dev/null}"
if [ "${STUB_VITEST_SUMMARY:-0}" = "1" ]; then
  printf '\n Test Files  1 passed (1)\n'
  printf '      Tests  1 passed (1)\n'
  printf '   Duration  100ms\n'
fi
exit "${STUB_VITEST_EXIT:-0}"
STUB
chmod +x "$SANDBOX/bin/vitest"
# Stub bun so the orchestrator's client-split invocation is observable without
# running the real split runner (its own tests cover lane construction); any
# other bun call delegates to the real binary.
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
  cp "$TEST_ALL" "$repo/scripts/test-all.sh"
  cp "$VITEST_RUNNER" "$repo/scripts/vitest.sh"
  cp "$OUTPUT_FILTER" "$repo/scripts/ai-hooks/output-filter.sh"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  git -C "$repo" add .
  git -C "$repo" commit -qm base
  printf '%s\n' "$repo"
}

run_test_all() {
  local repo="$1"; shift
  (
    cd "$repo"
    STUB_LOG="$repo/run.log" PATH="$SANDBOX/bin:$PATH" \
      bash scripts/test-all.sh "$@"
  )
}

bash -n "$TEST_ALL" || fail "test-all.sh fails bash -n"
ok "test-all.sh passes bash -n"

# Default run: non-client projects in one direct Vitest run, client tests split.
repo="$(new_repo default)"
: > "$repo/run.log"
run_test_all "$repo" >/dev/null || fail "default run should succeed"
grep -qF -- 'stub vitest run --passWithNoTests --project=!client' "$repo/run.log" \
  || fail "default run should run non-client projects directly: $(cat "$repo/run.log")"
grep -qF 'stub client-test-isolation-runner ' "$repo/run.log" \
  || fail "default run should run the client split runner: $(cat "$repo/run.log")"
ok "default run splits non-client Vitest from the client lanes"

# The split runner pins --project=client itself, so it must not be handed one.
if grep -F 'stub client-test-isolation-runner' "$repo/run.log" | grep -qF -- '--project'; then
  fail "client split runner should not receive --project: $(cat "$repo/run.log")"
fi
ok "default run does not pass --project to the client split runner"

# Coverage falls back to one direct Vitest run across every project.
repo="$(new_repo coverage)"
: > "$repo/run.log"
run_test_all "$repo" --coverage >/dev/null || fail "coverage run should succeed"
grep -qF -- 'stub vitest run --passWithNoTests --coverage' "$repo/run.log" \
  || fail "coverage should run all projects on direct Vitest: $(cat "$repo/run.log")"
if grep -qF -- '--project=!client' "$repo/run.log"; then
  fail "coverage fallback should not split out non-client projects: $(cat "$repo/run.log")"
fi
if grep -qF 'stub client-test-isolation-runner' "$repo/run.log"; then
  fail "coverage fallback should not invoke the split runner: $(cat "$repo/run.log")"
fi
ok "coverage args fall back to a single direct Vitest run"

# Explicit --project falls back to one direct Vitest run.
repo="$(new_repo project)"
: > "$repo/run.log"
run_test_all "$repo" --project=server >/dev/null || fail "project run should succeed"
grep -qF -- 'stub vitest run --passWithNoTests --project=server' "$repo/run.log" \
  || fail "explicit --project should run on direct Vitest: $(cat "$repo/run.log")"
if grep -qF -- '--project=!client' "$repo/run.log"; then
  fail "explicit --project should not add the !client split filter: $(cat "$repo/run.log")"
fi
if grep -qF 'stub client-test-isolation-runner' "$repo/run.log"; then
  fail "explicit --project should not invoke the split runner: $(cat "$repo/run.log")"
fi
ok "explicit --project falls back to a single direct Vitest run"

# Forwarded Vitest args reach both the non-client run and the split runner.
repo="$(new_repo passthrough)"
: > "$repo/run.log"
run_test_all "$repo" --reporter=dot >/dev/null || fail "passthrough run should succeed"
grep -qF -- 'stub vitest run --passWithNoTests --project=!client --reporter=dot' "$repo/run.log" \
  || fail "non-client run should receive forwarded args: $(cat "$repo/run.log")"
grep -qF 'stub client-test-isolation-runner --reporter=dot' "$repo/run.log" \
  || fail "client split runner should receive forwarded args: $(cat "$repo/run.log")"
ok "forwarded Vitest args reach both the non-client run and the split runner"

# A focused positional file path (`bun run test -- <file>`) falls back to one
# direct Vitest run: the split runner cannot honor positional file selection.
repo="$(new_repo client-file)"
: > "$repo/run.log"
run_test_all "$repo" packages/client/src/x.test.tsx >/dev/null || fail "focused client file run should succeed"
grep -qF -- 'stub vitest run --passWithNoTests packages/client/src/x.test.tsx' "$repo/run.log" \
  || fail "focused client file should run on direct Vitest: $(cat "$repo/run.log")"
if grep -qF -- '--project=!client' "$repo/run.log"; then
  fail "focused file run should not split out non-client projects: $(cat "$repo/run.log")"
fi
if grep -qF 'stub client-test-isolation-runner' "$repo/run.log"; then
  fail "focused file run should not invoke the split runner: $(cat "$repo/run.log")"
fi
ok "focused client file path falls back to a single direct Vitest run"

repo="$(new_repo nonclient-file)"
: > "$repo/run.log"
run_test_all "$repo" packages/server/src/x.test.ts >/dev/null || fail "focused server file run should succeed"
grep -qF -- 'stub vitest run --passWithNoTests packages/server/src/x.test.ts' "$repo/run.log" \
  || fail "focused server file should run on direct Vitest: $(cat "$repo/run.log")"
if grep -qF 'stub client-test-isolation-runner' "$repo/run.log"; then
  fail "focused server file run should not invoke the split runner: $(cat "$repo/run.log")"
fi
ok "focused non-client file path falls back to a single direct Vitest run"

# Plain flags still forwarded alongside the split path are not mistaken for positionals.
repo="$(new_repo flags-only)"
: > "$repo/run.log"
run_test_all "$repo" --reporter=dot >/dev/null \
  || fail "flag-only run should succeed"
grep -qF -- 'stub vitest run --passWithNoTests --project=!client --reporter=dot' "$repo/run.log" \
  || fail "flag-only run should stay on the split path: $(cat "$repo/run.log")"
grep -qF 'stub client-test-isolation-runner --reporter=dot' "$repo/run.log" \
  || fail "flag-only run should still invoke the split runner: $(cat "$repo/run.log")"
ok "plain flags stay on the split path (not treated as positionals)"

# Output-file reporters must be single-run so later split lanes cannot overwrite
# earlier lane JSON/timing output.
repo="$(new_repo output-file)"
: > "$repo/run.log"
run_test_all "$repo" --reporter=json --outputFile.json=/tmp/x.json >/dev/null \
  || fail "output-file run should succeed"
grep -qF -- 'stub vitest run --passWithNoTests --reporter=json --outputFile.json=/tmp/x.json' "$repo/run.log" \
  || fail "output-file run should use direct Vitest: $(cat "$repo/run.log")"
if grep -qF 'stub client-test-isolation-runner' "$repo/run.log"; then
  fail "output-file run should not invoke the split runner: $(cat "$repo/run.log")"
fi
ok "output-file reporters fall back to a single direct Vitest run"

# A failing non-client run still runs the client split and surfaces its code.
repo="$(new_repo nonclient-failure)"
: > "$repo/run.log"
set +e
output="$(STUB_VITEST_EXIT=7 run_test_all "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -eq 7 ] || fail "non-client failure should surface exit 7 (got $exit_code): $output"
grep -qF 'stub client-test-isolation-runner' "$repo/run.log" \
  || fail "non-client failure should still run the client split: $(cat "$repo/run.log")"
ok "non-client failure surfaces its code and still runs the client split"

# A failing client split surfaces its code even when the non-client run passes.
repo="$(new_repo client-failure)"
: > "$repo/run.log"
set +e
output="$(STUB_CLIENT_RUNNER_EXIT=9 run_test_all "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -eq 9 ] || fail "client failure should surface exit 9 (got $exit_code): $output"
ok "client split failure surfaces its exit code"

# First failing lane wins when both fail.
repo="$(new_repo both-failure)"
: > "$repo/run.log"
set +e
output="$(STUB_VITEST_EXIT=7 STUB_CLIENT_RUNNER_EXIT=9 run_test_all "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -eq 7 ] || fail "first failure (non-client) should win (got $exit_code): $output"
ok "first failing lane determines the exit code"

printf 'test-all tests passed (%d)\n' "$PASS"
