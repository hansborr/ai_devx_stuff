#!/bin/bash
# smoke-order: 150
# smoke-subjects: scripts/codemods/expand-barrel.ts
# smoke-subjects: scripts/codemods/expand-barrel/
# smoke-subjects: scripts/codemods/lib/
# smoke-subjects: scripts/codemods/fixtures/expand-barrel/
# smoke-subjects: scripts/tests/test-codemod-expand-barrel.sh
# smoke-subjects: package.json
# smoke-subjects: tsconfig.scripts.json
# Thin CLI smoke test for scripts/codemods/expand-barrel.ts.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CODEMOD="$REPO_ROOT/scripts/codemods/expand-barrel.ts"
FIXTURE="$REPO_ROOT/scripts/codemods/fixtures/expand-barrel/check-reexport"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

SANDBOX="$(mktemp -d /tmp/musi-codemod-expand-barrel-cli.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

cp -R "$FIXTURE/before/." "$SANDBOX/"

output="$(
  cd "$SANDBOX" && bun "$CODEMOD" --check
)" || fail "expand-barrel codemod CLI failed"

grep -qF "expand-barrel codemod: packages/client/src/public-api.ts:1 re-exports @musi/shared/rules." <<< "$output" \
  || fail "expand-barrel codemod CLI did not report barrel re-export: $output"

printf 'codemod expand-barrel CLI smoke passed\n'
