#!/usr/bin/env bash
# Shared post-merge / post-commit truth-up body for the generated baselines.
#
# Sourced by the thin <key>-post-merge-baseline-truth-up.sh shims, which set
# MUSI_TRUTH_UP_KEY before sourcing. Orchestration stays IN-PROCESS (the shim
# sources this file rather than re-dispatching through bun), so the only
# subprocess is the driver's own check command — matching the husky hooks and
# the bun-invocation-log test stubs. One keyed body replaced four near-identical
# skeletons (context validation, repo/git-dir/marker resolution, diff-base
# selection, marker-stamp check, baseline-diff gate); the per-driver check
# command, classification, and advisory text stay in the per-key handlers below.
#
# Dual-hook contract (unchanged): `.husky/post-merge` invokes the shim with the
# default "post-merge" context after a `git merge` auto-commit (its squash-flag
# gate skips the dispatch while HEAD is unmoved); `.husky/post-commit` invokes it
# with "post-commit" after a merge completed by a plain `git commit`, cherry-pick,
# or rebase. Truth-up markers are stamped with the pre-merge HEAD and honored only
# when that stamp equals the completed commit's first parent (HEAD^1).
set -uo pipefail

_MUSI_TRUTH_UP_KEY="${MUSI_TRUTH_UP_KEY:?internal: MUSI_TRUTH_UP_KEY must be set by the sourcing shim}"
_tu_context="${1:-post-merge}"

case "$_MUSI_TRUTH_UP_KEY" in
  lint-ratchet)
    _tu_label="lint-ratchet"
    _tu_baseline_file="lint-ratchet.baseline.json"
    ;;
  knip-unused-exports)
    _tu_label="knip unused-exports"
    _tu_baseline_file="sensor-knip-unused-exports.baseline.json"
    ;;
  near-duplicates)
    _tu_label="near-duplicates"
    _tu_baseline_file="sensor-near-duplicates.baseline.json"
    ;;
  max-lines-exceptions)
    _tu_label="max-lines exceptions"
    _tu_baseline_file="eslint-config/max-lines-exceptions.baseline.json"
    ;;
  *)
    printf 'baseline truth-up: unknown driver key %s\n' "$_MUSI_TRUTH_UP_KEY" >&2
    exit 2
    ;;
esac

# All drivers accept only post-merge/post-commit. (The near-duplicates script did
# not previously validate its context, but no caller passes any other value, so
# unifying the guard is behavior-preserving in practice.)
case "$_tu_context" in
  post-merge | post-commit) ;;
  *)
    printf '%s truth-up: unknown context %s\n' "$_tu_label" "$_tu_context" >&2
    exit 2
    ;;
esac

_tu_repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$_tu_repo_root" || exit 0

