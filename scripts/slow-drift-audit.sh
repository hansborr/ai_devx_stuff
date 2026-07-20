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
TIMINGS_FILE="$FUSED_DIR/timings.txt"
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

# Returns non-zero (with explicit guards, so callers may run it under `if !`)
# when the artifact is not a regular file or any write step fails. The fused
# report caller still hard-fails on that via set -e; the mutation caller
# treats it as best-effort.
prepend_metadata_header() {
  local artifact="$1" command="$2" tmp
  [ -f "$artifact" ] || return 1
  tmp="$artifact.tmp.$$"
  write_metadata_header "$tmp" "$command" || return 1
  cat "$artifact" >> "$tmp" || {
    rm -f "$tmp"
    return 1
  }
  mv "$tmp" "$artifact"
}

# --- timing / skip / timeout add-ons (report-only) ---------------------------
# Per-step wall-clock timings are trend evidence for the weekly artifact, not
# verdicts: they never change exit codes. MUSI_SLOW_DRIFT_SKIP names steps to
# disable (comma- or space-separated: lint:ratchet, drift:ai, logs:audit,
# lint-message-eval, mutation; unknown names warn and are otherwise ignored);
# MUSI_SLOW_DRIFT_STEP_TIMEOUT_SECS (unset/0 = unlimited; invalid values warn
# and fall back to unlimited) bounds each step so a hung tool surfaces as an
# infrastructure failure instead of consuming the whole workflow budget, and
# MUSI_SLOW_DRIFT_STEP_KILL_AFTER_SECS (default 30) SIGKILLs a step that
# ignores the timeout's TERM (surfacing as exit 137 in timings.txt).

KNOWN_SKIP_STEPS="lint:ratchet drift:ai logs:audit lint-message-eval mutation"

step_skipped() {
  local skip=",${MUSI_SLOW_DRIFT_SKIP:-},"
  skip="${skip//[[:space:]]/,}"
  case "$skip" in
    *",$1,"*) return 0 ;;
  esac
  return 1
}

warn_unknown_skip_names() {
  local raw name names=()
  raw="${MUSI_SLOW_DRIFT_SKIP:-}"
  raw="${raw//,/ }"
  read -r -a names <<< "$raw" || true
  for name in "${names[@]}"; do
    case " $KNOWN_SKIP_STEPS " in
      *" $name "*) ;;
      *)
        printf 'slow-drift: unknown MUSI_SLOW_DRIFT_SKIP step "%s" ignored (known: %s)\n' \
          "$name" "$KNOWN_SKIP_STEPS" >&2
        ;;
    esac
  done
}

# Validate a *_SECS env value once up front: cooperative knobs must degrade
# loudly (warn + default), never silently disable or corrupt the bound.
validated_secs() {
  local name="$1" value="$2" default="$3"
  case "$value" in
    '' | *[!0-9]*)
      printf 'slow-drift: invalid %s "%s" (want a non-negative integer); using default %s\n' \
        "$name" "$value" "$default" >&2
      printf '%s' "$default"
      ;;
    *) printf '%s' "$value" ;;
  esac
}

STEP_TIMEOUT_SECS=$(validated_secs MUSI_SLOW_DRIFT_STEP_TIMEOUT_SECS \
  "${MUSI_SLOW_DRIFT_STEP_TIMEOUT_SECS:-0}" 0)
STEP_KILL_AFTER_SECS=$(validated_secs MUSI_SLOW_DRIFT_STEP_KILL_AFTER_SECS \
  "${MUSI_SLOW_DRIFT_STEP_KILL_AFTER_SECS:-30}" 30)
MUTATION_TIMEOUT_SECS=$(validated_secs MUSI_SLOW_DRIFT_MUTATION_TIMEOUT_SECS \
  "${MUSI_SLOW_DRIFT_MUTATION_TIMEOUT_SECS:-1800}" 1800)
warn_unknown_skip_names

record_timing() {
  # args: name descriptor ("12s exit=0" or "skipped"). Best-effort by design:
  # timings are trend evidence, and this runs after `set -e` is restored, so
  # an append failure (unwritable path, disk full) must never replace the
  # captured step status with a hard abort.
  printf 'timing: %s %s\n' "$1" "$2" 2>/dev/null >> "$TIMINGS_FILE" || true
}

