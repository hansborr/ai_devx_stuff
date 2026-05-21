#!/usr/bin/env bash
# test-harness-emit-envelope.sh - contract smoke for the shared envelope emitter.
#
# The emitter reads newline-delimited findings from stdin and writes a validated
# harness-diagnostics envelope to stdout or --output. This smoke focuses on the
# empty-envelope path because several shell wrappers rely on that contract.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_SH="$SCRIPT_DIR/test-harness-emit-envelope.sh"
EMITTER="$SCRIPT_DIR/harness-emit-envelope.ts"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok()   { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

bash -n "$TEST_SH" || fail "test-harness-emit-envelope.sh fails bash -n"
ok "test-harness-emit-envelope.sh passes bash -n"

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/harness-emit-envelope-smoke-XXXXXX")
trap 'rm -rf "$ROOT"' EXIT

expect_reject() {
  local label="$1" expected="$2"
  shift 2
  local out err rc
  out="$ROOT/$label.out"
  err="$ROOT/$label.err"
  set +e
  bun "$EMITTER" "$@" </dev/null >"$out" 2>"$err"
  rc=$?
  set -e
  [ "$rc" -ne 0 ] || {
    printf 'stdout:\n%s\nstderr:\n%s\n' "$(cat "$out")" "$(cat "$err")"
    fail "$label expected emitter rejection"
  }
  grep -qF "$expected" "$err" || {
    printf 'stderr:\n%s\n' "$(cat "$err")"
    fail "$label missing expected error: $expected"
  }
  grep -qF "usage: bun scripts/harness-emit-envelope.ts" "$err" || {
    printf 'stderr:\n%s\n' "$(cat "$err")"
    fail "$label missing usage text"
  }
}

happy_output="$ROOT/happy-envelope.json"
happy_stdout="$ROOT/happy.stdout"
bun "$EMITTER" --tool lint:agent --output "$happy_output" </dev/null >"$happy_stdout"
[ ! -s "$happy_stdout" ] || {
  printf 'stdout:\n%s\n' "$(cat "$happy_stdout")"
  fail "happy path expected empty stdout when --output is used"
}
[ -f "$happy_output" ] || fail "happy path expected output file"
grep -qF '"tool": "lint:agent"' "$happy_output" || {
  cat "$happy_output"
  fail "happy path missing lint:agent tool"
}
grep -qF '"findings": []' "$happy_output" || {
  cat "$happy_output"
  fail "happy path expected empty findings"
}
ok "--tool lint:agent --output PATH writes an empty envelope to PATH"

expect_reject "output-bare" \
  "harness-emit-envelope: --output requires a path argument" \
  --tool lint:agent --output
ok "--output with no following argv is rejected"

expect_reject "output-followed-by-flag" \
  "harness-emit-envelope: --output requires a path argument" \
  --tool lint:agent --output --tool
ok "--output followed by another flag is rejected"

expect_reject "output-empty" \
  "harness-emit-envelope: --output requires a path argument" \
  --tool lint:agent --output ""
ok "--output with an empty string value is rejected"

expect_reject "output-equals-empty" \
  "harness-emit-envelope: --output= requires a non-empty path" \
  --tool lint:agent --output=
ok "--output= with an empty value is rejected"

expect_reject "output-equals-flag" \
  "harness-emit-envelope: --output= requires a path argument, got: --something" \
  --tool lint:agent --output=--something
ok "--output= with a flag-shaped value is rejected"

expect_reject "tool-bare" \
  "harness-emit-envelope: --tool requires a tool id" \
  --tool
ok "--tool with no following argv is rejected"

expect_reject "tool-followed-by-flag" \
  "harness-emit-envelope: --tool requires a tool id" \
  --tool --output "$ROOT/tool-flag.json"
ok "--tool followed by another flag is rejected"

expect_reject "tool-empty" \
  "harness-emit-envelope: --tool requires a tool id" \
  --tool ""
ok "--tool with an empty string value is rejected"

expect_reject "tool-equals-empty" \
  "harness-emit-envelope: --tool= requires a non-empty tool id" \
  --tool=
ok "--tool= with an empty value is rejected"

expect_reject "tool-equals-flag" \
  "harness-emit-envelope: --tool= requires a tool id, got: --something" \
  --tool=--something
ok "--tool= with a flag-shaped value is rejected"

printf '\n%d/%d tests passed\n' "$PASS" "$PASS"
