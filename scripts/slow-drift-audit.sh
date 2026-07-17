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
MESSAGE_EVAL_DIR="$OUTPUT_DIR/message-eval"
RUN_GENERATED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
RUN_HEAD="$(git rev-parse HEAD 2>/dev/null || printf 'unknown')"
RUN_BUN_VERSION="$("$BUN_BIN" --version 2>/dev/null || printf 'unknown')"

ENVELOPES=()
LOG_FILES=()

fail() {
  printf 'slow-drift: %s\n' "$1" >&2
  exit "${2:-2}"
}

resolve_repo_path() {
  case "$1" in
    /*) realpath -m -- "$1" ;;
    *) realpath -m -- "$REPO_ROOT/$1" ;;
  esac
}

assert_safe_output_dir() {
  local reports_root output_path

  reports_root=$(realpath -m -- "$REPO_ROOT/reports")
  output_path=$(resolve_repo_path "$OUTPUT_DIR")

  case "$OUTPUT_DIR" in
    ""|"/"|".")
      fail "refusing unsafe output directory: $OUTPUT_DIR"
      ;;
  esac

  case "$output_path" in
    "$reports_root")
      fail "refusing unsafe output directory: $OUTPUT_DIR resolves to reports root"
      ;;
    "$reports_root"/*)
      ;;
    *)
      fail "refusing unsafe output directory outside $reports_root: $OUTPUT_DIR"
      ;;
  esac
}

reset_output_dirs() {
  assert_safe_output_dir
  rm -rf "$ENVELOPE_DIR" "$PRODUCER_DIR" "$FUSED_DIR" "$MESSAGE_EVAL_DIR"
  mkdir -p "$ENVELOPE_DIR" "$PRODUCER_DIR" "$FUSED_DIR" "$MESSAGE_EVAL_DIR"
}

format_command() {
  local arg command="" quoted

  for arg in "$@"; do
    printf -v quoted '%q' "$arg"
    command="${command}${command:+ }$quoted"
  done
  printf '%s' "$command"
}

write_metadata_header() {
  local output="$1" command="$2"

  {
    printf '# slow-drift generated-at: %s\n' "$RUN_GENERATED_AT"
    printf '# slow-drift head: %s\n' "$RUN_HEAD"
    printf '# slow-drift command: %s\n' "$command"
    printf '# slow-drift bun: %s\n' "$RUN_BUN_VERSION"
    printf '# slow-drift staleness: reports/ is gitignored and local; if this recorded HEAD is not an ancestor of current HEAD, rerun slow-drift or use the latest CI artifact.\n'
    printf '\n'
  } > "$output"
}

write_metadata_sidecar() {
  local artifact="$1" command="$2"
  write_metadata_header "$artifact.meta.txt" "$command"
}

prepend_metadata_header() {
  local artifact="$1" command="$2" tmp
  tmp="$artifact.tmp.$$"
  write_metadata_header "$tmp" "$command"
  cat "$artifact" >> "$tmp"
  mv "$tmp" "$artifact"
}

run_report_only_producer() {
  local name="$1" envelope="$2" output="$3" status command
  shift 3

  command=$(format_command "$@")
  printf 'slow-drift: running %s\n' "$name"
  write_metadata_header "$output" "$command"
  set +e
  HARNESS_DIAGNOSTICS_OUTPUT="$envelope" "$@" >>"$output" 2>&1
  status=$?
  set -e

  if [ ! -s "$envelope" ]; then
    printf 'slow-drift: %s did not write diagnostics envelope %s; see %s\n' \
      "$name" "$envelope" "$output" >&2
    return 2
  fi
  ENVELOPES+=("$envelope")
  write_metadata_sidecar "$envelope" "$command"

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
    write_metadata_header "$PRODUCER_DIR/logs-audit.txt" "logs:audit skipped: no MUSI_SLOW_DRIFT_LOG_FILES"
    printf 'slow-drift: no logs:audit inputs supplied; skipping logs:audit\n' \
      | tee -a "$PRODUCER_DIR/logs-audit.txt" >/dev/null
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

run_lint_message_eval() {
  local markdown="$MESSAGE_EVAL_DIR/latest.md"
  local json="$MESSAGE_EVAL_DIR/latest.json"
  local output="$PRODUCER_DIR/lint-message-eval.txt"
  local command status
  command=$(format_command \
    "$BUN_BIN" run eval:lint-messages \
    --output "$markdown" \
    --json-output "$json")
  printf 'slow-drift: running lint message eval\n'
  write_metadata_header "$output" "$command"
  set +e
  "$BUN_BIN" run eval:lint-messages \
    --output "$markdown" \
    --json-output "$json" >>"$output" 2>&1
  status=$?
  set -e
  if [ "$status" -ne 0 ]; then
    printf 'slow-drift: lint message eval failed with exit %s; see %s\n' "$status" "$output" >&2
    return "$status"
  fi
  if [ ! -s "$markdown" ] || [ ! -s "$json" ]; then
    printf 'slow-drift: lint message eval did not write both reports; see %s\n' "$output" >&2
    return 2
  fi
  write_metadata_sidecar "$markdown" "$command"
  write_metadata_sidecar "$json" "$command"
  printf 'slow-drift: lint message eval completed\n'
}

write_fused_report() {
  local format="$1" output="$2" command
  command=$(format_command "$BUN_BIN" run harness:audit --format "$format" --output "$output" "${ENVELOPES[@]}")
  "$BUN_BIN" run harness:audit \
    --format "$format" \
    --output "$output" \
    "${ENVELOPES[@]}"
  write_metadata_sidecar "$output" "$command"
  if [ "$format" = "text" ]; then
    prepend_metadata_header "$output" "$command"
  fi
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
run_lint_message_eval

if [ "${#ENVELOPES[@]}" -eq 0 ]; then
  fail "no producer envelopes were written"
fi

write_fused_report text "$FUSED_DIR/harness-audit.txt"
write_fused_report json "$FUSED_DIR/harness-audit.json"

printf 'slow-drift: wrote fused reports to %s and %s\n' \
  "$FUSED_DIR/harness-audit.txt" "$FUSED_DIR/harness-audit.json"
