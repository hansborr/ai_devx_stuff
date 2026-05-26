#!/usr/bin/env bash
# Smoke tests for scripts/lint-config-sensors.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./test-git-env.sh
. "$SCRIPT_DIR/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LINT_CONFIG_SENSORS="$SCRIPT_DIR/lint-config-sensors.sh"
VERIFY_METADATA="$SCRIPT_DIR/verify-metadata.sh"
YAMLLINT_CONFIG="$REPO_ROOT/.yamllint.yml"
PATH_POLICY_QUERY="$SCRIPT_DIR/path-policy-query.ts"
PATH_POLICY_QUERY_CORE="$SCRIPT_DIR/path-policy-query-core.ts"
PATH_POLICY="$SCRIPT_DIR/path-policy.ts"
PATH_POLICY_SMOKE_SUBJECTS="$SCRIPT_DIR/path-policy-smoke-subjects.ts"

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

remove_hadolint_cache_unlocked() {
  find "$REPO_ROOT/node_modules/hadolint/.cache/hadolint" -maxdepth 1 -type f \
    -name 'hadolint-*' -delete 2>/dev/null || true
}

remove_hadolint_cache() {
  run_with_hadolint_test_lock remove_hadolint_cache_unlocked
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
  mkdir -p "$repo/scripts" "$repo/.github/workflows" "$repo/.devcontainer" \
    "$repo/.codex/skills/example/agents"
  git -C "$SANDBOX" init -q -b main "$repo"
  cp "$LINT_CONFIG_SENSORS" "$repo/scripts/lint-config-sensors.sh"
  cp "$VERIFY_METADATA" "$repo/scripts/verify-metadata.sh"
  cp "$PATH_POLICY_QUERY" "$repo/scripts/path-policy-query.ts"
  cp "$PATH_POLICY_QUERY_CORE" "$repo/scripts/path-policy-query-core.ts"
  cp "$PATH_POLICY" "$repo/scripts/path-policy.ts"
  cp "$PATH_POLICY_SMOKE_SUBJECTS" "$repo/scripts/path-policy-smoke-subjects.ts"
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
      MUSI_ACTIONLINT_TIMEOUT=8s \
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
remove_hadolint_cache
run_lint_config_sensors "$repo" >/dev/null || fail "clean config sensor set should pass with a fresh hadolint cache"
ok "clean maintained config sensor set passes with a fresh hadolint cache"

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
printf '{"name":"changed-package-full-scan"}\n' > "$repo/package.json"
git -C "$repo" add package.json
set +e
output="$(run_lint_config_sensors "$repo" --changed main 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "package.json full-scan trigger should expose committed TOML violation"
grep -qF 'taplo' <<< "$output" \
  || fail "package.json full-scan trigger should run full TOML sensor set: $output"
ok "changed package.json trigger runs full config sensor set"

printf 'lint-config-sensors tests passed (%d)\n' "$PASS"
