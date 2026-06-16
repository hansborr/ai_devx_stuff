#!/usr/bin/env bash
# Pure-shell smoke tests for the slow-test tier wiring.
#
# Verifies three contracts that slice 2 of the cache-budget plan introduces:
#
#   1. Per-package vitest configs exclude `**/*.slow.test.*` so the default
#      `bun run test`/`test:changed`/IDE runners never collect slow files.
#   2. `vitest.slow.config.ts` collects only `**/*.slow.test.{ts,tsx}` files
#      from each package, with the regular `*.test.ts` siblings excluded.
#   3. `scripts/test-slow.sh` sets MUSI_RUN_SLOW_TESTS=1 so test code can
#      gate slow-only setup on the env var.
#
# The smoke uses the repo's real vitest configs and the
# `packages/shared/src/test-tier-sentinel*.test.ts` fixtures so any drift in
# the include/exclude wiring fails this check rather than slipping through
# verify:changed.

set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/test-git-env.sh
. "$SCRIPT_DIR/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
VITEST_BIN="$REPO_ROOT/node_modules/.bin/vitest"
TEST_SLOW_SH="$SCRIPT_DIR/../test-slow.sh"

if [ ! -x "$VITEST_BIN" ]; then
  printf 'test-test-slow: vitest binary not found at %s — run `bun install` first.\n' \
    "$VITEST_BIN" >&2
  exit 2
fi

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }
normalize_vitest_summary() {
  local esc nbsp
  esc="$(printf '\033')"
  nbsp="$(printf '\302\240')"

  printf '%s\n' "$1" | LC_ALL=C sed -E \
    -e "s/${esc}\\[[0-?]*[ -/]*[@-~]//g" \
    -e "s/${nbsp}/ /g"
}

cd "$REPO_ROOT"

# --- 0. Every repo Vitest config sets the default timeout ------------------
timeout_check_output="$(EXPECTED_TEST_TIMEOUT_MS=30000 bun --config=/dev/null --eval '
const expected = Number(process.env.EXPECTED_TEST_TIMEOUT_MS);
const configs = [
  ["root workspace", "./vitest.config.ts"],
  ["shared", "./packages/shared/vitest.config.ts"],
  ["server", "./packages/server/vitest.config.ts"],
  ["client", "./packages/client/vitest.config.ts"],
  ["scripts", "./scripts/vitest.config.ts"],
  ["eslint-rules", "./eslint-rules/vitest.config.ts"],
];
const failures = [];

for (const [name, configPath] of configs) {
  const module = await import(configPath);
  const config = await module.default;
  const actual = config?.test?.testTimeout;
  if (actual !== expected) {
    failures.push(`${name} (${configPath}) test.testTimeout = ${String(actual)}`);
  }
}

const slowModule = await import("./vitest.slow.config.ts");
const slowConfig = await slowModule.default;
for (const project of slowConfig?.test?.projects ?? []) {
  const name = project?.test?.name ?? "unnamed";
  const actual = project?.test?.testTimeout;
  if (actual !== expected) {
    failures.push(`slow ${String(name)} project test.testTimeout = ${String(actual)}`);
  }
}

if (failures.length > 0) {
  throw new Error(`expected every Vitest config test.testTimeout to be ${String(expected)}ms:\n${failures.join("\n")}`);
}
' 2>&1)" \
  || fail "repo Vitest configs should set 30000ms testTimeout: $timeout_check_output"
ok "repo Vitest configs set a 30000ms per-test timeout"

# --- 1. Every package config carries the slow-tier exclude -----------------
# The shared package gets the runtime checks below via the sentinel. For
# server and client we don't keep production sentinel fixtures, so a static
# grep is the smoke against someone deleting the exclude line. test-scripts
# routes server/client vitest config changes to this smoke; without the
# static check, the smoke would only validate `shared`.
for pkg in shared server client; do
  cfg="packages/$pkg/vitest.config.ts"
  grep -qF '"**/*.slow.test.*"' "$cfg" \
    || fail "$cfg should retain '**/*.slow.test.*' in exclude"
  grep -qF "...defaultExclude" "$cfg" \
    || fail "$cfg should preserve defaultExclude alongside the slow pattern"
