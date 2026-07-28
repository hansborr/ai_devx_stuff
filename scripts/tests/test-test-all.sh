#!/usr/bin/env bash
# smoke-order: 250
# smoke-subjects: scripts/test-all.sh
# smoke-subjects: scripts/vitest.sh
# smoke-subjects: scripts/client-test-isolation-runner.ts
# smoke-subjects: scripts/ai-hooks/output-filter.sh
# smoke-subjects: scripts/lib/tool-memory-admission.sh
# smoke-subjects: scripts/lib/test-worker-count.sh
# smoke-subjects: scripts/lib/process-argv.ts
# smoke-subjects: scripts/verify/memory-budget.sh
# smoke-subjects: scripts/verify/admitted-command.sh
# smoke-subjects: scripts/process-tree.sh
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
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=./lib/test-git-env.sh
. "$SCRIPT_DIR/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
TEST_ALL="$SCRIPT_DIR/../test-all.sh"
VITEST_RUNNER="$SCRIPT_DIR/../vitest.sh"
OUTPUT_FILTER="$SCRIPT_DIR/../ai-hooks/output-filter.sh"
TOOL_MEMORY_ADMISSION="$SCRIPT_DIR/../lib/tool-memory-admission.sh"
MEMORY_BUDGET="$SCRIPT_DIR/../verify/memory-budget.sh"
ADMITTED_COMMAND="$SCRIPT_DIR/../verify/admitted-command.sh"
PROCESS_TREE="$SCRIPT_DIR/../process-tree.sh"
TEST_WORKER_COUNT="$SCRIPT_DIR/../lib/test-worker-count.sh"

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
printf 'vitest-env VITEST_MAX_WORKERS=%s NON_SERVER_TEST_MAX_WORKERS=%s\n' \
  "${VITEST_MAX_WORKERS-<unset>}" "${NON_SERVER_TEST_MAX_WORKERS-<unset>}" \
  >> "${STUB_LOG:-/dev/null}"
printf 'translation-env MUSI_TEST_TRANSLATED_CLI_MAX_WORKERS=%s\n' \
  "${MUSI_TEST_TRANSLATED_CLI_MAX_WORKERS-<unset>}" >> "${STUB_LOG:-/dev/null}"
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
    printf 'client-env VITEST_MAX_WORKERS=%s NON_SERVER_TEST_MAX_WORKERS=%s\n' \
      "\${VITEST_MAX_WORKERS-<unset>}" "\${NON_SERVER_TEST_MAX_WORKERS-<unset>}" \
      >> "\${STUB_LOG:-/dev/null}"
    exit "\${STUB_CLIENT_RUNNER_EXIT:-0}"
    ;;
esac
exec "$REAL_BUN" "\$@"
STUB
chmod +x "$SANDBOX/bin/bun"

new_repo() {
  local name="$1"
  local repo="$SANDBOX/$name"
  mkdir -p "$repo/scripts/ai-hooks" "$repo/scripts/lib" "$repo/scripts/verify"
  git -C "$SANDBOX" init -q -b main "$repo"
  cp "$TEST_ALL" "$repo/scripts/test-all.sh"
  cp "$VITEST_RUNNER" "$repo/scripts/vitest.sh"
  cp "$OUTPUT_FILTER" "$repo/scripts/ai-hooks/output-filter.sh"
  cp "$TOOL_MEMORY_ADMISSION" "$repo/scripts/lib/tool-memory-admission.sh"
  cp "$TEST_WORKER_COUNT" "$repo/scripts/lib/test-worker-count.sh"
  cp "$MEMORY_BUDGET" "$repo/scripts/verify/memory-budget.sh"
  cp "$ADMITTED_COMMAND" "$repo/scripts/verify/admitted-command.sh"
  cp "$PROCESS_TREE" "$repo/scripts/process-tree.sh"
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
    # The scripts smoke suite itself may hold a live admission token. These
    # fixture runs exercise direct-entry admission, not nested-tool skipping.
    unset MUSI_VERIFY_MEMORY_ADMISSION_TOKEN
    STUB_LOG="$repo/run.log" \
    MUSI_VERIFY_MEMORY_STATE_ROOT="$SANDBOX/memory-state" \
    PATH="$SANDBOX/bin:$PATH" \
      bash scripts/test-all.sh "$@"
  )
}

