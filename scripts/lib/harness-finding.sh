#!/usr/bin/env bash

# Emit one NDJSON harness finding to stdout.
# The shared schema owns validation for values it can receive intact; validate
# here only when an earlier Bash/jq failure would give a materially worse error.
# args: control severity why howToFix [path] [messageId] [line]
emit_harness_finding() {
  local control="$1" severity="$2" why="$3" how_to_fix="$4"
  local path="${5:-}" message_id="${6:-}" line="${7:-}"

  if [[ -n "$line" ]] && ! [[ "$line" =~ ^[0-9]+$ ]]; then
    printf 'emit_harness_finding: non-numeric line %q\n' "$line" >&2
    return 1
  fi

  jq -nc \
    --arg control "$control" \
    --arg severity "$severity" \
    --arg why "$why" \
    --arg howToFix "$how_to_fix" \
    --arg path "$path" \
    --arg line "$line" \
    --arg messageId "$message_id" \
    '{control:$control,severity:$severity,why:$why,howToFix:$howToFix,repairKind:"manual"}
      + (if $path == "" then {} else {path:$path} end)
      + (if $line == "" then {} else {line:($line | tonumber)} end)
      + (if $messageId == "" then {} else {messageId:$messageId} end)'
}
