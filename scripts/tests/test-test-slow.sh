#!/usr/bin/env bash
# smoke-order: 280
# smoke-subjects: scripts/test-slow.sh
# smoke-subjects: scripts/test-changed.sh
# smoke-subjects: scripts/vitest.sh
# smoke-subjects: scripts/lib/changed-base.sh
# smoke-subjects: scripts/lib/test-worker-count.sh
# smoke-subjects: scripts/ai-hooks/output-filter.sh
# smoke-subjects: scripts/tests/lib/test-git-env.sh
# smoke-subjects: vitest.config.ts
# smoke-subjects: vitest.slow.config.ts
# smoke-subjects: packages/shared/vitest.config.ts
# smoke-subjects: packages/server/vitest.config.ts
# smoke-subjects: packages/server/src/test/vitest-project-options.ts
# smoke-subjects: packages/client/vitest.config.ts
# smoke-subjects: scripts/vitest.config.ts
# smoke-subjects: eslint-rules/vitest.config.ts
# smoke-subjects: packages/shared/src/test-tier-sentinel.test.ts
# smoke-subjects: packages/shared/src/test-tier-sentinel.slow.test.ts
# smoke-subjects: scripts/tests/test-test-slow.sh
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

# The import-closure walker moved from top-level scripts/*.ts into its owner
# directory, so keep the production family in the scripts coverage denominator.
grep -qF '"import-closure/**/*.ts"' scripts/vitest.config.ts \
  || fail "scripts/vitest.config.ts should collect import-closure production coverage"
ok "scripts Vitest coverage includes the import-closure module"

# --- 1. Every package project carries the slow-tier exclude ----------------
# The shared package gets the runtime checks below via the sentinel. For
# server and client we don't keep production sentinel fixtures, so this
# resolves each package's Vitest config and asserts the *composed*
# `test.exclude` still carries the slow pattern alongside every
# `defaultExclude` entry. Resolving beats grepping the config text: the
# server project now builds its exclude from `SERVER_TEST_EXCLUDE` in
# `packages/server/src/test/vitest-project-options.ts`, so neither literal
# appears in `packages/server/vitest.config.ts` any more — but deleting the
# pattern from the shared module, or stopping the config composing it, still
# fails here. Config evaluation needs no database (see the header of
# `vitest-project-options.ts`). test-scripts routes changes to every file in
# that chain to this smoke via the `# smoke-subjects:` headers above.
exclude_check_output="$(bun --config=/dev/null --eval '
import { defaultExclude } from "vitest/config";

const failures = [];

for (const pkg of ["shared", "server", "client"]) {
  const configPath = `./packages/${pkg}/vitest.config.ts`;
  const module = await import(configPath);
  const config = await module.default;
  const exclude = config?.test?.exclude;

  if (!Array.isArray(exclude)) {
    failures.push(`${configPath} test.exclude is not an array: ${String(exclude)}`);
    continue;
  }
  if (!exclude.includes("**/*.slow.test.*")) {
    failures.push(`${configPath} drops "**/*.slow.test.*": ${JSON.stringify(exclude)}`);
  }
  const missing = defaultExclude.filter((pattern) => !exclude.includes(pattern));
  if (missing.length > 0) {
    failures.push(
      `${configPath} drops defaultExclude ${JSON.stringify(missing)}: ${JSON.stringify(exclude)}`,
    );
  }
}

if (failures.length > 0) {
  throw new Error(`every package Vitest project must exclude the slow tier alongside defaultExclude:\n${failures.join("\n")}`);
}
' 2>&1)" \
  || fail "package Vitest projects should exclude the slow tier: $exclude_check_output"
ok "every package vitest project excludes **/*.slow.test.* alongside defaultExclude"

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
cp "$SCRIPT_DIR/../lib/test-worker-count.sh" "$repo/scripts/lib/test-worker-count.sh"
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
cp "$SCRIPT_DIR/../lib/test-worker-count.sh" "$repo2/scripts/lib/test-worker-count.sh"
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

# --- 6. Slow config derives package roots from a filesystem path ----------
# `vitest.slow.config.ts` anchors all three package projects to the directory
# holding the config. Deriving that directory from a file URL's `pathname`
# keeps percent-encoding (`dir with space` -> `dir%20with%20space`), so every
# project root points at a path that does not exist. Copy the config into a
# sandbox directory whose name contains a space, symlink the sibling files it
# imports, and assert the resolved roots are real directories.
spaced_dir="$SANDBOX/dir with space"
mkdir -p "$spaced_dir"
cp "$REPO_ROOT/vitest.slow.config.ts" "$spaced_dir/vitest.slow.config.ts"
for entry in packages node_modules vitest.config.ts package.json; do
  ln -s "$REPO_ROOT/$entry" "$spaced_dir/$entry"