bash -n "$TEST_ALL" || fail "test-all.sh fails bash -n"
ok "test-all.sh passes bash -n"

resolved_worker_caps=$(
  cd "$REPO_ROOT"
  MUSI_TEST_TRANSLATED_CLI_MAX_WORKERS=8 VITEST_MAX_WORKERS=8 \
    "$REAL_BUN" -e '
      import { createVitest } from "vitest/node";
      const vitest = await createVitest("test", { watch: false, run: false, maxWorkers: 8 });
      console.log(vitest.projects.map((project) => `${project.name}:${String(project.config.maxWorkers)}`).join("\n"));
      await vitest.close();
    '
) || fail "translated worker config should resolve"
for expected_cap in shared:8 client:8 eslint-rules:8 scripts:8 server:6; do
  grep -qxF "$expected_cap" <<< "$resolved_worker_caps" \
    || fail "translated CLI 8 should resolve $expected_cap: $resolved_worker_caps"
done
ok "translated CLI workers remain scoped to group 0 during Vitest resolution"

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

# A validated CLI worker override must influence admission before Vitest
# dispatches. Use constrained synthetic availability so the
# elevated reservation emits its solo-fallback diagnostic.
repo="$(new_repo cli-worker-cap)"
: > "$repo/run.log"
output="$(MUSI_VERIFY_MEMORY_AVAILABLE_MB=5000 \
  MUSI_VERIFY_MEMORY_ALLOW_SOLO_FALLBACK=1 \
  run_test_all "$repo" --maxWorkers=8 2>&1)" \
  || fail "CLI worker cap 8 should run: $output"
grep -qF 'at its 5580 MB expected peak' <<< "$output" \
  || fail "CLI worker cap 8 should charge the elevated reservation: $output"
grep -qF -- 'stub vitest run --passWithNoTests --project=!client --maxWorkers=8' "$repo/run.log" \
  || fail "CLI worker cap 8 should reach Vitest: $(cat "$repo/run.log")"
grep -qF 'translation-env MUSI_TEST_TRANSLATED_CLI_MAX_WORKERS=8' "$repo/run.log" \
  || fail "CLI worker cap 8 should carry its translation marker: $(cat "$repo/run.log")"
ok "CLI worker cap 8 charges elevated admission"

repo="$(new_repo cli-worker-cap-rejected)"
: > "$repo/run.log"
set +e
output="$(run_test_all "$repo" --maxWorkers=60 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "CLI worker cap 60 should be rejected"
grep -qF 'maxWorkers must be a positive integer from 1 to 8, received "60"' <<< "$output" \
  || fail "CLI worker cap 60 should fail loudly: $output"
[ ! -s "$repo/run.log" ] || fail "rejected CLI worker cap must not dispatch: $(cat "$repo/run.log")"
ok "CLI worker values above the measured maximum are rejected"

repo="$(new_repo cli-worker-malformed)"
: > "$repo/run.log"
set +e
output="$(run_test_all "$repo" --maxWorkers=50% 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "percentage CLI worker cap should be rejected"
grep -qF 'maxWorkers must be a positive integer from 1 to 8, received "50%"' <<< "$output" \
  || fail "percentage CLI worker cap should fail loudly: $output"
[ ! -s "$repo/run.log" ] \
  || fail "rejected percentage worker cap must not dispatch: $(cat "$repo/run.log")"
ok "unparseable CLI worker values fail closed"

repo="$(new_repo native-worker-precedence-elevated)"
: > "$repo/run.log"
output="$(VITEST_MAX_WORKERS=8 NON_SERVER_TEST_MAX_WORKERS=4 \
  MUSI_VERIFY_MEMORY_AVAILABLE_MB=5000 \
  MUSI_VERIFY_MEMORY_ALLOW_SOLO_FALLBACK=1 \
  run_test_all "$repo" --maxWorkers=4 2>&1)" \
  || fail "native worker precedence run should succeed: $output"
grep -qF 'at its 5580 MB expected peak' <<< "$output" \
  || fail "native worker value should outrank the lower CLI value: $output"
grep -qF 'vitest-env VITEST_MAX_WORKERS=8 NON_SERVER_TEST_MAX_WORKERS=4' "$repo/run.log" \
  || fail "CLI translation must not replace inherited native env: $(cat "$repo/run.log")"