note_step_skipped() {
  local name="$1" output="$2"
  write_metadata_header "$output" "$name skipped: listed in MUSI_SLOW_DRIFT_SKIP"
  printf 'slow-drift: %s skipped via MUSI_SLOW_DRIFT_SKIP\n' "$name" \
    | tee -a "$output"
  record_timing "$name" "skipped"
}

run_with_step_timeout() {
  if [ "$STEP_TIMEOUT_SECS" -gt 0 ] && command -v timeout >/dev/null 2>&1; then
    # -k: a step that ignores TERM must not hang the lane forever; the
    # follow-up KILL surfaces as exit 137.
    timeout -k "$STEP_KILL_AFTER_SECS" "$STEP_TIMEOUT_SECS" "$@"
  else
    "$@"
  fi
}

note_step_timeout_if_hit() {
  local name="$1" status="$2"
  [ "$STEP_TIMEOUT_SECS" -gt 0 ] || return 0
  if [ "$status" -eq 124 ]; then
    printf 'slow-drift: %s hit the %ss step timeout\n' "$name" "$STEP_TIMEOUT_SECS" >&2
  elif [ "$status" -eq 137 ]; then
    printf 'slow-drift: %s was killed (exit 137) after ignoring the %ss step timeout for %ss\n' \
      "$name" "$STEP_TIMEOUT_SECS" "$STEP_KILL_AFTER_SECS" >&2
  fi
}