done
ok "every package vitest.config.ts excludes **/*.slow.test.* alongside defaultExclude"

# --- 2. Default config skips the slow sentinel -----------------------------
default_list="$(MUSI_RUN_SLOW_TESTS='' "$VITEST_BIN" list --project=shared 2>&1)" \
  || fail "vitest list (default) should succeed: $default_list"

if grep -qF 'src/test-tier-sentinel.slow.test.ts' <<< "$default_list"; then
  fail "default vitest config should NOT include slow sentinel: $default_list"
fi
grep -qF 'src/test-tier-sentinel.test.ts' <<< "$default_list" \
  || fail "default vitest config should include regular sentinel: $default_list"
ok "default vitest config excludes *.slow.test.* and keeps regular *.test.ts"

# --- 3. Slow config includes only the slow sentinel ------------------------
slow_list="$(MUSI_RUN_SLOW_TESTS=1 "$VITEST_BIN" list \
  --config "$REPO_ROOT/vitest.slow.config.ts" --project=shared 2>&1)" \
  || fail "vitest list (slow) should succeed: $slow_list"

grep -qF 'src/test-tier-sentinel.slow.test.ts' <<< "$slow_list" \
  || fail "slow vitest config should include slow sentinel: $slow_list"
if grep -qF 'src/test-tier-sentinel.test.ts >' <<< "$slow_list" \
   && ! grep -qF 'src/test-tier-sentinel.slow.test.ts' <<< "$slow_list"; then
  fail "slow vitest config should NOT include regular sentinel: $slow_list"
fi
# Defensive — make sure no non-slow file leaked into the slow tier.
if grep -E 'src/.+\.test\.ts >' <<< "$slow_list" \
   | grep -v '\.slow\.test\.ts' >/dev/null; then
  fail "slow vitest config picked up non-slow files: $slow_list"
fi
ok "slow vitest config includes only *.slow.test.* files"

# --- 4. test:slow wrapper sets MUSI_RUN_SLOW_TESTS=1 -----------------------
# The slow sentinel test asserts MUSI_RUN_SLOW_TESTS=== "1" via expect(); a
# successful run through the wrapper proves both the env wiring and that the
# slow tier picked up the file.
wrapper_output="$(bash "$TEST_SLOW_SH" --project=shared 2>&1)" \
  || fail "test-slow.sh wrapper should succeed: $wrapper_output"
normalized_wrapper_output="$(normalize_vitest_summary "$wrapper_output")"
grep -qF 'Vitest OK: 1 test passed in 1 file.' <<< "$normalized_wrapper_output" \
  || fail "test-slow.sh should compact exactly one slow test passing: $wrapper_output"
if grep -qF 'Test Files' <<< "$normalized_wrapper_output"; then
  fail "test-slow.sh should not print raw passing Vitest summary: $wrapper_output"
fi
ok "test-slow.sh runs only the slow tier with MUSI_RUN_SLOW_TESTS=1"

# --- 5. test-changed.sh emits a hint when *.slow.test.* changes ------------
# Sandboxed mini-repo so we don't have to mutate the real worktree. The hint
# is a stderr line so the rest of test:changed's output keeps its grep-able
# shape; the smoke test asserts the hint is on stderr, not stdout.
SANDBOX="$(mktemp -d /tmp/musi-test-test-slow.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

mkdir -p "$SANDBOX/bin"
cat > "$SANDBOX/bin/vitest" <<'STUB'
#!/usr/bin/env bash
# Pretend vitest succeeded so the wrapper exits 0 and we can examine output.
exit 0
STUB
chmod +x "$SANDBOX/bin/vitest"

