#!/usr/bin/env bash
# Advisory post-merge truth-up for lint-ratchet.baseline.json.
set -uo pipefail

STALE_BASELINE_INSTRUCTION="post-merge: merge produced a stale ratchet baseline - run: bun run lint:ratchet:update, review the diff against both parents, then git commit --amend"

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$repo_root" || exit 0

truth_up_marker=""
git_dir=$(git rev-parse --git-dir 2>/dev/null || true)
if [ -n "$git_dir" ]; then
  case "$git_dir" in
    /*) git_dir_abs=$git_dir ;;
    *) git_dir_abs="$repo_root/$git_dir" ;;
  esac
  truth_up_marker="$git_dir_abs/musi/lint-ratchet-baseline-postmerge-truth-up-required"
fi

git rev-parse --verify 'ORIG_HEAD^{commit}' >/dev/null 2>&1 || exit 0

truth_up_marker_present=0
if [ -n "$truth_up_marker" ] && [ -f "$truth_up_marker" ]; then
  truth_up_marker_present=1
  marker_merge_head=$(sed -n 's/^merge-head=//p' "$truth_up_marker" 2>/dev/null | head -n 1)
  rm -f "$truth_up_marker"
  if [ -n "$marker_merge_head" ]; then
    # A stamped marker belongs to the merge whose MERGE_HEAD it recorded. If
    # that merge was aborted, the leftover marker must not force a full
    # baseline check on the next unrelated merge; honor it only when this
    # merge commit's second parent matches the stamp. Unstamped markers keep
    # the previous always-honor behavior (safe direction: over-check).
    merged_parent=$(git rev-parse --verify --quiet 'HEAD^2' 2>/dev/null || true)
    if [ "$merged_parent" != "$marker_merge_head" ]; then
      truth_up_marker_present=0
    fi
  fi
fi

if ! git diff --name-only ORIG_HEAD HEAD -- lint-ratchet.baseline.json \
    | grep -qx 'lint-ratchet.baseline.json'; then
  if [ "$truth_up_marker_present" -eq 0 ]; then
    exit 0
  fi
fi

# Without bun (GUI git clients, minimal shells) staleness cannot be
# evaluated; stay silent rather than misreport an environment gap as a
# stale baseline.
command -v bun >/dev/null 2>&1 || exit 0

run_full_check=0
if [ "${MUSI_RATCHET_POSTMERGE:-}" = "full" ]; then
  run_full_check=1
fi
if [ "$truth_up_marker_present" -eq 1 ]; then
  run_full_check=1
fi

preflight_status=0
bun run scripts/lint-ratchet/post-merge-baseline-preflight.ts >/dev/null 2>&1 \
  || preflight_status=$?
# exit 127 means the check itself could not run (missing deps, broken
# install) - an environment failure, not evidence of staleness.
if [ "$preflight_status" -eq 127 ]; then
  exit 0
fi
if [ "$preflight_status" -ne 0 ]; then
  run_full_check=1
fi

if [ "$run_full_check" -eq 1 ]; then
  full_check_status=0
  bun run lint:ratchet:check-baseline >/dev/null 2>&1 || full_check_status=$?
  if [ "$full_check_status" -ne 0 ] && [ "$full_check_status" -ne 127 ]; then
    printf '%s\n' "$STALE_BASELINE_INSTRUCTION" >&2
  fi
fi

exit 0
