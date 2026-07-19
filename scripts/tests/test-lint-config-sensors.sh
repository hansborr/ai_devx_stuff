#!/usr/bin/env bash
# smoke-order: 240
# smoke-subjects: scripts/lint-config-sensors.sh
# smoke-subjects: scripts/tests/test-lint-config-sensors.sh
# smoke-subjects: scripts/lint-changed.sh
# smoke-subjects: scripts/lib/verify-metadata.sh
# smoke-subjects: scripts/lib/changed-base.sh
# smoke-subjects: scripts/lib/changed-lintable-files.sh
# smoke-subjects: scripts/path-policy/path-policy-query.ts
# smoke-subjects: scripts/path-policy/path-policy-query-core.ts
# smoke-subjects: scripts/path-policy/path-policy.ts
# smoke-subjects: scripts/harness/harness-manifest.ts
# smoke-subjects: scripts/harness/harness-paths.ts
# smoke-subjects: scripts/lint-ratchet/paths.ts
# smoke-subjects: scripts/tests/lib/test-git-env.sh
# smoke-subjects: .yamllint.yml
# smoke-subjects: package.json
# smoke-subjects: bun.lock
# smoke-subjects: .github/workflows/
# smoke-subjects: docker-compose.yml
# smoke-subjects: .devcontainer/docker-compose.yml
# smoke-subjects: .devcontainer/Dockerfile
# smoke-subjects: .codex/config.toml
# smoke-subjects: .codex/skills/
# smoke-subjects: bunfig.toml
# Smoke tests for scripts/lint-config-sensors.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/test-git-env.sh
. "$SCRIPT_DIR/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LINT_CONFIG_SENSORS="$SCRIPT_DIR/../lint-config-sensors.sh"
VERIFY_METADATA="$SCRIPT_DIR/../lib/verify-metadata.sh"
# Sandbox copies of verify-metadata.sh resolve the run-meta codec from the
# source tree via the MUSI_VERIFY_META_CORE seam.
export MUSI_VERIFY_META_CORE="$SCRIPT_DIR/../lib/verify-metadata-core.ts"
CHANGED_BASE="$SCRIPT_DIR/../lib/changed-base.sh"
CHANGED_LINTABLE_FILES="$SCRIPT_DIR/../lib/changed-lintable-files.sh"
YAMLLINT_CONFIG="$REPO_ROOT/.yamllint.yml"
PATH_POLICY_QUERY="$SCRIPT_DIR/../path-policy/path-policy-query.ts"
PATH_POLICY_QUERY_CORE="$SCRIPT_DIR/../path-policy/path-policy-query-core.ts"
PATH_POLICY="$SCRIPT_DIR/../path-policy/path-policy.ts"
PATH_POLICY_SMOKE_SUBJECTS="$SCRIPT_DIR/../path-policy/path-policy-smoke-subjects.ts"
PATH_POLICY_SMOKE_SUBJECTS_DATA="$SCRIPT_DIR/../path-policy/path-policy-smoke-subjects-data.ts"
HARNESS_PATHS="$SCRIPT_DIR/../harness/harness-paths.ts"
HARNESS_MANIFEST="$SCRIPT_DIR/../harness/harness-manifest.ts"
LINT_RATCHET_PATHS="$SCRIPT_DIR/../lint-ratchet/paths.ts"
CONFIG_SURFACES="$REPO_ROOT/eslint-config/config-surfaces.js"
CONFIG_SURFACE_MANIFEST="$REPO_ROOT/eslint-config/config-surface-manifest.json"
SHARED_POLICY="$REPO_ROOT/eslint-config/shared-policy.js"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

require_bin() {
  local path="$1"
  local label="$2"
  [ -x "$path" ] || fail "$label unavailable at $path; run bun install"
  printf '%s\n' "$path"
}

require_path_bin() {
  local command_name="$1"
  local hint="$2"
  command -v "$command_name" >/dev/null 2>&1 || fail "$hint"
  command -v "$command_name"
}

hadolint_test_lock_file() {
  local cache_dir="$REPO_ROOT/node_modules/hadolint/.cache/hadolint"
  mkdir -p "$cache_dir"
  printf '%s\n' "$cache_dir/.musi-hadolint.lock"
}

run_with_hadolint_test_lock() {
  local lock_file
  if ! command -v flock >/dev/null 2>&1; then
    "$@"
    return
  fi
  lock_file="$(hadolint_test_lock_file)" || {
    "$@"
    return
  }
  (
    flock 9
    "$@"
  ) 9>"$lock_file"
}