ok "native worker env outranks CLI for elevated admission"

repo="$(new_repo native-worker-precedence-lower)"
: > "$repo/run.log"
output="$(VITEST_MAX_WORKERS=4 NON_SERVER_TEST_MAX_WORKERS=8 \
  MUSI_VERIFY_MEMORY_AVAILABLE_MB=5000 \
  run_test_all "$repo" --maxWorkers=8 2>&1)" \
  || fail "lower native worker precedence run should succeed: $output"
if grep -qF 'at its 5580 MB expected peak' <<< "$output"; then
  fail "lower native worker value should outrank the elevated CLI value: $output"
fi
grep -qF 'vitest-env VITEST_MAX_WORKERS=4 NON_SERVER_TEST_MAX_WORKERS=8' "$repo/run.log" \
  || fail "inherited native env must outrank CLI and configured env: $(cat "$repo/run.log")"
ok "native worker env outranks CLI when it lowers admission"

repo="$(new_repo cli-worker-outranks-configured-env)"
: > "$repo/run.log"
output="$(NON_SERVER_TEST_MAX_WORKERS=8 MUSI_VERIFY_MEMORY_AVAILABLE_MB=5000 \
  run_test_all "$repo" --maxWorkers=4 2>&1)" \
  || fail "CLI/configured worker precedence run should succeed: $output"
if grep -qF 'at its 5580 MB expected peak' <<< "$output"; then
  fail "translated CLI worker value should book the default reservation: $output"
fi
grep -qF 'vitest-env VITEST_MAX_WORKERS=4 NON_SERVER_TEST_MAX_WORKERS=8' "$repo/run.log" \
  || fail "CLI value should translate to native env for non-client dispatch: $(cat "$repo/run.log")"
grep -qF 'client-env VITEST_MAX_WORKERS=4 NON_SERVER_TEST_MAX_WORKERS=8' "$repo/run.log" \
  || fail "CLI value should translate to native env for client dispatch: $(cat "$repo/run.log")"
ok "CLI worker value is translated above configured workspace values"

repo="$(new_repo repeated-cli-worker-flag)"
: > "$repo/run.log"
set +e
output="$(run_test_all "$repo" --maxWorkers=8 --maxWorkers=4 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "repeated CLI worker flags should be rejected"
grep -qF 'maxWorkers may be specified only once' <<< "$output" \
  || fail "repeated CLI worker flags should fail loudly: $output"
[ ! -s "$repo/run.log" ] \
  || fail "repeated CLI worker flags must not dispatch: $(cat "$repo/run.log")"
ok "repeated same-spelling CLI worker flags are rejected"

repo="$(new_repo mixed-repeated-cli-worker-flag)"
: > "$repo/run.log"
set +e
output="$(run_test_all "$repo" --maxWorkers=8 --max-workers=4 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "mixed repeated CLI worker flags should be rejected"
grep -qF 'maxWorkers may be specified only once' <<< "$output" \
  || fail "mixed repeated CLI worker flags should fail loudly: $output"
[ ! -s "$repo/run.log" ] \
  || fail "mixed repeated CLI worker flags must not dispatch: $(cat "$repo/run.log")"
ok "mixed-spelling repeated CLI worker flags are rejected"

repo="$(new_repo cli-worker-kebab-alias)"
: > "$repo/run.log"
output="$(MUSI_VERIFY_MEMORY_AVAILABLE_MB=5000 \
  MUSI_VERIFY_MEMORY_ALLOW_SOLO_FALLBACK=1 \
  run_test_all "$repo" --max-workers=8 2>&1)" \
  || fail "kebab-case CLI worker cap 8 should run: $output"
grep -qF 'at its 5580 MB expected peak' <<< "$output" \
  || fail "kebab-case CLI worker cap should charge the elevated reservation: $output"
ok "Vitest's kebab-case CLI worker alias charges elevated admission"

repo="$(new_repo cli-worker-kebab-rejected)"
: > "$repo/run.log"
set +e
output="$(run_test_all "$repo" --max-workers=60 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "kebab-case CLI worker cap 60 should be rejected"
[ ! -s "$repo/run.log" ] \
  || fail "rejected kebab-case worker cap must not dispatch: $(cat "$repo/run.log")"
ok "Vitest's kebab-case CLI worker alias rejects unmeasured values"

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