_tu_marker=""
_tu_git_dir=$(git rev-parse --git-dir 2>/dev/null || true)
if [ -n "$_tu_git_dir" ]; then
  case "$_tu_git_dir" in
    /*) _tu_git_dir_abs=$_tu_git_dir ;;
    *) _tu_git_dir_abs="$_tu_repo_root/$_tu_git_dir" ;;
  esac
  _tu_marker="$_tu_git_dir_abs/musi/$_MUSI_TRUTH_UP_KEY-baseline-postmerge-truth-up-required"
fi

# --- shared helpers used by the diff-or-marker (ratchet, knip) handlers -------

# Pick the base to diff the merged baseline against, per hook context. Returns
# non-zero to signal "no truth-up work" (the caller exits 0). post-merge always
# runs for a merge/pull and uses ORIG_HEAD; post-commit gates on a second parent
# (a merge completed via plain `git commit`) or, for cherry-pick/rebase one-parent
# commits, a pending marker, and diffs against HEAD^1.
_tu_resolve_diff_base() {
  if [ "$_tu_context" = "post-merge" ]; then
    git rev-parse --verify 'ORIG_HEAD^{commit}' >/dev/null 2>&1 || return 1
    _tu_diff_base=ORIG_HEAD
  else
    if git rev-parse --verify --quiet 'HEAD^2' >/dev/null 2>&1; then
      _tu_diff_base='HEAD^1'
    else
      [ -n "$_tu_marker" ] && [ -f "$_tu_marker" ] || return 1
      _tu_diff_base='HEAD^1'
    fi
  fi
  return 0
}

# Honor a marker only for the completed commit whose first parent matches the
# driver's pre-merge stamp; drop and announce a genuinely stale one. Sets
# _tu_marker_present.
_tu_stamp_check() {
  _tu_marker_present=0
  if [ -n "$_tu_marker" ] && [ -f "$_tu_marker" ]; then
    _tu_marker_present=1
    local marker_pre_merge_head merged_first_parent
    marker_pre_merge_head=$(sed -n 's/^pre-merge-head=//p' "$_tu_marker" 2>/dev/null | head -n 1)
    merged_first_parent=$(git rev-parse --verify --quiet 'HEAD^1' 2>/dev/null || true)
    if [ -z "$marker_pre_merge_head" ] || [ "$merged_first_parent" != "$marker_pre_merge_head" ]; then
      _tu_marker_present=0
      rm -f "$_tu_marker"
      printf '%s: ignoring stale %s truth-up marker\n' "$_tu_context" "$_tu_label" >&2
    fi
  fi
}

# Continue only when the merge touched the baseline or a marker is pending.
_tu_baseline_touched_or_marked() {
  if ! git diff --name-only "$_tu_diff_base" HEAD -- "$_tu_baseline_file" \
    | grep -qx "$_tu_baseline_file"; then
    [ "$_tu_marker_present" -eq 1 ] || return 1
  fi
  return 0
}

# --- per-driver handlers ------------------------------------------------------

_tu_run_lint_ratchet() {
  local STALE_BASELINE_INSTRUCTION RUNNING_NOTICE COULD_NOT_RUN_INSTRUCTION
  local FAILED_CHECK_INSTRUCTION VERIFIED_NOTICE
  STALE_BASELINE_INSTRUCTION="$_tu_context: merge produced a stale ratchet baseline - run: bun run lint:ratchet:update, review the diff against HEAD^1 (and HEAD^2 for a merge commit), then commit the repaired baseline as a follow-up commit (or git commit --amend if your workflow permits history rewriting)"
  RUNNING_NOTICE="$_tu_context: lint-ratchet truth-up running (full check-baseline, typically ~20s)…"
  COULD_NOT_RUN_INSTRUCTION="$_tu_context: lint-ratchet truth-up could not run; run bun run lint:ratchet:check-baseline manually to verify the merged baseline."
  FAILED_CHECK_INSTRUCTION="$_tu_context: lint-ratchet truth-up check failed without a staleness verdict; inspect its output (below) and run bun run lint:ratchet:check-baseline manually once the cause is fixed."
  VERIFIED_NOTICE="$_tu_context: merged lint-ratchet baseline verified truthful."

  _tu_resolve_diff_base || exit 0
  # Without bun (GUI git clients, minimal shells) staleness cannot be evaluated.
  # Leave any marker in place so another capable hook run at the same HEAD can
  # retry it; after HEAD moves, the stamp check reports and discards it.
  command -v bun >/dev/null 2>&1 || exit 0
  _tu_stamp_check
  _tu_baseline_touched_or_marked || exit 0

  local run_full_check=0
  [ "${MUSI_RATCHET_POSTMERGE:-}" = "full" ] && run_full_check=1
  [ "$_tu_marker_present" -eq 1 ] && run_full_check=1

  local preflight_status=0
  bun run scripts/lint-ratchet/post-merge-baseline-preflight.ts >/dev/null 2>&1 \
    || preflight_status=$?
  # exit 127 means the check itself could not run (missing deps, broken install)
  # - an environment failure, not evidence of staleness.
  [ "$preflight_status" -eq 127 ] && exit 0
  [ "$preflight_status" -ne 0 ] && run_full_check=1

  [ "$run_full_check" -eq 1 ] || exit 0

  # The full check-baseline is the ~20s step; announce it so a successful
  # truth-up is not indistinguishable from the hook never engaging.
  printf '%s\n' "$RUNNING_NOTICE" >&2
  local full_check_status=0 full_check_output
  full_check_output=$(bun run lint:ratchet:check-baseline 2>&1) || full_check_status=$?
  # Classify by exit code plus output marker: only a WorseBaselineError verdict
  # (exit 1 with the checker's `lint:ratchet:` diagnostic) is evidence of a stale
  # baseline. The marker stays put on every failure so a capable retry at the same
  # HEAD re-runs the check (consume-only-on-success). Match the verdict from a
  # herestring, never `printf ... | grep -q`: grep -q closes the pipe at the first
  # match, so a report larger than the pipe buffer takes SIGPIPE on printf and
  # returns 141 under pipefail, silently misrouting to the generic advisory.
  if [ "$full_check_status" -eq 0 ]; then
    [ "$_tu_marker_present" -eq 1 ] && rm -f "$_tu_marker"
    printf '%s\n' "$VERIFIED_NOTICE" >&2
  elif [ "$full_check_status" -eq 127 ]; then
    printf '%s\n' "$COULD_NOT_RUN_INSTRUCTION" >&2
  elif [ "$full_check_status" -eq 1 ] && grep -q '^lint:ratchet:' <<<"$full_check_output"; then
    printf '%s\n' "$STALE_BASELINE_INSTRUCTION" >&2
  else
    printf '%s\n' "$FAILED_CHECK_INSTRUCTION" >&2
    printf '%s\n' "$full_check_output" | tail -n 20 >&2
  fi
  exit 0
}

_tu_run_knip_unused_exports() {
  local STALE_BASELINE_INSTRUCTION SUMMARY_DRIFT_BASELINE_INSTRUCTION
  local CORRUPT_BASELINE_INSTRUCTION RUNNING_NOTICE COULD_NOT_RUN_INSTRUCTION VERIFIED_NOTICE
  STALE_BASELINE_INSTRUCTION="$_tu_context: merge produced a stale knip unused-export baseline - run: bun scripts/sensor-knip-unused-exports.ts --update, review the diff against HEAD^1 (and HEAD^2 for a merge commit), then commit the repaired baseline as a follow-up commit (or git commit --amend if your workflow permits history rewriting)"
  SUMMARY_DRIFT_BASELINE_INSTRUCTION="$_tu_context: merged knip unused-export baseline has a stale derived summary but entries still govern enforcement - run: bun scripts/sensor-knip-unused-exports.ts --update, review the diff against HEAD^1 (and HEAD^2 for a merge commit), then commit the repaired baseline as a follow-up commit (or git commit --amend if your workflow permits history rewriting)"
  CORRUPT_BASELINE_INSTRUCTION="$_tu_context: the merged knip unused-export baseline is unparseable or internally inconsistent. Repair: bun scripts/sensor-knip-unused-exports.ts --update, then review the repaired baseline against the committed parents (git diff HEAD^1 -- sensor-knip-unused-exports.baseline.json; for a merge commit also git diff HEAD^2 -- sensor-knip-unused-exports.baseline.json - a cherry-pick or rebase replay has only HEAD^1) and commit the repaired baseline as a follow-up commit (or git commit --amend if your workflow permits history rewriting). Durable fix: resolve the baseline with the semantic merge CLI (bun scripts/sensor-knip-unused-exports-merge-cli.ts) instead of a textual merge."
  RUNNING_NOTICE="$_tu_context: knip unused-export truth-up running (sensor check)…"
  COULD_NOT_RUN_INSTRUCTION="$_tu_context: knip unused-export truth-up could not run; run bun run sensor:knip-unused-exports manually to verify the merged baseline."
  VERIFIED_NOTICE="$_tu_context: merged knip unused-export baseline verified truthful."

  _tu_resolve_diff_base || exit 0
  command -v bun >/dev/null 2>&1 || exit 0
  _tu_stamp_check
  _tu_baseline_touched_or_marked || exit 0

  # The sensor run is the wait; announce it, then report its outcome.
  printf '%s\n' "$RUNNING_NOTICE" >&2
  local check_status=0 output
  output=$(bun run sensor:knip-unused-exports 2>&1) || check_status=$?
  # A FAIL entry mismatch takes precedence when both exit-1 defects coexist.
  # Exit 2 covers a broken merged baseline (`ERROR: baseline …`) and a transient
  # knip-run failure; only the former is a merge defect. Match verdicts from a
  # herestring, never `printf ... | grep -qE` (SIGPIPE/pipefail misrouting risk).
  if [ "$_tu_marker_present" -eq 1 ] && [ "$check_status" -eq 0 ]; then
    rm -f "$_tu_marker"
  fi
  if [ "$check_status" -eq 1 ] && grep -qE '^FAIL:' <<<"$output"; then
    printf '%s\n' "$STALE_BASELINE_INSTRUCTION" >&2
  elif [ "$check_status" -eq 1 ] && grep -qE '^WARN: baseline summary does not match the entries' <<<"$output"; then
    printf '%s\n' "$SUMMARY_DRIFT_BASELINE_INSTRUCTION" >&2
  elif [ "$check_status" -eq 1 ]; then
    printf '%s\n' "$STALE_BASELINE_INSTRUCTION" >&2
  elif [ "$check_status" -eq 2 ] && grep -qE '^ERROR: baseline' <<<"$output"; then
    printf '%s\n' "$CORRUPT_BASELINE_INSTRUCTION" >&2
  elif [ "$check_status" -ne 0 ]; then
    printf '%s\n' "$COULD_NOT_RUN_INSTRUCTION" >&2
  elif [ "$check_status" -eq 0 ]; then
    printf '%s\n' "$VERIFIED_NOTICE" >&2
  fi
  exit 0
}

_tu_run_near_duplicates() {
  # Marker-only trigger: nothing to do without a pending marker.
  [ -n "$_tu_marker" ] && [ -f "$_tu_marker" ] || exit 0
  command -v bun >/dev/null 2>&1 || exit 0

  local marker_head current_head first_parent
  marker_head=$(sed -n 's/^pre-merge-head=//p' "$_tu_marker" 2>/dev/null | head -n 1)
  current_head=$(git rev-parse --verify --quiet HEAD 2>/dev/null || true)
  first_parent=$(git rev-parse --verify --quiet 'HEAD^1' 2>/dev/null || true)
  # A squash merge has not created its commit yet; post-commit will truth up.
  if [ "$_tu_context" = "post-merge" ] && [ -n "$marker_head" ] && [ "$marker_head" = "$current_head" ]; then
    exit 0
  fi
  if [ -z "$marker_head" ] || [ "$marker_head" != "$first_parent" ]; then
    rm -f "$_tu_marker"
    printf '%s: ignoring stale near-duplicates truth-up marker\n' "$_tu_context" >&2
    exit 0
  fi

  printf '%s: near-duplicates baseline truth-up running (whole-repo --check-baseline)…\n' "$_tu_context" >&2
  local check_status=0 check_output
  check_output=$( (cd "$_tu_repo_root" && bun run sensor:near-duplicates -- --check-baseline) 2>&1 ) \
    || check_status=$?
  # --check-baseline: exit 0 truthful, exit 1 exclusively the stale (`FAIL:`)
  # verdict, exit 2 a config/collection/parse ERROR. Only a genuine mismatch
  # warrants the --restore-merge-truth recipe; anything else surfaces its real
  # output. The marker is consumed only on a clean result. Match FAIL from a
  # herestring, never a pipe (SIGPIPE misroute risk).
  if [ "$check_status" -eq 0 ]; then
    rm -f "$_tu_marker"
    printf '%s: merged near-duplicates baseline verified truthful.\n' "$_tu_context" >&2
  elif [ "$check_status" -eq 1 ] && grep -qE '^FAIL:' <<<"$check_output"; then
    printf '%s: merged near-duplicates baseline is stale; run bun scripts/sensor-near-duplicates.ts --restore-merge-truth to restore the stamped detector truth.\n' \
      "$_tu_context" >&2
  else
    printf '%s: near-duplicates baseline truth-up could not evaluate staleness (exit %s); this is an environment failure, not a stale baseline. Inspect the output below and re-run bun run sensor:near-duplicates -- --check-baseline once the cause is fixed. The truth-up marker is kept for a capable retry.\n' \
      "$_tu_context" "$check_status" >&2
    printf '%s\n' "$check_output" | tail -n 20 >&2
  fi
  exit 0
}

_tu_run_max_lines_exceptions() {
  local TRUTH_UP_INSTRUCTION
  TRUTH_UP_INSTRUCTION="$_tu_context: max-lines exception merge needs truth-up - run bun run lint to find insufficient merged caps, edit eslint-config/max-lines-exceptions.baseline.json as needed, then run: bun run lint:max-lines-exceptions:update && bun run lint:max-lines-exceptions; review the diff against HEAD^1 (and HEAD^2 for a merge commit), then commit the repaired baseline as a follow-up commit (or git commit --amend if your workflow permits history rewriting)"

  # Marker-only subsystem: no verification, so a matching marker is consumed
  # after the one-shot advisory (there is no success/failure result to retry).
  if [ "$_tu_context" = "post-merge" ]; then
    git rev-parse --verify 'ORIG_HEAD^{commit}' >/dev/null 2>&1 || exit 0
  else
    [ -n "$_tu_marker" ] && [ -f "$_tu_marker" ] || exit 0
  fi
  [ -n "$_tu_marker" ] && [ -f "$_tu_marker" ] || exit 0

  local marker_pre_merge_head merged_first_parent
  marker_pre_merge_head=$(sed -n 's/^pre-merge-head=//p' "$_tu_marker" 2>/dev/null | head -n 1)
  rm -f "$_tu_marker"
  merged_first_parent=$(git rev-parse --verify --quiet 'HEAD^1' 2>/dev/null || true)
  if [ -z "$marker_pre_merge_head" ] || [ "$merged_first_parent" != "$marker_pre_merge_head" ]; then
    printf '%s: ignoring stale max-lines exceptions truth-up marker\n' "$_tu_context" >&2
    exit 0
  fi

  printf '%s\n' "$TRUTH_UP_INSTRUCTION" >&2
  exit 0
}

case "$_MUSI_TRUTH_UP_KEY" in
  lint-ratchet) _tu_run_lint_ratchet ;;
  knip-unused-exports) _tu_run_knip_unused_exports ;;
  near-duplicates) _tu_run_near_duplicates ;;
  max-lines-exceptions) _tu_run_max_lines_exceptions ;;
esac
