#!/bin/bash
# smoke-order: 120
# smoke-subjects: scripts/codemods/structured-logging-fix-ast.ts
# smoke-subjects: scripts/codemods/structured-logging-fix-transforms.ts
# smoke-subjects: scripts/codemods/structured-logging-fix.ts
# smoke-subjects: scripts/codemods/lib/
# smoke-subjects: scripts/tests/test-codemod-structured-logging-fix.sh
# smoke-subjects: package.json
# smoke-subjects: tsconfig.scripts.json
# Thin CLI smoke test for scripts/codemods/structured-logging-fix.ts.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CODEMOD="$REPO_ROOT/scripts/codemods/structured-logging-fix.ts"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

SANDBOX="$(mktemp -d /tmp/musi-codemod-structured-logging-fix-cli.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

mkdir -p "$SANDBOX/packages/server/src/seed"
printf '%s\n' \
  'export function run(): void {' \
  '  console.log("Seeding things...");' \
  '}' \
  >"$SANDBOX/packages/server/src/seed/seed-thing.ts"

output="$(
  cd "$SANDBOX" && bun "$CODEMOD" "packages/server/src/seed/seed-thing.ts"
)" || fail "structured logging codemod CLI failed"

if [ -n "$output" ]; then
  fail "structured logging codemod CLI should not report unsupported work: $output"
fi
grep -qF 'createScriptLogger' "$SANDBOX/packages/server/src/seed/seed-thing.ts" \
  || fail "structured logging codemod CLI did not add ScriptLogger import"
grep -qF 'logger.info({ event: "script.progress" }, "Seeding things...")' \
  "$SANDBOX/packages/server/src/seed/seed-thing.ts" \
  || fail "structured logging codemod CLI did not rewrite console.log"

printf 'codemod structured-logging-fix CLI smoke passed\n'