run_report_only_producer() {
  local name="$1" envelope="$2" output="$3" status command
  shift 3

  if step_skipped "$name"; then
    note_step_skipped "$name" "$output"
    return 0
  fi

  command=$(format_command "$@")
  printf 'slow-drift: running %s\n' "$name"
  write_metadata_header "$output" "$command"
  local start_epoch end_epoch
  start_epoch=$(date +%s)
  set +e
  HARNESS_DIAGNOSTICS_OUTPUT="$envelope" run_with_step_timeout "$@" >>"$output" 2>&1
  status=$?
  set -e
  end_epoch=$(date +%s)
  record_timing "$name" "$((end_epoch - start_epoch))s exit=$status"
  note_step_timeout_if_hit "$name" "$status"

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

  if step_skipped "lint-message-eval"; then
    note_step_skipped "lint-message-eval" "$output"
    return 0
  fi

  command=$(format_command \
    "$BUN_BIN" run eval:lint-messages \
    --output "$markdown" \
    --json-output "$json")
  printf 'slow-drift: running lint message eval\n'
  write_metadata_header "$output" "$command"
  local start_epoch end_epoch
  start_epoch=$(date +%s)
  set +e
  run_with_step_timeout "$BUN_BIN" run eval:lint-messages \
    --output "$markdown" \
    --json-output "$json" >>"$output" 2>&1
  status=$?
  set -e
  end_epoch=$(date +%s)
  record_timing "lint-message-eval" "$((end_epoch - start_epoch))s exit=$status"
  note_step_timeout_if_hit "lint-message-eval" "$status"
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

# Scoped shared-rules mutation + survivor summary (report-only add-on).
# Off by default because Stryker is minutes-expensive: the weekly workflow
# opts in with MUSI_SLOW_DRIFT_MUTATION=1. Everything after the opt-in is
# trend evidence — a failed, timed-out, or report-less mutation run leaves a
# note in the producer output and the lane continues. thresholds.break stays
# null in stryker.config.mjs, so the score itself can never gate either.
MUTATION_SCOPE="packages/shared/src/rules/**/*.ts,!**/*.test.ts,!**/*.slow.test.ts"

run_mutation_if_enabled() {
  local output="$PRODUCER_DIR/mutation.txt"
  local survivors="$FUSED_DIR/mutation-survivors.txt"
  local report="reports/mutation/mutation.json"
  local timeout_secs="$MUTATION_TIMEOUT_SECS"
  local status command

  # Skip-by-knob and disabled-by-default are different states: the note must
  # not claim "not enabled" when the operator explicitly skipped an enabled
  # step via MUSI_SLOW_DRIFT_SKIP.
  if step_skipped "mutation"; then
    note_step_skipped "mutation" "$output"
    return 0
  fi
  if [ "${MUSI_SLOW_DRIFT_MUTATION:-0}" != "1" ]; then
    write_metadata_header "$output" "mutation skipped: MUSI_SLOW_DRIFT_MUTATION not enabled"
    printf 'slow-drift: mutation step disabled (set MUSI_SLOW_DRIFT_MUTATION=1 to enable); skipping\n' \
      | tee -a "$output" >/dev/null
    record_timing "mutation" "skipped"
    return 0
  fi

  # A stale local report from an earlier run must never be summarized as this
  # run's evidence when the fresh Stryker run fails before writing one.
  rm -f "$report"

  command=$(format_command "$BUN_BIN" run test:mutation --mutate "$MUTATION_SCOPE")
  printf 'slow-drift: running scoped shared-rules mutation (timeout %ss)\n' "$timeout_secs"
  write_metadata_header "$output" "$command"
  local start_epoch end_epoch
  start_epoch=$(date +%s)
  set +e
  if command -v timeout >/dev/null 2>&1; then
    timeout -k "$STEP_KILL_AFTER_SECS" "$timeout_secs" \
      "$BUN_BIN" run test:mutation --mutate "$MUTATION_SCOPE" >>"$output" 2>&1
  else
    "$BUN_BIN" run test:mutation --mutate "$MUTATION_SCOPE" >>"$output" 2>&1
  fi
  status=$?
  set -e
  end_epoch=$(date +%s)
  record_timing "mutation" "$((end_epoch - start_epoch))s exit=$status"

  if [ "$status" -eq 124 ]; then
    printf 'slow-drift: mutation step hit the %ss timeout (report-only; lane continues); see %s\n' \
      "$timeout_secs" "$output"
    return 0
  fi
  if [ "$status" -eq 137 ]; then
    printf 'slow-drift: mutation step was SIGKILLed after the %ss kill-after (exit 137; report-only; lane continues); see %s\n' \
      "$STEP_KILL_AFTER_SECS" "$output"
    return 0
  fi
  if [ "$status" -ne 0 ]; then
    printf 'slow-drift: mutation step exited %s (report-only; lane continues); see %s\n' \
      "$status" "$output"
    return 0
  fi
  if [ ! -s "$report" ]; then
    printf 'slow-drift: mutation step wrote no %s (report-only; lane continues)\n' "$report"
    return 0
  fi

  command=$(format_command "$BUN_BIN" run mutation:survivors --input "$report" --output "$survivors")
  set +e
  "$BUN_BIN" run mutation:survivors --input "$report" --output "$survivors" >>"$output" 2>&1
  status=$?
  set -e
  if [ "$status" -ne 0 ] || [ ! -s "$survivors" ]; then
    printf 'slow-drift: mutation survivor summary failed with exit %s (report-only; lane continues)\n' \
      "$status"
    return 0
  fi
  # Best-effort by contract: the survivors artifact is report-only mutation
  # evidence, so a metadata-prepend failure leaves a note instead of failing
  # the weekly lane under set -e.
  if ! prepend_metadata_header "$survivors" "$command"; then
    printf 'slow-drift: could not prepend metadata header to %s (report-only; lane continues)\n' \
      "$survivors"
    return 0
  fi
  printf 'slow-drift: mutation survivors summarized to %s\n' "$survivors"
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
write_metadata_header "$TIMINGS_FILE" \
  "slow-drift step timings (wall-clock seconds; trend evidence, report-only)"

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
run_mutation_if_enabled

if [ "${#ENVELOPES[@]}" -eq 0 ]; then
  # A non-skipped envelope producer that writes nothing already failed the
  # lane above, so reaching this point with zero envelopes means every
  # envelope producer was deliberately skipped (or logs:audit had no inputs).
  # A deliberate skip-all is a cooperative, degraded-but-green run: note it
  # and end without fusion instead of failing the weekly job. The fail branch
  # stays as a defensive backstop for logic drift.
  if step_skipped "lint:ratchet" && step_skipped "drift:ai"; then
    printf 'slow-drift: all envelope producers were skipped via MUSI_SLOW_DRIFT_SKIP; nothing to fuse (lane ends green)\n'
    exit 0
  fi
  fail "no producer envelopes were written"
fi

write_fused_report text "$FUSED_DIR/harness-audit.txt"
write_fused_report json "$FUSED_DIR/harness-audit.json"

printf 'slow-drift: wrote fused reports to %s and %s\n' \
  "$FUSED_DIR/harness-audit.txt" "$FUSED_DIR/harness-audit.json"
