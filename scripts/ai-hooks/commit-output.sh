#!/bin/bash

# Shared commit output summaries for agent hook adapters.

AI_HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$AI_HOOKS_DIR/output-filter.sh"

ai_commit_success_summary() {
  local repo_root="$1"
  local head_before="$2"
  local head_after="$3"
  local hash subject stat

  hash=$(git -C "$repo_root" log -1 --format='%h' 2>/dev/null || echo '???')
  subject=$(git -C "$repo_root" log -1 --format='%s' 2>/dev/null || echo '')

  if [ "$head_before" = "none" ]; then
    stat=$(git -C "$repo_root" diff --stat --root HEAD 2>/dev/null | tail -1 | xargs)
  else
    stat=$(git -C "$repo_root" diff --stat "$head_before..$head_after" 2>/dev/null | tail -1 | xargs)
  fi

  if [ -n "$stat" ]; then
    printf 'Commit succeeded: %s %s | %s' "$hash" "$subject" "$stat"
  else
    printf 'Commit succeeded: %s %s' "$hash" "$subject"
  fi
}

ai_precommit_failed_tasks() {
  local output="$1"
  local failed_line

  failed_line=$(printf '%s\n' "$output" | grep -m1 '^Failed:' || true)
  printf '%s\n' "$failed_line" | sed 's/^Failed://' | xargs
}

ai_precommit_failure_summary() {
  local output="$1"
  local log_dir="${2:-$AI_PRECOMMIT_LOG_DIR}"
  local passed_line failed_line failed_tasks summary task log

  passed_line=$(printf '%s\n' "$output" | grep -m1 '^Passed:' || true)
  failed_line=$(printf '%s\n' "$output" | grep -m1 '^Failed:' || true)
  failed_tasks=$(printf '%s\n' "$failed_line" | sed 's/^Failed://' | xargs)

  [ -n "$failed_tasks" ] || return 1

  summary="Pre-commit failed.
$passed_line
$failed_line"

  for task in $failed_tasks; do
    log="$log_dir/${task}.log"
    if [ -f "$log" ]; then
      summary="$summary

--- $task (last 30 lines; full log: $log) ---
$(tail -n 200 "$log" | ai_filter_known_output_noise | tail -n 30)"
    else
      summary="$summary

--- $task (no log found at $log) ---"
    fi
  done

  summary=$(ai_append_flaky_note "$failed_tasks" "$summary")
  ai_limit_lines "$summary" 80 "... truncated ({lines} lines total). Read the referenced log files for complete output."
}

ai_commit_no_landing_summary() {
  local head_before="$1"
  local output="$2"

  ai_limit_lines "No commit landed.
The command exited 0 but HEAD is still at $head_before. Likely cause: the command contained something that masked the real 'git commit' exit code (for example '|| true', '|| echo ...', a trailing no-op in a compound command, or '--dry-run'), or nothing was staged. Re-issue the commit as a single 'git commit -m \"...\"' invocation with no trailing fallbacks.

--- child output (last 40 lines) ---
$(printf '%s\n' "$output" | tail -n 40)" 80 "... truncated ({lines} lines total). Read the referenced log files for complete output."
}

ai_commit_dry_run_summary() {
  local output="$1"

  ai_limit_lines "git commit --dry-run completed.

--- last 40 lines ---
$(printf '%s\n' "$output" | tail -n 40)" 80 "... truncated ({lines} lines total). Read the referenced log files for complete output."
}

ai_commit_generic_summary() {
  local label="$1"
  local output="$2"

  ai_limit_lines "$label
$(printf '%s\n' "$output" | tail -n 40)" 80 "... truncated ({lines} lines total). Read the referenced log files for complete output."
}
