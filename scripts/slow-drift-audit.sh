#!/usr/bin/env bash
# Weekly slow-drift diagnostics driver for the scheduled GitHub Actions lane.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
cd "$REPO_ROOT"

BUN_BIN="${MUSI_SLOW_DRIFT_BUN:-bun}"
OUTPUT_DIR="${MUSI_SLOW_DRIFT_OUTPUT_DIR:-reports/slow-drift}"
ENVELOPE_DIR="$OUTPUT_DIR/envelopes"
PRODUCER_DIR="$OUTPUT_DIR/producers"
FUSED_DIR="$OUTPUT_DIR/fused"

ENVELOPES=()
LOG_FILES=()

fail() {
  printf 'slow-drift: %s\n' "$1" >&2
  exit "${2:-2}"
}

reset_output_dirs() {
  case "$OUTPUT_DIR" in
    ""|"/"|".")
      fail "refusing unsafe output directory: $OUTPUT_DIR"
      ;;
  esac

  rm -rf "$ENVELOPE_DIR" "$PRODUCER_DIR" "$FUSED_DIR"
  mkdir -p "$ENVELOPE_DIR" "$PRODUCER_DIR" "$FUSED_DIR"
}

run_report_only_producer() {
  local name="$1" envelope="$2" output="$3" status
  shift 3

  printf 'slow-drift: running %s\n' "$name"
  set +e
  HARNESS_DIAGNOSTICS_OUTPUT="$envelope" "$@" >"$output" 2>&1
  status=$?
  set -e

  if [ ! -s "$envelope" ]; then
    printf 'slow-drift: %s did not write diagnostics envelope %s; see %s\n' \
      "$name" "$envelope" "$output" >&2
    return 2
  fi
  ENVELOPES+=("$envelope")

  if [ "$status" -eq 0 ]; then
    printf 'slow-drift: %s completed\n' "$name"
    return 0
  fi
  if [ "$status" -eq 1 ]; then
    printf 'slow-drift: %s reported findings; continuing because this lane is report-only\n' "$name"
    return 0
  fi

  printf 'slow-drift: %s failed with exit %s; see %s\n' "$name" "$status" "$output" >&2
  return "$status"
}

read_log_files_from_env() {
  local file
  [ -n "${MUSI_SLOW_DRIFT_LOG_FILES:-}" ] || return 0

  while IFS= read -r file || [ -n "$file" ]; do
    [ -n "$file" ] || continue
    LOG_FILES+=("$file")
  done <<< "$MUSI_SLOW_DRIFT_LOG_FILES"
}

run_logs_audit_if_configured() {
  local args=() file

  read_log_files_from_env
  if [ "${#LOG_FILES[@]}" -eq 0 ]; then
    printf 'slow-drift: no logs:audit inputs supplied; skipping logs:audit\n' \
      | tee "$PRODUCER_DIR/logs-audit.txt" >/dev/null
    return 0
  fi

  for file in "${LOG_FILES[@]}"; do
    args+=(--file "$file")
  done
  run_report_only_producer \
    "logs:audit" \
    "$ENVELOPE_DIR/logs-audit.json" \
    "$PRODUCER_DIR/logs-audit.txt" \
    "$BUN_BIN" run logs:audit "${args[@]}"
}

write_fused_report() {
  local format="$1" output="$2"
  "$BUN_BIN" run harness:audit \
    --format "$format" \
    --output "$output" \
    "${ENVELOPES[@]}"
}

reset_output_dirs

run_report_only_producer \
  "lint:ratchet" \
  "$ENVELOPE_DIR/lint-ratchet.json" \
  "$PRODUCER_DIR/lint-ratchet.txt" \
  "$BUN_BIN" run lint:ratchet

run_report_only_producer \
  "drift:ai" \
  "$ENVELOPE_DIR/drift-ai.json" \
  "$PRODUCER_DIR/drift-ai.txt" \
  "$BUN_BIN" run drift:ai --scope current --check all

run_logs_audit_if_configured

if [ "${#ENVELOPES[@]}" -eq 0 ]; then
  fail "no producer envelopes were written"
fi

write_fused_report text "$FUSED_DIR/harness-audit.txt"
write_fused_report json "$FUSED_DIR/harness-audit.json"

printf 'slow-drift: wrote fused reports to %s and %s\n' \
  "$FUSED_DIR/harness-audit.txt" "$FUSED_DIR/harness-audit.json"
