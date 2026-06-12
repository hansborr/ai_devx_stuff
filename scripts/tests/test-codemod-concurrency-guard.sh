#!/bin/bash
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
  || fail "concurrency-guard codemod CLI should fail on direct writes"
grep -qF "RawTxClient/raw-tx-boundary ERROR" "$STDOUT" \
  || fail "concurrency-guard codemod CLI did not report RawTxClient boundary: $(cat "$STDOUT")"
grep -qF "Use updateParticipantStatsLocked" "$STDOUT" \
  || fail "concurrency-guard codemod CLI did not report locked-helper suggestion: $(cat "$STDOUT")"

printf 'codemod concurrency-guard CLI smoke passed\n'
