#!/bin/bash
# verify-logs.sh — viewer for verification task logs.
#
# Surfaces the latest log path, age, exit/state (when a marker exists), and a
# tail for each verification task without making contributors copy paths out
# of AI summaries. Reads from two log sources:
#
#   - Pre-commit / verify wrapper logs written by `.husky/pre-commit` and
#     `scripts/verify.sh`. No per-task marker — the per-run `LAST_TS` lives
#     in the worktree-scoped verify/pre-commit marker.
#   - Bun-run-quiet hook logs with per-script `last.<script>` markers
#     (LAST_TS / LAST_FP / LAST_EXIT) that record each run's exit code.
#
# Whichever log is newer (by mtime) wins for "latest". The bun-logs marker
# (when present) supplies the exit code.
#
# Usage:
#   bun run verify:logs                  # summary table for lint/typecheck/test/e2e
#   bun run verify:logs <task>           # focused view with longer tail
#   bun run verify:logs <task> --full    # print the full log to stdout
#   bun run verify:logs budget           # verification cache-budget timings
#   bun run verify:logs slow-tests       # top slow Vitest files and cases
#
# Env (tests only):
#   MUSI_VERIFY_STATE_ROOT / MUSI_VERIFY_LOG_DIR / AI_BUN_LOG_DIR /
#   MUSI_VERIFY_MARKER_FULL / MUSI_VERIFY_MARKER_CHANGED /
#   MUSI_PRECOMMIT_MARKER

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || printf '/workspace')"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/ai-hooks/output-filter.sh"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/lib/verify-metadata.sh"

PRECOMMIT_LOG_DIR="${MUSI_VERIFY_LOG_DIR:-$(musi_standard_verify_log_dir "$REPO_ROOT")}"
BUN_LOG_DIR="${AI_BUN_LOG_DIR:-$(musi_standard_bun_log_dir "$REPO_ROOT")}"
VERIFY_MARKER_FULL="${MUSI_VERIFY_MARKER_FULL:-$(musi_standard_verify_full_marker "$REPO_ROOT")}"
VERIFY_MARKER_CHANGED="${MUSI_VERIFY_MARKER_CHANGED:-$(musi_standard_verify_changed_marker "$REPO_ROOT")}"
PRECOMMIT_MARKER="${MUSI_PRECOMMIT_MARKER:-$(musi_standard_precommit_marker "$REPO_ROOT")}"

TASKS=(lint typecheck test e2e)
SLOW_TESTS_TASK=slow-tests
BUDGET_TASK=budget
TIMINGS_FILE="$PRECOMMIT_LOG_DIR/test-timings.json"
RUN_META_FILE="$PRECOMMIT_LOG_DIR/run-meta.json"

usage() {
  cat <<EOF
Usage: bun run verify:logs [task] [--full] [--json]

  bun run verify:logs               summary for lint, typecheck, test, e2e
  bun run verify:logs <task>        focused view with a 30-line tail
  bun run verify:logs <task> --full print the full log to stdout
  bun run verify:logs --json        harness-diagnostics envelope for summary
  bun run verify:logs budget        wrapper, step, and slow-test timings
  bun run verify:logs slow-tests    top 10 slow Vitest files and cases

Tasks: ${TASKS[*]} $BUDGET_TASK $SLOW_TESTS_TASK
EOF
}

# Candidate log files per task. The newest existing one (by mtime) wins.
candidate_logs() {
  case "$1" in
    lint)
      printf '%s\n' \
        "$PRECOMMIT_LOG_DIR/lint.log" \
        "$BUN_LOG_DIR/lint_changed.log" \
        "$BUN_LOG_DIR/lint.log"
      ;;
    typecheck)
      printf '%s\n' \
        "$PRECOMMIT_LOG_DIR/typecheck.log" \
        "$BUN_LOG_DIR/typecheck.log"
      ;;
    test)
      printf '%s\n' \
        "$PRECOMMIT_LOG_DIR/test.log" \
        "$BUN_LOG_DIR/test_changed.log" \
        "$BUN_LOG_DIR/test.log"
      ;;
    e2e)
      printf '%s\n' \
        "$BUN_LOG_DIR/e2e.log"
      ;;
  esac
}

newest_log() {
  local task="$1" newest="" newest_mtime=0 mtime
  while IFS= read -r path; do
    [ -f "$path" ] || continue
    mtime=$(stat -c %Y "$path" 2>/dev/null || echo 0)
    if [ "$mtime" -gt "$newest_mtime" ]; then
      newest_mtime=$mtime
      newest=$path
    fi
  done < <(candidate_logs "$task")
  [ -n "$newest" ] || return 1
  printf '%s\n' "$newest"
}