done

spaced_root_output="$(SPACED_CONFIG="$spaced_dir/vitest.slow.config.ts" bun --config=/dev/null --eval '
import { existsSync } from "node:fs";

const module = await import(process.env.SPACED_CONFIG);
const config = await module.default;
const projects = config?.test?.projects ?? [];
const failures = [];

if (projects.length !== 3) {
  failures.push(`expected 3 slow projects, got ${projects.length}`);
}

for (const project of projects) {
  const root = project?.root;
  if (typeof root !== "string") {
    failures.push(`project root is not a string: ${String(root)}`);
    continue;
  }
  if (root.includes("%")) {
    failures.push(`project root keeps URL percent-encoding: ${root}`);
    continue;
  }
  if (!existsSync(root)) {
    failures.push(`project root does not exist on disk: ${root}`);
  }
}

if (failures.length > 0) {
  throw new Error(`slow-tier project roots must be filesystem paths:\n${failures.join("\n")}`);
}
' 2>&1)" \
  || fail "slow config should resolve project roots under a path with a space: $spaced_root_output"
ok "slow config derives package roots as filesystem paths, not URL pathnames"

# --- 7. Coverage denominators exclude test scaffolding --------------------
# Coverage thresholds are only interpretable if the denominator is production
# code. Test-support modules are executed by the suites that import them, so
# leaving them in the covered set inflates coverage without covering behavior
# - and it contradicts `stryker.config.mjs`, which already classifies
# `packages/shared/src/test/**` as scaffolding with no behavior worth mutating.
# In projects mode Vitest resolves coverage from the root config alone, so the
# root `coverage.exclude` is the only list that decides the real denominator;
# the per-project blocks apply solely to standalone `vitest --config
# packages/<pkg>/vitest.config.ts` runs and are not checked here.
#
# The enumerator mirrors the root exclude's own conventions, so it catches one
# reachable regression: a pattern dropped from the root exclude. It cannot see a
# scaffolding family that outgrows those conventions entirely (a new
# `src/testing/` directory, a `*.mock-helper.ts` spelling) - such a family is
# invisible to this selector too, and only a reader adds it here.
#
# `eslint-rules`' three test-support modules have production-looking filenames
# and are identifiable only by import topology, so they are named literally in
# both the root exclude and this list. Asserting they still exist turns a rename
# into a loud failure rather than a silently orphaned exclude pattern.
eslint_rules_support=""
for support_path in \
  eslint-rules/rule-tester.js \
  eslint-rules/repo-config-harness.js \
  eslint-rules/eslint-config-resolution-timeout.js; do
  [ -f "$support_path" ] \
    || fail "named eslint-rules test-support module no longer exists: $support_path"
  eslint_rules_support="$eslint_rules_support$support_path
"
done
scaffolding_paths="$(git ls-files \
  '*test-helper.ts' '*test-helper.tsx' 'packages/*/src/test/*' 'tools/lint-ratchet/test/*' \
  | grep -v '/worktrees/' \
  | grep -E '\.tsx?$' \
  | grep -v '\.test\.tsx\?$')" \
  || fail "expected to find test-scaffolding files to check"
scaffolding_paths="$scaffolding_paths
$eslint_rules_support"

coverage_check_output="$(SCAFFOLDING_PATHS="$scaffolding_paths" bun --config=/dev/null --eval '
const scaffolding = (process.env.SCAFFOLDING_PATHS ?? "").split("\n").filter(Boolean);
const failures = [];
const matchesAny = (patterns, candidate) =>
  (patterns ?? []).some((pattern) => new Bun.Glob(pattern).match(candidate));

const rootModule = await import("./vitest.config.ts");
const rootConfig = await rootModule.default;
const rootExclude = rootConfig?.test?.coverage?.exclude;
for (const filePath of scaffolding) {
  if (!matchesAny(rootExclude, filePath)) {
    failures.push(`root coverage.exclude does not cover scaffolding file ${filePath}`);
  }
}

// Scaffolding imported as `@musi/shared/test/*.js` is recorded against
// `packages/shared/dist/` and only reaches a `src/` path through the source
// map, so the excludes have to be applied again after that remap.
if (rootConfig?.test?.coverage?.excludeAfterRemap !== true) {
  failures.push("root coverage.excludeAfterRemap must be true");
}

if (failures.length > 0) {
  throw new Error(`coverage denominator must exclude test scaffolding:\n${failures.join("\n")}`);
}
' 2>&1)" \
  || fail "root coverage config should exclude test scaffolding: $coverage_check_output"
ok "root coverage.exclude covers every enumerated test-scaffolding module"

printf 'test-test-slow tests passed (%d)\n' "$PASS"