make_hadolint_cache_non_executable_unlocked() {
  local wrapper="$REPO_ROOT/node_modules/.bin/hadolint"
  local cache_file

  "$wrapper" --version >/dev/null 2>&1 || true
  cache_file=$(
    find "$REPO_ROOT/node_modules/hadolint/.cache/hadolint" -maxdepth 1 -type f \
      -name 'hadolint-*' -print -quit 2>/dev/null || true
  )
  [ -n "$cache_file" ] || fail "hadolint cache file was not created"
  chmod 0644 "$cache_file"
}

make_hadolint_cache_non_executable() {
  run_with_hadolint_test_lock make_hadolint_cache_non_executable_unlocked
}

SANDBOX="$(mktemp -d /tmp/musi-lint-config-sensors-test.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

ACTIONLINT_BIN="$(require_bin "$REPO_ROOT/node_modules/.bin/node-actionlint" actionlint)"
TAPLO_BIN="$(require_bin "$REPO_ROOT/node_modules/.bin/taplo" taplo)"
require_bin "$REPO_ROOT/node_modules/.bin/hadolint" hadolint >/dev/null
YAMLLINT_BIN="$(require_path_bin yamllint "yamllint unavailable; install with apt install yamllint")"

new_repo() {
  local name="$1"
  local repo="$SANDBOX/$name"
  mkdir -p "$repo/scripts" "$repo/scripts/lib" "$repo/scripts/path-policy" \
    "$repo/scripts/harness" "$repo/scripts/lint-ratchet" "$repo/.github/workflows" "$repo/.devcontainer" \
    "$repo/.codex/skills/example/agents" "$repo/eslint-config"
  git -C "$SANDBOX" init -q -b main "$repo"
  cp "$LINT_CONFIG_SENSORS" "$repo/scripts/lint-config-sensors.sh"
  cp "$VERIFY_METADATA" "$repo/scripts/lib/verify-metadata.sh"
  cp "$CHANGED_BASE" "$repo/scripts/lib/changed-base.sh"
  cp "$CHANGED_LINTABLE_FILES" "$repo/scripts/lib/changed-lintable-files.sh"
  cp "$PATH_POLICY_QUERY" "$repo/scripts/path-policy/path-policy-query.ts"
  cp "$PATH_POLICY_QUERY_CORE" "$repo/scripts/path-policy/path-policy-query-core.ts"
  cp "$PATH_POLICY" "$repo/scripts/path-policy/path-policy.ts"
  cp "$PATH_POLICY_SMOKE_SUBJECTS" "$repo/scripts/path-policy/path-policy-smoke-subjects.ts"
  cp "$PATH_POLICY_SMOKE_SUBJECTS_DATA" \
    "$repo/scripts/path-policy/path-policy-smoke-subjects-data.ts"
  cp "$HARNESS_PATHS" "$repo/scripts/harness/harness-paths.ts"
  cp "$HARNESS_MANIFEST" "$repo/scripts/harness/harness-manifest.ts"
  cp "$LINT_RATCHET_PATHS" "$repo/scripts/lint-ratchet/paths.ts"
  # @musi/lint-ratchet resolves through the whole-store node_modules symlink
  # created at the end of this function (the package is a root workspace
  # devDependency). Do NOT pre-create $repo/node_modules for a scoped symlink
  # here: an existing directory makes the later `ln -s` nest the store link
  # inside it, silently dropping node_modules/.bin from the sandbox.
  cp "$CONFIG_SURFACES" "$repo/eslint-config/config-surfaces.js"
  cp "$CONFIG_SURFACE_MANIFEST" "$repo/eslint-config/config-surface-manifest.json"
  cp "$SHARED_POLICY" "$repo/eslint-config/shared-policy.js"
  cp "$REPO_ROOT/eslint-config/max-lines-exceptions-codec.js" "$repo/eslint-config/max-lines-exceptions-codec.js"
  cp "$REPO_ROOT/eslint-config/max-lines-exceptions.baseline.json" "$repo/eslint-config/max-lines-exceptions.baseline.json"
  cp "$YAMLLINT_CONFIG" "$repo/.yamllint.yml"
  cat > "$repo/.github/workflows/ci.yml" <<'YML'
name: CI
on:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
YML
  cat > "$repo/docker-compose.yml" <<'YML'
services:
  db:
    image: postgres:17
YML
  cp "$repo/docker-compose.yml" "$repo/.devcontainer/docker-compose.yml"
  cat > "$repo/.codex/skills/example/agents/openai.yaml" <<'YML'
interface:
  display_name: "Example"
  short_description: "Example agent manifest"
  default_prompt: "Use $example to inspect this fixture."
YML
  cat > "$repo/bunfig.toml" <<'TOML'
[install]
auto = "disable"
TOML
  mkdir -p "$repo/.codex"
  cat > "$repo/.codex/config.toml" <<'TOML'
[features]
hooks = true
TOML
  cat > "$repo/package.json" <<'JSON'
{
  "name": "lint-config-sensors-fixture",
  "private": true,
  "config": {
    "hadolint": "2.14.0"
  }
}
JSON
  cat > "$repo/.devcontainer/Dockerfile" <<'DOCKER'
FROM localhost/claude-devcontainer:latest
USER node
DOCKER
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  git -C "$repo" add .
  git -C "$repo" commit -qm base
  ln -s "$REPO_ROOT/node_modules" "$repo/node_modules"
  printf '%s\n' "$repo"
}