repo="$SANDBOX/slow-changed"
mkdir -p "$repo/scripts/ai-hooks" "$repo/scripts/lib" "$repo/packages/server/src"
git -C "$SANDBOX" init -q -b main "$repo"
cp "$SCRIPT_DIR/../test-changed.sh" "$repo/scripts/test-changed.sh"
cp "$SCRIPT_DIR/../vitest.sh" "$repo/scripts/vitest.sh"
cp "$SCRIPT_DIR/../ai-hooks/output-filter.sh" "$repo/scripts/ai-hooks/output-filter.sh"
cp "$SCRIPT_DIR/../lib/changed-base.sh" "$repo/scripts/lib/changed-base.sh"
printf 'base\n' > "$repo/packages/server/src/foo.slow.test.ts"
git -C "$repo" config user.email test@example.com
git -C "$repo" config user.name Test
git -C "$repo" add .
git -C "$repo" commit -qm base

# Modify the slow file so the wrapper sees a changed *.slow.test.* path.
printf 'changed\n' > "$repo/packages/server/src/foo.slow.test.ts"
stdout_file="$SANDBOX/stdout"
stderr_file="$SANDBOX/stderr"
(cd "$repo" && PATH="$SANDBOX/bin:$PATH" bash scripts/test-changed.sh) \
  >"$stdout_file" 2>"$stderr_file" || fail "test-changed should succeed: $(cat "$stderr_file")"

grep -qF 'slow tests changed; run MUSI_RUN_SLOW_TESTS=1 bun run test:slow' "$stderr_file" \
  || fail "expected slow-test hint on stderr; got: $(cat "$stderr_file")"
grep -qF 'packages/server/src/foo.slow.test.ts' "$stderr_file" \
  || fail "expected hint to list the changed slow file; got: $(cat "$stderr_file")"
if grep -qF 'slow tests changed' "$stdout_file"; then
  fail "slow-test hint must go to stderr, not stdout: $(cat "$stdout_file")"
fi
ok "test-changed.sh emits a slow-test hint when *.slow.test.* changes"

# Sanity: a plain server change should NOT emit the slow-test hint, so
# regular changes don't get spammed with the hint.
repo2="$SANDBOX/slow-quiet"
mkdir -p "$repo2/scripts/ai-hooks" "$repo2/scripts/lib" "$repo2/packages/server/src"
git -C "$SANDBOX" init -q -b main "$repo2"
cp "$SCRIPT_DIR/../test-changed.sh" "$repo2/scripts/test-changed.sh"
cp "$SCRIPT_DIR/../vitest.sh" "$repo2/scripts/vitest.sh"
cp "$SCRIPT_DIR/../ai-hooks/output-filter.sh" "$repo2/scripts/ai-hooks/output-filter.sh"
cp "$SCRIPT_DIR/../lib/changed-base.sh" "$repo2/scripts/lib/changed-base.sh"
printf 'base\n' > "$repo2/packages/server/src/regular.test.ts"
git -C "$repo2" config user.email test@example.com
git -C "$repo2" config user.name Test
git -C "$repo2" add .
git -C "$repo2" commit -qm base
printf 'changed\n' > "$repo2/packages/server/src/regular.test.ts"
stderr_file2="$SANDBOX/stderr-quiet"
(cd "$repo2" && PATH="$SANDBOX/bin:$PATH" bash scripts/test-changed.sh) \
  >/dev/null 2>"$stderr_file2" || fail "regular test:changed should succeed: $(cat "$stderr_file2")"
if grep -qF 'slow tests changed' "$stderr_file2"; then
  fail "slow-test hint must NOT fire on regular *.test.ts changes: $(cat "$stderr_file2")"
fi
ok "test-changed.sh stays quiet about slow tests when only regular tests change"

printf 'test-test-slow tests passed (%d)\n' "$PASS"
