#!/bin/bash
# smoke-order: 160
# smoke-subjects: scripts/codemods/concurrency-guard.ts
# smoke-subjects: scripts/codemods/concurrency-guard/
# smoke-subjects: scripts/codemods/lib/
# smoke-subjects: scripts/lib/path-taxonomy.ts
# smoke-subjects: scripts/codemods/fixtures/concurrency-guard/
# smoke-subjects: scripts/tests/test-codemod-concurrency-guard.sh
# smoke-subjects: package.json
# smoke-subjects: tsconfig.scripts.json
# Thin CLI smoke test for scripts/codemods/concurrency-guard.ts.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CODEMOD="$REPO_ROOT/scripts/codemods/concurrency-guard.ts"
FIXTURE="$REPO_ROOT/scripts/codemods/fixtures/concurrency-guard/direct-write-and-raw-import"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

SANDBOX="$(mktemp -d /tmp/musi-codemod-concurrency-guard-cli.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

cp -R "$FIXTURE/before/." "$SANDBOX/"

STDOUT="$SANDBOX/stdout"
STDERR="$SANDBOX/stderr"
status=0
(
  cd "$SANDBOX" && bun "$CODEMOD" --check >"$STDOUT" 2>"$STDERR"
) || status=$?

[ "$status" -ne 0 ] \
  || fail "concurrency-guard scanner CLI should fail on direct writes"
grep -qF "RawTxClient/raw-tx-boundary ERROR" "$STDOUT" \
  || fail "concurrency-guard scanner CLI did not report RawTxClient boundary: $(cat "$STDOUT")"
grep -qF "Route encounterParticipant writes through updateParticipantStatsLocked" "$STDOUT" \
  || fail "concurrency-guard scanner CLI did not report locked-helper suggestion: $(cat "$STDOUT")"

printf 'codemod concurrency-guard CLI smoke passed\n'