run_lint_config_sensors() {
  local repo="$1"; shift
  (
    cd "$repo"
    MUSI_ACTIONLINT_BIN="$ACTIONLINT_BIN" \
      MUSI_ACTIONLINT_TIMEOUT=20s \
      MUSI_TAPLO_BIN="$TAPLO_BIN" \
      bash scripts/lint-config-sensors.sh "$@"
  )
}

bash -n "$LINT_CONFIG_SENSORS" || fail "lint-config-sensors.sh fails bash -n"
ok "lint-config-sensors.sh passes bash -n"

[ "$YAMLLINT_BIN" = "$(command -v yamllint)" ] \
  || fail "yamllint smoke test should use system PATH binary"
ok "yamllint smoke test uses system PATH binary"

repo="$(new_repo clean)"
make_hadolint_cache_non_executable
run_lint_config_sensors "$repo" >/dev/null || fail "clean config sensor set should repair a non-executable hadolint cache"
# Guard against the sensor silently resolving a different hadolint (system
# PATH binary, or the real wrapper via command -v under bun-run PATH): the
# case only counts if the shared cache binary itself was repaired. Without
# this, a broken sandbox node_modules passes vacuously and leaves the shared
# cache non-executable for every later consumer.
repaired_cache="$(
  find "$REPO_ROOT/node_modules/hadolint/.cache/hadolint" -maxdepth 1 -type f \
    -name 'hadolint-*' -print -quit 2>/dev/null || true
)"
[ -n "$repaired_cache" ] && [ -x "$repaired_cache" ] \
  || fail "sensor left the shared hadolint cache non-executable; repair path was not exercised"
ok "clean maintained config sensor set repairs a non-executable hadolint cache"

repo="$(new_repo actionlint-violation)"
cat > "$repo/.github/workflows/ci.yml" <<'YML'
name: Bad
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo "${{ github.nope }}"
YML
set +e
output="$(run_lint_config_sensors "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "actionlint fixture should fail"
grep -qF 'github.nope' <<< "$output" || fail "actionlint output should name invalid expression: $output"
ok "actionlint fails on invalid workflow expression"

repo="$(new_repo actionlint-second-workflow-violation)"
cat > "$repo/.github/workflows/second-bad.yml" <<'YML'
name: Bad Second Workflow
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo "${{ github.nope }}"
YML
set +e
output="$(run_lint_config_sensors "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "second actionlint fixture should fail"
grep -qF '.github/workflows/second-bad.yml' <<< "$output" \
  || fail "actionlint output should name second workflow path: $output"
grep -qF 'github.nope' <<< "$output" \
  || fail "actionlint output should name invalid expression in second workflow: $output"
ok "actionlint fails on invalid second workflow file"

repo="$(new_repo yamllint-violation)"
cat > "$repo/.codex/skills/example/agents/openai.yaml" <<'YML'
interface:
  display_name: "Example"
  short_description: "Example agent manifest"
  default_prompt: "This prompt is deliberately long enough to exceed the configured one hundred and twenty character yamllint line length ceiling for the smoke test."
YML
set +e
output="$(run_lint_config_sensors "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "yamllint fixture should fail"
grep -qF 'line too long' <<< "$output" || fail "yamllint output should name line-length: $output"
ok "yamllint fails on long YAML line"

repo="$(new_repo taplo-violation)"
printf '[install\n' > "$repo/bunfig.toml"
set +e
output="$(run_lint_config_sensors "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "taplo fixture should fail"
grep -Eq 'invalid|expected|error' <<< "$output" || fail "taplo output should show TOML parse failure: $output"
ok "taplo fails on invalid TOML"

repo="$(new_repo hadolint-violation)"
cat > "$repo/.devcontainer/Dockerfile" <<'DOCKER'
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y curl
DOCKER
set +e
output="$(run_lint_config_sensors "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "hadolint fixture should fail"
grep -qF 'DL3008' <<< "$output" || fail "hadolint output should report DL3008: $output"
ok "hadolint fails on unpinned apt package"

