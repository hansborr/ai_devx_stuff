#!/usr/bin/env bash
# Post-merge / post-commit truth-up for the demo's lint-ratchet baseline.
#
# Sourced by lint-ratchet-post-merge-baseline-truth-up.sh (the thin shim a git
# post-merge/post-commit hook invokes). Orchestration stays IN-PROCESS — the shim
# sources this file rather than re-dispatching through bun — so the only
# subprocess is the check command itself.
#
# Dual-hook contract: a post-merge hook invokes the shim with the default
# "post-merge" context after a `git merge` auto-commit; a post-commit hook
# invokes it with "post-commit" after a merge completed by a plain `git commit`,
# cherry-pick, or rebase. Truth-up markers are stamped with the pre-merge HEAD and
# honored only when that stamp equals the completed commit's first parent (HEAD^1).
#
# The demo installs exactly one baseline driver (lint-ratchet); a repo with more
# drivers would key this body by metric the way the Musi adapter does.
set -uo pipefail

_tu_context="${1:-post-merge}"
_tu_baseline_file="lint-ratchet.baseline.json"

case "$_tu_context" in
  post-merge | post-commit) ;;
  *)
    printf 'lint-ratchet truth-up: unknown context %s\n' "$_tu_context" >&2
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
  _tu_marker="$_tu_git_dir_abs/musi/lint-ratchet-baseline-postmerge-truth-up-required"
fi

# Pick the base to diff the merged baseline against, per hook context. Returns
# non-zero to signal "no truth-up work" (the caller exits 0).
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
      printf '%s: ignoring stale lint-ratchet truth-up marker\n' "$_tu_context" >&2
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

_tu_run_lint_ratchet() {
  local STALE_BASELINE_INSTRUCTION RUNNING_NOTICE COULD_NOT_RUN_INSTRUCTION
  local FAILED_CHECK_INSTRUCTION VERIFIED_NOTICE
  STALE_BASELINE_INSTRUCTION="$_tu_context: merge produced a stale ratchet baseline - run: bun run lint:ratchet:update, review the diff against HEAD^1 (and HEAD^2 for a merge commit), then commit the repaired baseline as a follow-up commit (or git commit --amend if your workflow permits history rewriting)"
  RUNNING_NOTICE="$_tu_context: lint-ratchet truth-up running (check-baseline)…"
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
  [ "${LINT_RATCHET_POSTMERGE_FULL:-}" = "1" ] && run_full_check=1
  [ "$_tu_marker_present" -eq 1 ] && run_full_check=1

  local preflight_status=0
  bun run scripts/lint-ratchet/post-merge-baseline-preflight.ts >/dev/null 2>&1 \
    || preflight_status=$?
  # exit 127 means the check itself could not run (missing deps, broken install)
  # - an environment failure, not evidence of staleness.
  [ "$preflight_status" -eq 127 ] && exit 0
  [ "$preflight_status" -ne 0 ] && run_full_check=1

  [ "$run_full_check" -eq 1 ] || exit 0

  printf '%s\n' "$RUNNING_NOTICE" >&2
  local full_check_status=0 full_check_output
  full_check_output=$(bun run lint:ratchet:check-baseline 2>&1) || full_check_status=$?
  # The demo gate exits 0 only when the committed baseline exactly matches the
  # current findings; any exit 1 (a regressed/improved envelope, or a parse/stale
  # `lint:ratchet:` diagnostic) means the merged baseline needs `lint:ratchet:update`.
  # The marker stays put on every non-clean result so a capable retry at the same
  # HEAD re-runs the check (consume-only-on-success).
  if [ "$full_check_status" -eq 0 ]; then
    [ "$_tu_marker_present" -eq 1 ] && rm -f "$_tu_marker"
    printf '%s\n' "$VERIFIED_NOTICE" >&2
  elif [ "$full_check_status" -eq 127 ]; then
    printf '%s\n' "$COULD_NOT_RUN_INSTRUCTION" >&2
  elif [ "$full_check_status" -eq 1 ]; then
    printf '%s\n' "$STALE_BASELINE_INSTRUCTION" >&2
  else
    printf '%s\n' "$FAILED_CHECK_INSTRUCTION" >&2
    printf '%s\n' "$full_check_output" | tail -n 20 >&2
  fi
  exit 0
}

_tu_run_lint_ratchet
