#!/usr/bin/env bash
# smoke-order: 355
# smoke-subjects: scripts/lib/harness-finding.sh
# smoke-subjects: scripts/harness-emit-envelope.ts
# smoke-subjects: scripts/harness/harness-diagnostics-output.ts
# smoke-subjects: scripts/lib/atomic-write.ts
# smoke-subjects: scripts/tests/test-harness-finding.sh
# smoke-subjects: tools/harness-diagnostics/
# Contract smoke for schema-safe shell harness finding emission.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_SH="$SCRIPT_DIR/test-harness-finding.sh"
HELPER="$SCRIPT_DIR/../lib/harness-finding.sh"
EMITTER="$SCRIPT_DIR/../harness-emit-envelope.ts"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

bash -n "$TEST_SH" "$HELPER" || fail "harness finding smoke subjects fail bash -n"
ok "harness finding smoke subjects pass bash -n"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/harness-finding-smoke-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

if ! bash -c '. "$1"' _ "$HELPER" >"$ROOT/source.stdout" 2>"$ROOT/source.stderr"; then
  fail "harness finding helper should be safe to source"
fi
[ ! -s "$ROOT/source.stdout" ] || fail "sourcing harness finding helper wrote to stdout"
[ ! -s "$ROOT/source.stderr" ] || fail "sourcing harness finding helper wrote to stderr"
ok "harness finding helper has no source-time side effects"

EXPECTED_WHY=$'quoted "why" with a backslash \\\nand a tab\there'
EXPECTED_HOW=$'run `bun run module:index` & inspect "output"\nthen retry'
EXPECTED_PATH=$'MODULE "odd"\\INDEX.md'
EXPECTED_MESSAGE_ID=$'module-index-"drift"\\notice'
(
  # shellcheck source=/dev/null
  . "$HELPER"
  emit_harness_finding \
    "doc-generator/module-index" \
    "warn" \
    "$EXPECTED_WHY" \
    "$EXPECTED_HOW" \
    "$EXPECTED_PATH" \
    "$EXPECTED_MESSAGE_ID" \
    "7"
) >"$ROOT/finding.ndjson" || fail "harness finding helper should escape arbitrary field text"
bun run "$EMITTER" --tool module:index:check \
  <"$ROOT/finding.ndjson" >"$ROOT/envelope.json" \
  || fail "escaped harness finding should pass harnessFindingSchema"
ASSERT_FILE="$ROOT/envelope.json" \
EXPECTED_WHY="$EXPECTED_WHY" \
EXPECTED_HOW="$EXPECTED_HOW" \
EXPECTED_PATH="$EXPECTED_PATH" \
EXPECTED_MESSAGE_ID="$EXPECTED_MESSAGE_ID" \
bun -e '
  const fs = require("fs");
  const assertionFailed = (message) => { console.error(message); process.exit(1); };
  const env = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const [finding] = env.findings;
  if (env.findings.length !== 1) assertionFailed(`expected one finding, got ${env.findings.length}`);
  if (finding.why !== process.env.EXPECTED_WHY) assertionFailed(`bad why ${JSON.stringify(finding.why)}`);
  if (finding.howToFix !== process.env.EXPECTED_HOW) assertionFailed(`bad howToFix ${JSON.stringify(finding.howToFix)}`);
  if (finding.path !== process.env.EXPECTED_PATH) assertionFailed(`bad path ${JSON.stringify(finding.path)}`);
  if (finding.line !== 7) assertionFailed(`bad line ${finding.line}`);
  if (finding.messageId !== process.env.EXPECTED_MESSAGE_ID) assertionFailed(`bad messageId ${JSON.stringify(finding.messageId)}`);
' || fail "harness finding helper changed escaped field values"
ok "harness finding helper emits schema-valid escaped JSON"

if (
  # shellcheck source=/dev/null
  . "$HELPER"
  emit_harness_finding \
    "doc-generator/module-index" "warn" "why" "fix" "MODULE-INDEX.md" "line-shape" "seven"
) >"$ROOT/non-numeric-line.out" 2>/dev/null; then
  fail "harness finding helper accepted a non-numeric line"
fi
ok "harness finding helper rejects non-numeric line before jq"

printf 'harness-finding tests passed (%d)\n' "$PASS"