repo="$(new_repo missing-hadolint-pin)"
bun -e '
  const path = process.argv[1];
  const pkg = await Bun.file(path).json();
  delete pkg.config.hadolint;
  await Bun.write(path, `${JSON.stringify(pkg, null, 2)}\n`);
' "$repo/package.json"
set +e
output="$(run_lint_config_sensors "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -eq 2 ] || fail "missing config.hadolint should fail unchecked (got $exit_code): $output"
grep -qF 'package.json config.hadolint must be a non-empty string' <<< "$output" \
  || fail "missing hadolint pin should name the effective package field: $output"
ok "requires the effective package.json config.hadolint pin"

repo="$(new_repo combined-config-violations)"
cat > "$repo/.codex/skills/example/agents/openai.yaml" <<'YML'
interface:
  display_name: "Example"
  short_description: "Example agent manifest"
  default_prompt: "This prompt is deliberately long enough to exceed the configured one hundred and twenty character yamllint line length ceiling for the smoke test."
YML
printf '[install\n' > "$repo/bunfig.toml"
cat > "$repo/.devcontainer/Dockerfile" <<'DOCKER'
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y curl
DOCKER
set +e
output="$(run_lint_config_sensors "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "combined config sensor fixture should fail"
grep -qF 'line too long' <<< "$output" \
  || fail "combined output should include yamllint failure: $output"
grep -Eq 'invalid|expected|error' <<< "$output" \
  || fail "combined output should include taplo failure: $output"
grep -qF 'DL3008' <<< "$output" \
  || fail "combined output should include hadolint failure: $output"
ok "config sensors accumulate YAML, TOML, and Dockerfile failures"

repo="$(new_repo changed-toml-violation)"
printf '[install\n' > "$repo/bunfig.toml"
git -C "$repo" add bunfig.toml
set +e
output="$(run_lint_config_sensors "$repo" --changed main 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "changed config sensors should fail on staged TOML violation"
grep -qF 'taplo' <<< "$output" || fail "changed config output should run taplo: $output"
ok "changed config sensor mode fails on staged TOML violation"

repo="$(new_repo changed-package-full-scan)"
printf '[install\n' > "$repo/bunfig.toml"
git -C "$repo" add bunfig.toml
git -C "$repo" commit -qm "commit invalid toml fixture"
printf '{"name":"changed-package-full-scan","config":{"hadolint":"2.14.0"}}\n' > "$repo/package.json"
git -C "$repo" add package.json
set +e
output="$(run_lint_config_sensors "$repo" --changed main 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "package.json full-scan trigger should expose committed TOML violation"
grep -qF 'taplo' <<< "$output" \
  || fail "package.json full-scan trigger should run full TOML sensor set: $output"
ok "changed package.json trigger runs full config sensor set"

repo="$(new_repo selector-crash)"
printf 'process.exit(73);\n' > "$repo/scripts/path-policy/path-policy-query.ts"
set +e
output="$(run_lint_config_sensors "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -eq 2 ] \
  || fail "config sensor selector crash should exit 2 (got $exit_code): $output"
grep -qF 'path selection failed' <<< "$output" \
  || fail "config sensor selector crash should report selection failure: $output"
grep -qF 'no maintained config files found' <<< "$output" \
  && fail "config sensor selector crash should not report an empty selection: $output"
ok "config sensors distinguish selector failure from an empty selection"

repo="$(new_repo git-collector-crash)"
mkdir -p "$repo/failing-git-bin"
cat > "$repo/failing-git-bin/git" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = "ls-files" ]; then
  printf 'injected git ls-files failure\n' >&2
  exit 73
fi
exec "${REAL_GIT:?}" "$@"
STUB
chmod +x "$repo/failing-git-bin/git"
set +e
output=$(
  cd "$repo"
  REAL_GIT="$(command -v git)" \
    PATH="$repo/failing-git-bin:$PATH" \
    MUSI_ACTIONLINT_BIN="$ACTIONLINT_BIN" \
    MUSI_ACTIONLINT_TIMEOUT=20s \
    MUSI_TAPLO_BIN="$TAPLO_BIN" \
    bash scripts/lint-config-sensors.sh 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -eq 2 ] \
  || fail "config git collector crash should exit 2 (got $exit_code): $output"
grep -qF 'injected git ls-files failure' <<< "$output" \
  || fail "config git collector fixture did not reach ls-files: $output"
grep -qF 'path selection failed while collecting repository files' <<< "$output" \
  || fail "config git collector crash should report selection failure: $output"
grep -qF 'no maintained config files found' <<< "$output" \
  && fail "config git collector crash should not report an empty selection: $output"
ok "config sensors propagate git collector failure"

printf 'lint-config-sensors tests passed (%d)\n' "$PASS"
