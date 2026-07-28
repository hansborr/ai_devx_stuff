#!/bin/bash

# Shared commit output summaries for agent hook adapters.

AI_HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$AI_HOOKS_DIR/output-filter.sh"
# shellcheck source=/dev/null
. "$AI_HOOKS_DIR/../lib/verify-metadata.sh"

# Keyed on outcome, not marker presence: post-commit appends HEAD to the
# fast-commit provenance log only when pre-commit actually skipped a slot,
# and it has done so by the time this summary runs. A docs-only or
# bridged/full-verified commit made with the marker set is not in the log
# and must not be told its slots were skipped.
ai_fast_commit_summary_suffix() {
  local repo_root="$1"
  local log head

  log="$(musi_fast_commit_log_path "$repo_root")"
  [ -f "$log" ] || return 0
  head="$(git -C "$repo_root" rev-parse HEAD 2>/dev/null)" || return 0
  [ -n "$head" ] || return 0
  if grep -qxF "$head" "$log"; then
    printf '\n(fast-commit: test+scripts slots skipped; land via bash scripts/land.sh)'
  fi
}

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
  ai_fast_commit_summary_suffix "$repo_root"
}

# Extract the operator-facing baseline truth-up advisories that
# .husky/post-commit emits (lint-ratchet / knip / max-lines) while a commit
# runs — most importantly the "merge produced a stale baseline" warning after a
# hand-completed conflicted merge. Every such line is prefixed `post-commit: `
# and nothing else in the post-commit hook uses that prefix, so it is a clean
# discriminator against the rest of the captured child output. Prints nothing
# when there are none; grep's exit 1 on no-match must not abort the caller's
# success path, hence the `|| true`.
ai_commit_truth_up_lines() {
  local output="$1"
  printf '%s\n' "$output" | grep '^post-commit: ' || true
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
      if [ "$task" = ratchet ]; then
        summary="$summary

--- $task (full log: $log) ---
$(ai_ratchet_failure_excerpt "$log_dir/ratchet-diagnostics.json" "$log" 30)"
        continue
      fi
      summary="$summary

--- $task (last 30 lines; full log: $log) ---
$(ai_filtered_task_log_excerpt "$task" "$log" 30)"
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

# Emitted INSTEAD of ai_commit_no_landing_summary when HEAD did not move but the
# hook cannot prove which checkout it just measured: the command's leading forms
# carry a substitution, so a `cd`/`git -C` may be hiding in there and the commit
# may have landed in a different repository than the one observed. "No commit
# landed" would be a confident wrong claim here — in parallel-lane work an agent
# acts on it by redoing or undoing work that did land — so state the uncertainty
# and hand back the child output unjudged.
ai_commit_landing_unknown_summary() {
  local observed_root="$1"
  local output="$2"

  ai_limit_lines "Commit result unknown — the target checkout could not be identified.
The command exited 0 and HEAD did not move in $observed_root, but the command's leading forms contain a command substitution, so the hook could not tell which repository the command acted on. No claim is made about whether a commit landed: it may have landed in another checkout. Check 'git -C <the directory the command targeted> log -1 --oneline' before retrying, and prefer a literal path with no substitution before the commit verb so this check can attribute the result.

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

ai_commit_maybe_running_summary() {
  local label="$1"
  local head_before="$2"
  local output="$3"
  local detail="${4:-}"
  local head_guidance=""
  local detail_block=""

  if [ -n "$head_before" ]; then
    head_guidance="If HEAD moved from $head_before, treat the commit as succeeded."
  else
    head_guidance="If HEAD moved, treat the commit as succeeded."
  fi

  if [ -n "$detail" ]; then
    detail_block="
$detail"
  fi

  ai_limit_lines "$label
The git commit result is uncertain. Check git status --short and git log -1 --oneline before retrying.

$head_guidance$detail_block

--- last 40 lines ---
$(printf '%s\n' "$output" | tail -n 40)" 80 "... truncated ({lines} lines total). Read the referenced log files for complete output."
}
