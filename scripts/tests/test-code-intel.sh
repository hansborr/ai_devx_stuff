#!/usr/bin/env bash
# smoke-order: 170
# smoke-subjects: scripts/code-intel.ts
# smoke-subjects: scripts/code-intel-server.ts
# smoke-subjects: scripts/code-intel/
# smoke-subjects: scripts/tests/test-code-intel.sh
# smoke-subjects: scripts/vitest.config.ts
# smoke-subjects: package.json
# smoke-subjects: tsconfig.scripts.json
# smoke-subjects: packages/shared/package.json
# smoke-subjects: packages/server/package.json
# smoke-subjects: packages/client/tsconfig.json
# Smoke tests for the one-shot code:intel CLI and the code:intel:server
# lifecycle CLI.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" == *"$needle"* ]]; then
    return 0
  fi
  printf 'expected output to contain: %s\n' "$needle" >&2
  exit 1
}

exports_output="$(bun run code:intel -- exports packages/shared/src/schemas/character.ts)"
assert_contains "$exports_output" "characterDetailSchema value export"

dependents_output="$(bun run code:intel -- dependents packages/shared/src/schemas/character.ts)"
assert_contains "$dependents_output" "packages/server/"

# Lifecycle smoke. Always finish by stopping any running daemon so repeat
# invocations stay clean.
cleanup() {
  bun run code:intel:server -- stop >/dev/null 2>&1 || true
}
trap cleanup EXIT

bun run code:intel:server -- stop >/dev/null
status_absent="$(bun run code:intel:server -- status)"
assert_contains "$status_absent" "absent"

oneshot_dependents="$(bun run code:intel -- dependents packages/shared/src/schemas/character.ts --depth 1 --format json)"
status_after_oneshot="$(bun run code:intel:server -- status)"
assert_contains "$status_after_oneshot" "absent"

restart_output="$(bun run code:intel:server -- restart)"
assert_contains "$restart_output" "started"

status_running="$(bun run code:intel:server -- status)"
assert_contains "$status_running" "running"

daemon_dependents="$(bun run code:intel -- dependents packages/shared/src/schemas/character.ts --depth 1 --format json)"
if [[ "$daemon_dependents" != "$oneshot_dependents" ]]; then
  printf 'daemon-backed and absent-daemon one-shot dependents output diverged\n' >&2
  exit 1
fi

stop_output="$(bun run code:intel:server -- stop)"
assert_contains "$stop_output" "stopped"

status_after_stop="$(bun run code:intel:server -- status)"
assert_contains "$status_after_stop" "absent"

oneshot_after_stop="$(bun run code:intel -- dependents packages/shared/src/schemas/character.ts --depth 1 --format json)"
if [[ "$oneshot_after_stop" != "$oneshot_dependents" ]]; then
  printf 'daemon-backed and one-shot dependents output diverged\n' >&2
  exit 1
fi

printf 'code-intel smoke passed\n'