# bun-run-quiet writes per-script markers next to the log. Markers are
# argv-scoped (`last.<base>.<argv_fp>`) so a broader/corrected command cannot
# replay a narrower run's cached state (H1/H2); a single per-script log is still
# shared, so a log can map to several argv markers. Report the NEWEST marker for
# this script (the run whose output the shared log most likely holds). A legacy
# bare `last.<base>` marker is honored too for resilience across the rename.
# Pre-commit logs don't have a per-task marker (the wrapper records LAST_TS for
# the whole run, not each step), so this returns empty for those.
marker_for_log() {
  local log="$1" base newest="" newest_mtime=0 mtime path
  case "$log" in
    "$BUN_LOG_DIR"/*)
      base=$(basename "$log" .log)
      while IFS= read -r path; do
        [ -f "$path" ] || continue
        mtime=$(stat -c %Y "$path" 2>/dev/null || echo 0)
        if [ "$mtime" -gt "$newest_mtime" ]; then
          newest_mtime=$mtime
          newest=$path
        fi
      done < <(
        find "$BUN_LOG_DIR" -maxdepth 1 -type f \
          \( -name "last.$base" -o -name "last.$base.*" \) 2>/dev/null
      )
      [ -n "$newest" ] && printf '%s\n' "$newest"
      ;;
  esac
}

log_source() {
  case "$1" in
    "$PRECOMMIT_LOG_DIR"/*) printf 'verify/precommit\n' ;;
    "$BUN_LOG_DIR"/*) printf 'ai-hook\n' ;;
    *) printf 'unknown\n' ;;
  esac
}

human_age() {
  local secs="$1"
  # Future-dated markers (clock skew, restored backups) would print as
  # negative seconds and look like a bug. Floor at 0.
  [ "$secs" -lt 0 ] && secs=0
  if [ "$secs" -lt 60 ]; then printf '%ds' "$secs"
  elif [ "$secs" -lt 3600 ]; then printf '%dm' "$((secs/60))"
  elif [ "$secs" -lt 86400 ]; then printf '%dh' "$((secs/3600))"
  else printf '%dd' "$((secs/86400))"
  fi
}

# Reads a bun-run-quiet marker into globals MARK_AGE, MARK_EXIT, MARK_STATE.
# Mirrors `ai_read_bun_marker` (scripts/ai-hooks/cache.sh): all three keys
# must be present, no unknown keys, LAST_FP must be a sha256 hex string,
# and LAST_EXIT must be 0..127. Anything else is treated as a missing
# marker so the viewer never reports state the canonical writer wouldn't
# have produced. Inlined rather than sourced so this script stays usable
# in sandboxed smoke tests that override AI_BUN_LOG_DIR but not AI_STATE_ROOT.
read_marker_state() {
  local marker="$1"
  MARK_AGE=""; MARK_EXIT=""; MARK_STATE=""
  [ -n "$marker" ] && [ -f "$marker" ] || return 1
  local LAST_TS="" LAST_FP="" LAST_EXIT="" k v
  local saw_ts=0 saw_fp=0 saw_exit=0
  while IFS='=' read -r k v; do
    case "$k" in
      LAST_TS)   LAST_TS=$v;   saw_ts=1 ;;
      LAST_FP)   LAST_FP=$v;   saw_fp=1 ;;
      LAST_EXIT) LAST_EXIT=$v; saw_exit=1 ;;
      *) return 1 ;;
    esac
  done < "$marker"
  [ "$saw_ts" -eq 1 ] && [ "$saw_fp" -eq 1 ] && [ "$saw_exit" -eq 1 ] || return 1
  [[ "$LAST_TS" =~ ^[0-9]+$ ]] || return 1
  [ "$LAST_TS" -gt 0 ] || return 1
  [[ "$LAST_FP" =~ ^[0-9a-f]{64}$ ]] || return 1
  [[ "$LAST_EXIT" =~ ^[0-9]+$ ]] || return 1
  [ "$LAST_EXIT" -ge 0 ] && [ "$LAST_EXIT" -lt 128 ] || return 1
  MARK_AGE=$(( $(date +%s) - LAST_TS ))
  [ "$MARK_AGE" -lt 0 ] && MARK_AGE=0
  MARK_EXIT="$LAST_EXIT"
  if [ "$LAST_EXIT" -eq 0 ]; then MARK_STATE=OK; else MARK_STATE=FAIL; fi
}

# Reads a verify/pre-commit wrapper marker (LAST_TS / LAST_HEAD / LAST_HASH)
# into MARK_AGE only — wrapper markers don't carry per-task exit codes.
# Returns 1 if the marker is missing, incomplete, has unknown keys, or has a
# malformed timestamp/hash.
read_wrapper_marker_ts() {
  local marker="$1"
  MARK_AGE=""
  [ -n "$marker" ] && [ -f "$marker" ] || return 1
  local LAST_TS="" LAST_HEAD="" LAST_HASH="" k v saw_ts=0 saw_head=0 saw_hash=0
  while IFS='=' read -r k v; do
    case "$k" in
      LAST_TS)   LAST_TS=$v; saw_ts=1 ;;
      LAST_HEAD) LAST_HEAD=$v; saw_head=1 ;;
      LAST_HASH) LAST_HASH=$v; saw_hash=1 ;;
      *) return 1 ;;
    esac
  done < "$marker"
  [ "$saw_ts" -eq 1 ] && [ "$saw_head" -eq 1 ] && [ "$saw_hash" -eq 1 ] || return 1
  [[ "$LAST_TS" =~ ^[0-9]+$ ]] || return 1
  [ "$LAST_TS" -gt 0 ] || return 1
  [ -n "$LAST_HEAD" ] || return 1
  [[ "$LAST_HASH" =~ ^[0-9a-f]{64}$ ]] || return 1
  MARK_AGE=$(( $(date +%s) - LAST_TS ))
  [ "$MARK_AGE" -lt 0 ] && MARK_AGE=0
  printf '%s' "$LAST_TS"
}

# Returns the most recent wrapper-marker timestamp across verify (full),
# verify --changed, and pre-commit. Empty string if none parse cleanly.
latest_wrapper_ts() {
  local marker ts max=0
  for marker in "$VERIFY_MARKER_FULL" "$VERIFY_MARKER_CHANGED" "$PRECOMMIT_MARKER"; do
    if ts=$(read_wrapper_marker_ts "$marker"); then
      [ "$ts" -gt "$max" ] && max=$ts
    fi
  done
  [ "$max" -gt 0 ] && printf '%s' "$max"
}

verify_log_running_window_seconds() {
  local value="${MUSI_VERIFY_LOG_RUNNING_WINDOW_SECONDS:-120}"

  if [[ "$value" =~ ^[0-9]+$ ]]; then
    printf '%s' "$value"
  else
    printf '120'
  fi
}

any_unreadable_wrapper_marker_exists() {
  local marker
  for marker in "$VERIFY_MARKER_FULL" "$VERIFY_MARKER_CHANGED" "$PRECOMMIT_MARKER"; do
    [ -f "$marker" ] || continue
    if ! read_wrapper_marker_ts "$marker" >/dev/null; then
      return 0
    fi
  done
  return 1
}

unconfirmed_summary_state() {
  local age="$1" marker="$2" window

  if [ -n "$marker" ]; then
    printf 'STALE'
    return
  fi

  if any_unreadable_wrapper_marker_exists; then
    printf 'STALE'
    return
  fi

  window=$(verify_log_running_window_seconds)
  if [ "$age" -lt "$window" ]; then
    printf 'RUN?'
  else
    printf 'STALE'
  fi
}

print_summary() {
  printf '%-10s %-6s %-6s %-7s %-17s %s\n' TASK STATE EXIT AGE SOURCE LOG
  local wrapper_ts; wrapper_ts=$(latest_wrapper_ts)
  local task log mtime age log_lines src state exit_str marker any=0
  for task in "${TASKS[@]}"; do
    if log=$(newest_log "$task"); then
      any=1
      mtime=$(stat -c %Y "$log" 2>/dev/null || echo 0)
      age=$(( $(date +%s) - mtime ))
      [ "$age" -lt 0 ] && age=0
      log_lines=$(wc -l < "$log" 2>/dev/null || echo 0)
      src=$(log_source "$log")

      state="-"
      exit_str="?"
      marker=$(marker_for_log "$log")
      if [ -n "$marker" ] && read_marker_state "$marker"; then
        # bun-logs path: per-task LAST_EXIT is authoritative.
        state="$MARK_STATE"
        exit_str="$MARK_EXIT"
      elif [ -z "$marker" ] && [ -n "$wrapper_ts" ] && [ "$wrapper_ts" -ge "$mtime" ]; then
        # Pre-commit/verify path: no per-task marker exists, but a wrapper
        # marker written at-or-after the log mtime means the run that
        # produced this log succeeded (verify halts on first failure and
        # pre-commit's success marker is the only way the file gets written).
        state="OK*"
        exit_str="0"
      else
        state=$(unconfirmed_summary_state "$age" "$marker")
      fi

      printf '%-10s %-6s %-6s %-7s %-17s %s (%d lines)\n' \
        "$task" "$state" "$exit_str" "$(human_age "$age")" "$src" "$log" "$log_lines"
    else
      printf '%-10s %-6s %-6s %-7s %-17s %s\n' "$task" "-" "-" "-" "-" "(no log)"
    fi
  done

  printf '\nLegend: OK*/RUN?/STALE mean the log itself has no per-task exit code.\n'
  printf '  OK*  = pre-commit/verify run succeeded; this log is from that run.\n'
  printf '  RUN? = no marker confirms the row yet; a recent log may still be in-flight.\n'
  printf '  STALE= no readable marker confirms this log; re-run verification before trusting it.\n'
  printf '  -    = no log exists for this task.\n'
  printf '\nWrapper markers (no per-task exit; LAST_TS/LAST_HEAD/LAST_HASH):\n'
  # Same strict validation as `latest_wrapper_ts` so a marker rejected for OK*
  # derivation in the rows above is shown as `(corrupt)` here, not as fresh.
  local label name path
  for label in "verify (full):$VERIFY_MARKER_FULL" "verify --changed:$VERIFY_MARKER_CHANGED" "pre-commit:$PRECOMMIT_MARKER"; do
    name=${label%%:*}
    path=${label#*:}
    if [ ! -f "$path" ]; then
      printf '  %-18s (none) — %s\n' "$name" "$path"
    elif read_wrapper_marker_ts "$path" >/dev/null; then
      printf '  %-18s %s ago — %s\n' "$name" "$(human_age "$MARK_AGE")" "$path"
    else
      printf '  %-18s (corrupt) — %s\n' "$name" "$path"
    fi
  done

  if [ "$any" -eq 0 ]; then
    printf '\nNo task logs yet — run `bun run verify:changed` first.\n'
  fi
}

print_focus() {
  local task="$1" log
  if ! log=$(newest_log "$task"); then
    printf '%s: no log found.\n  Looked in:\n' "$task"
    candidate_logs "$task" | while IFS= read -r p; do printf '    %s\n' "$p"; done
    printf '  Run `bun run verify:changed` (or `bun run e2e` for e2e) to populate one.\n'
    return 1
  fi
  local mtime age log_lines src marker
  mtime=$(stat -c %Y "$log")
  age=$(( $(date +%s) - mtime ))
  [ "$age" -lt 0 ] && age=0
  log_lines=$(wc -l < "$log")
  src=$(log_source "$log")

  printf '== %s ==\n' "$task"
  printf 'log:    %s (%d lines, modified %s ago)\n' "$log" "$log_lines" "$(human_age "$age")"
  printf 'source: %s\n' "$src"

  marker=$(marker_for_log "$log")
  if [ -n "$marker" ]; then
    if read_marker_state "$marker"; then
      printf 'marker: %s exit=%s recorded %s ago — %s\n' \
        "$MARK_STATE" "$MARK_EXIT" "$(human_age "$MARK_AGE")" "$marker"
    else
      printf 'marker: missing or unreadable — %s\n' "$marker"
    fi
  else
    printf 'marker: (none — verify/pre-commit logs share an aggregate marker; see summary)\n'
  fi

  local tail_lines=30
  printf '\n--- last %d lines ---\n' "$tail_lines"
  tail -n 200 "$log" | ai_filter_known_output_noise | tail -n "$tail_lines"
}

print_full() {
  local task="$1" log
  if ! log=$(newest_log "$task"); then
    printf '%s: no log found.\n' "$task" >&2
    return 1
  fi
  cat "$log"
}

print_timing_regen_hint() {
  local test_log=""
  if test_log=$(newest_log test); then
    if grep -qE '^test:changed: (no files changed|no Vitest-relevant changes)' "$test_log"; then
      cat <<EOF
  The latest changed-mode test step skipped Vitest, so it could not write timings.
  Run \`FORCE_VERIFY=1 bun run verify\` for a fresh full-suite timing sample.
EOF
      return
    fi
  fi

  cat <<EOF
  Run \`FORCE_VERIFY=1 bun run verify:changed\` to regenerate changed-test timings.
  If changed-mode skips Vitest, run \`FORCE_VERIFY=1 bun run verify\` for a full-suite timing sample.
EOF
}

print_slow_tests() {
  if [ ! -f "$TIMINGS_FILE" ]; then
    printf 'slow-tests: no Vitest timing sidecar found.\n'
    printf '  Looked for: %s\n' "$TIMINGS_FILE"
    print_timing_regen_hint
    cat <<EOF
  Note: pre-commit runs may wipe the shared log directory without writing timings.
EOF
    return 1
  fi

  if ! command -v jq >/dev/null 2>&1; then
    printf 'slow-tests: jq is required to read %s.\n' "$TIMINGS_FILE" >&2
    return 1
  fi

  if ! jq -e '(.testResults // empty) | type == "array"' "$TIMINGS_FILE" >/dev/null 2>&1; then
    printf 'slow-tests: could not parse Vitest timings.\n'
    printf '  File: %s\n' "$TIMINGS_FILE"
    print_timing_regen_hint
    return 1
  fi

  local mtime age size wrapper_ts wrapper_age test_log
  mtime=$(stat -c %Y "$TIMINGS_FILE" 2>/dev/null || echo 0)
  age=$(( $(date +%s) - mtime ))
  [ "$age" -lt 0 ] && age=0
  size=$(wc -c < "$TIMINGS_FILE" 2>/dev/null || echo 0)

  printf '== slow-tests ==\n'
  printf 'timings: %s (%s, modified %s ago)\n' "$TIMINGS_FILE" "$(human_bytes "$size")" "$(human_age "$age")"
  if test_log=$(newest_log test); then
    printf 'test log: %s (%s)\n' "$test_log" "$(log_source "$test_log")"
  else
    printf 'test log: (none found)\n'
  fi
  wrapper_ts=$(latest_wrapper_ts)
  if [ -n "$wrapper_ts" ]; then
    wrapper_age=$(( $(date +%s) - wrapper_ts ))
    [ "$wrapper_age" -lt 0 ] && wrapper_age=0
    printf 'latest wrapper marker: %s ago\n' "$(human_age "$wrapper_age")"
  else
    printf 'latest wrapper marker: (none readable)\n'
  fi

  printf '\nTop slow test files\n'
  printf '%-4s %-9s %-7s %-8s %s\n' '#' DURATION TESTS STATUS FILE
  if ! print_slow_files "$TIMINGS_FILE"; then
    printf '  (no file timings found)\n'
  fi

  printf '\nTop slow test cases\n'
  printf '%-4s %-9s %-8s %s\n' '#' DURATION STATUS TEST
  if ! print_slow_cases "$TIMINGS_FILE"; then
    printf '  (no case timings found)\n'
  fi

  printf '\nLocal signal only; this report does not gate CI or commits.\n'
}

print_budget() {
  local warn_after="${MUSI_INTERACTIVE_WARN_AFTER:-1080}"
  local hard_timeout="${MUSI_INTERACTIVE_TIMEOUT:-$MUSI_GATE_INTERACTIVE_TIMEOUT_DEFAULT}"

  if [ ! -f "$RUN_META_FILE" ]; then
    printf 'budget: no verification metadata found.\n'
    printf '  Looked for: %s\n' "$RUN_META_FILE"
    printf '  Run `FORCE_VERIFY=1 bun run verify:changed` or make a staged commit attempt to populate it.\n'
    return 1
  fi

  if ! command -v jq >/dev/null 2>&1; then
    printf 'budget: jq is required to read %s.\n' "$RUN_META_FILE" >&2
    return 1
  fi

  if ! jq -e '.version == 1 and (.wrapper == null or (.wrapper | type == "object")) and (.steps | type == "array")' "$RUN_META_FILE" >/dev/null 2>&1; then
    printf 'budget: could not parse verification metadata.\n'
    printf '  File: %s\n' "$RUN_META_FILE"
    return 1
  fi

  local mtime age wrapper_elapsed wrapper_mode wrapper_exit wrapper_start wrapper_end budget_state
  mtime=$(stat -c %Y "$RUN_META_FILE" 2>/dev/null || echo 0)
  age=$(( $(date +%s) - mtime ))
  [ "$age" -lt 0 ] && age=0

  wrapper_elapsed=$(jq -r '.wrapper.elapsed_seconds // empty' "$RUN_META_FILE")
  wrapper_mode=$(jq -r '.wrapper.mode // .mode // "unknown"' "$RUN_META_FILE")
  wrapper_exit=$(jq -r '.wrapper.exit_code // "?"' "$RUN_META_FILE")
  wrapper_start=$(jq -r '.wrapper.start_time // "?"' "$RUN_META_FILE")
  wrapper_end=$(jq -r '.wrapper.end_time // "?"' "$RUN_META_FILE")

  budget_state="OK"
  if [ -n "$wrapper_elapsed" ] && [ "$wrapper_elapsed" -ge "$hard_timeout" ]; then
    budget_state="HARD-BUDGET-EXCEEDED"
  elif [ -n "$wrapper_elapsed" ] && [ "$wrapper_elapsed" -ge "$warn_after" ]; then
    budget_state="WARN-BUDGET-EXCEEDED"
  fi

  printf '== budget ==\n'
  printf 'metadata: %s (modified %s ago)\n' "$RUN_META_FILE" "$(human_age "$age")"
  printf 'budget: warn=%ss hard=%ss state=%s\n' "$warn_after" "$hard_timeout" "$budget_state"
  printf 'wrapper: %ss mode=%s exit=%s start=%s end=%s\n' \
    "${wrapper_elapsed:-?}" "$wrapper_mode" "$wrapper_exit" "$wrapper_start" "$wrapper_end"

  printf '\nPer-step timings\n'
  printf '%-18s %-12s %-8s %-6s %s\n' MODE STEP ELAPSED EXIT COMMAND
  if ! jq -r '
    (.steps // [])
    | sort_by(.mode, .name)
    | .[]
    | [
        (.mode // "unknown"),
        (.name // "unknown"),
        (((.elapsed_seconds // 0) | tostring) + "s"),
        ((.exit_code // "?") | tostring),
        (.command // "")
      ]
    | @tsv
  ' "$RUN_META_FILE" | while IFS=$'\t' read -r mode name elapsed exit_code command; do
    printf '%-18s %-12s %-8s %-6s %s\n' "$mode" "$name" "$elapsed" "$exit_code" "$command"
  done; then
    printf '  (could not read step metadata)\n'
  fi

  printf '\nSlow-test signal\n'
  if [ -f "$TIMINGS_FILE" ] && jq -e '(.testResults // empty) | type == "array"' "$TIMINGS_FILE" >/dev/null 2>&1; then
    printf 'timings: %s\n' "$TIMINGS_FILE"
    printf '\nTop slow test files\n'
    printf '%-4s %-9s %-7s %-8s %s\n' '#' DURATION TESTS STATUS FILE
    print_slow_files "$TIMINGS_FILE" || printf '  (no file timings found)\n'
    printf '\nTop slow test cases\n'
    printf '%-4s %-9s %-8s %s\n' '#' DURATION STATUS TEST
    print_slow_cases "$TIMINGS_FILE" || printf '  (no case timings found)\n'
  else
    printf 'timings: (none readable at %s)\n' "$TIMINGS_FILE"
  fi
}

human_bytes() {
  local bytes="$1"
  if [ "$bytes" -lt 1024 ]; then
    printf '%dB' "$bytes"
  elif [ "$bytes" -lt 1048576 ]; then
    printf '%dKiB' "$((bytes / 1024))"
  else
    printf '%dMiB' "$((bytes / 1048576))"
  fi
}

print_slow_files() {
  local timings_file="$1" rows
  rows=$(jq -r '
    def file_name: .name // .filepath // .file // "unknown";
    def duration_ms: ((.endTime // 0) - (.startTime // 0));
    [
      .testResults[]?
      | {
          file: file_name,
          duration: duration_ms,
          tests: ((.assertionResults // []) | length),
          status: (.status // "unknown")
        }
      | select(.duration >= 0)
    ]
    | sort_by(.duration)
    | reverse
    | .[:10]
    | to_entries[]
    | [
        ((.key + 1) | tostring),
        ((.value.duration | round | tostring) + "ms"),
        (.value.tests | tostring),
        .value.status,
        .value.file
      ]
    | @tsv
  ' "$timings_file") || return 1

  [ -n "$rows" ] || return 1
  while IFS=$'\t' read -r rank duration tests status file; do
    printf '%-4s %-9s %-7s %-8s %s\n' "$rank." "$duration" "$tests" "$status" "$file"
  done <<< "$rows"
}

print_slow_cases() {
  local timings_file="$1" rows
  rows=$(jq -r '
    def file_name: .name // .filepath // .file // "unknown";
    def clean_text: tostring | gsub("[\t\r\n]+"; " ");
    def case_name:
      if (.fullName? // "") != "" then
        .fullName
      else
        (((.ancestorTitles // []) + [(.title // "(untitled)")])
          | map(select(. != null and . != ""))
          | join(" > "))
      end;
    [
      .testResults[]? as $file
      | ($file | file_name) as $path
      | ($file.assertionResults // [])[]?
      | {
          file: $path,
          name: (case_name | clean_text),
          duration: (.duration // 0),
          status: (.status // "unknown")
        }
      | select(.duration >= 0)
    ]
    | sort_by(.duration)
    | reverse
    | .[:10]
    | to_entries[]
    | [
        ((.key + 1) | tostring),
        ((.value.duration | round | tostring) + "ms"),
        .value.status,
        (.value.name + " - " + .value.file)
      ]
    | @tsv
  ' "$timings_file") || return 1

  [ -n "$rows" ] || return 1
  while IFS=$'\t' read -r rank duration status test_name; do
    printf '%-4s %-9s %-8s %s\n' "$rank." "$duration" "$status" "$test_name"
  done <<< "$rows"
}

is_known_task() {
  local cand="$1" t
  for t in "${TASKS[@]}"; do
    [ "$t" = "$cand" ] && return 0
  done
  [ "$cand" = "$BUDGET_TASK" ] && return 0
  [ "$cand" = "$SLOW_TESTS_TASK" ] && return 0
  return 1
}

# Emit a harness-diagnostics envelope summarising the same state the human
# `print_summary` view renders: one warn finding per task whose last marker
# says FAIL, plus warn findings for corrupt wrapper markers, plus info
# findings for tasks whose state cannot be confirmed (log exists but no
# per-task marker and no fresh wrapper marker). OK / OK* / no-log states
# emit nothing so consumers see only the actionable list.
emit_summary_json() {
  if ! command -v jq >/dev/null 2>&1; then
    printf 'verify:logs: jq is required for --json mode but is not installed\n' >&2
    return 1
  fi

  # Build findings into a temp NDJSON file rather than a `{ ... } | emitter`
  # pipe. A brace group on the left of a pipe runs in a subshell, so a
  # mid-loop `exit` would not terminate the script and pipefail only exposes
  # the last command's status — silent finding-drop. Writing to a temp file
  # keeps each jq invocation in the parent shell where its exit code matters.
  local findings_ndjson
  findings_ndjson="$(mktemp)"
  trap 'rm -f "$findings_ndjson"' RETURN

  local wrapper_ts; wrapper_ts=$(latest_wrapper_ts)
  local task log mtime marker now
  now=$(date +%s)
  for task in "${TASKS[@]}"; do
    if ! log=$(newest_log "$task"); then
      continue
    fi
    mtime=$(stat -c %Y "$log" 2>/dev/null || echo 0)
    marker=$(marker_for_log "$log")
    if [ -n "$marker" ] && read_marker_state "$marker"; then
      if [ "$MARK_EXIT" -ne 0 ]; then
        jq -nc \
          --arg path "$log" \
          --arg messageId "$task-failure" \
          --arg why "verify task '$task' last exited with code $MARK_EXIT (recorded $(human_age "$MARK_AGE") ago)." \
          --arg howToFix "Re-run \`bun run verify:changed\` (or \`bun run e2e\` for e2e); inspect $log via \`bun run verify:logs $task\`." \
          '{control:"verify-wrapper/verify-logs",severity:"warn",path:$path,messageId:$messageId,why:$why,howToFix:$howToFix,repairKind:"manual"}' \
          >> "$findings_ndjson" || {
            printf 'verify:logs: jq failed to construct failure finding for %s\n' "$task" >&2
            return 1
          }
      fi
    elif [ -z "$marker" ] && [ -n "$wrapper_ts" ] && [ "$wrapper_ts" -ge "$mtime" ]; then
      # OK*: pre-commit/verify wrapper marker promotes this row to clean.
      continue
    else
      local age=$(( now - mtime ))
      [ "$age" -lt 0 ] && age=0
      jq -nc \
        --arg path "$log" \
        --arg messageId "$task-state-unknown" \
        --arg why "verify task '$task' has a log ($(human_age "$age") old) but no per-task marker and no fresh wrapper marker; state cannot be confirmed." \
        --arg howToFix "Re-run \`bun run verify:changed\` to refresh state; or inspect $log via \`bun run verify:logs $task\`." \
        '{control:"verify-wrapper/verify-logs",severity:"info",path:$path,messageId:$messageId,why:$why,howToFix:$howToFix,repairKind:"manual"}' \
        >> "$findings_ndjson" || {
          printf 'verify:logs: jq failed to construct state-unknown finding for %s\n' "$task" >&2
          return 1
        }
    fi
  done

  # Corrupt wrapper markers indicate a writer bug or manual tampering;
  # surface each so they get fixed rather than silently ignored.
  local label name path
  for label in "verify-full:$VERIFY_MARKER_FULL" "verify-changed:$VERIFY_MARKER_CHANGED" "pre-commit:$PRECOMMIT_MARKER"; do
    name=${label%%:*}
    path=${label#*:}
    if [ -f "$path" ] && ! read_wrapper_marker_ts "$path" >/dev/null; then
      jq -nc \
        --arg path "$path" \
        --arg messageId "wrapper-marker-corrupt-$name" \
        --arg why "wrapper marker $path is corrupt or unreadable; the $name run cannot be promoted to OK*." \
        --arg howToFix "Delete the marker (\`rm $path\`) and re-run the corresponding wrapper to regenerate it." \
        '{control:"verify-wrapper/verify-logs",severity:"warn",path:$path,messageId:$messageId,why:$why,howToFix:$howToFix,repairKind:"manual"}' \
        >> "$findings_ndjson" || {
          printf 'verify:logs: jq failed to construct corrupt-marker finding for %s\n' "$name" >&2
          return 1
        }
    fi
  done

  # Feed the validated NDJSON into the envelope emitter. SCRIPT_DIR is needed
  # because tests cd into a sandbox before invoking the wrapper; a relative
  # `scripts/harness-emit-envelope.ts` would only resolve at the repo root.
  bun run "$SCRIPT_DIR/harness-emit-envelope.ts" --tool verify:logs < "$findings_ndjson"
  return "$?"
}

TASK=""
FULL=0
JSON=0
for arg in "$@"; do
  case "$arg" in
    -h|--help)
      usage
      exit 0
      ;;
    --full)
      FULL=1
      ;;
    --json)
      JSON=1
      ;;
    *)
      if is_known_task "$arg"; then
        if [ -n "$TASK" ]; then
          printf 'verify:logs: only one task may be supplied (got %s and %s)\n' "$TASK" "$arg" >&2
          exit 2
        fi
        TASK="$arg"
      else
        printf 'verify:logs: unknown argument: %s\n' "$arg" >&2
        usage >&2
        exit 2
      fi
      ;;
  esac
done

if [ "$FULL" -eq 1 ] && [ -z "$TASK" ]; then
  printf 'verify:logs: --full requires a task argument (one of: %s)\n' "${TASKS[*]}" >&2
  exit 2
fi

if [ "$FULL" -eq 1 ] && { [ "$TASK" = "$SLOW_TESTS_TASK" ] || [ "$TASK" = "$BUDGET_TASK" ]; }; then
  printf 'verify:logs: --full is not supported for %s; use `bun run verify:logs %s`.\n' "$TASK" "$TASK" >&2
  exit 2
fi

if [ "$JSON" -eq 1 ] && [ "$FULL" -eq 1 ]; then
  printf 'verify:logs: --json cannot be combined with --full\n' >&2
  exit 2
fi

if [ "$JSON" -eq 1 ] && [ -n "$TASK" ]; then
  # --json wraps the summary view only: focused/budget/slow-tests are
  # interactive surfaces with their own data shapes and no obvious harness
  # consumer. Adding per-task JSON later is straightforward but out of
  # scope for the summary contract.
  printf 'verify:logs: --json is only supported for the summary view (omit the task argument)\n' >&2
  exit 2
fi

if [ "$JSON" -eq 1 ]; then
  emit_summary_json
  exit "$?"
fi

if [ -z "$TASK" ]; then
  print_summary
elif [ "$TASK" = "$BUDGET_TASK" ]; then
  print_budget
elif [ "$TASK" = "$SLOW_TESTS_TASK" ]; then
  print_slow_tests
elif [ "$FULL" -eq 1 ]; then
  print_full "$TASK"
else
  print_focus "$TASK"
fi
