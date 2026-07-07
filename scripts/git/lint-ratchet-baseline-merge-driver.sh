#!/usr/bin/env bash
# Git merge driver for lint-ratchet.baseline.json.
#
# The semantic merge lives in the worktree so stale installed driver copies do
# not silently freeze TypeScript logic. If that path is unavailable or cannot
# resolve the three-way merge, this shell shim falls back to the manual recovery
# recipe and exits nonzero so Git still records the path as conflicted.
set -euo pipefail

if [ "$#" -ne 5 ]; then
  cat >&2 <<'EOF'
lint-ratchet baseline merge driver: expected arguments %O %A %B %L %P.
Install with `bun run lint:ratchet:install-merge-driver`.
EOF
  exit 2
fi

base_file=$1
current_file=$2
other_file=$3
path=$5

if [ ! -f "$current_file" ]; then
  printf 'lint-ratchet baseline merge driver: current temp file missing: %s\n' "$current_file" >&2
  exit 2
fi

absolute_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "$PWD" "$1" ;;
  esac
}

base_file_abs=$(absolute_path "$base_file")
current_file_abs=$(absolute_path "$current_file")
other_file_abs=$(absolute_path "$other_file")

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || true)
truth_up_marker=""
merge_head_sha=""
git_dir=$(git rev-parse --git-dir 2>/dev/null || true)
if [ -n "$repo_root" ] &&
  [ -n "$git_dir" ] &&
  merge_head_sha=$(git rev-parse --verify 'MERGE_HEAD^{commit}' 2>/dev/null); then
  case "$git_dir" in
    /*) git_dir_abs=$git_dir ;;
    *) git_dir_abs="$repo_root/$git_dir" ;;
  esac
  truth_up_marker="$git_dir_abs/musi/lint-ratchet-baseline-postmerge-truth-up-required"
  mkdir -p "$(dirname "$truth_up_marker")" || truth_up_marker=""
fi

semantic_driver="scripts/lint-ratchet/baseline-merge-cli.ts"
if [ -n "$repo_root" ] && [ -f "$repo_root/$semantic_driver" ] && command -v bun >/dev/null 2>&1; then
  if (
    cd "$repo_root"
    bun run "$semantic_driver" \
      "$base_file_abs" "$current_file_abs" "$other_file_abs" "$path" "$truth_up_marker" \
      "$merge_head_sha"
  ); then
    exit 0
  fi
  printf '\nlint-ratchet baseline semantic merge fell back to manual resolution.\n\n' >&2
else
  printf 'lint-ratchet baseline semantic merge unavailable; using manual resolution.\n\n' >&2
fi

# BEGIN lint-ratchet-baseline-conflict-recipe
cat >&2 <<EOF
lint-ratchet baseline conflict: $path is generated, so do not hand-merge it.
Git kept the 'ours' side in the working tree so the JSON stays parseable.
That is the current branch during git merge and git cherry-pick.
During git rebase the sides are swapped: the kept version is the upstream
base, not the branch being rebased.

Resolve every other conflict first, then run:
  bun run lint:ratchet:update

Then inspect the baseline diff against both sides:
  git diff HEAD -- $path
  git diff MERGE_HEAD -- $path

MERGE_HEAD exists only during git merge; use REBASE_HEAD during a rebase or
CHERRY_PICK_HEAD during a cherry-pick.

If the other side had lower floors, preserve them before adding the baseline
or explicitly accept the regression in the merge review.

Then run:
  git add $path

If update asks for --allow-worse, the merged code regressed past the kept floor.
Fix the findings, or accept the debt with:
  bun run lint:ratchet:update -- --allow-worse --reason "<why accepting this baseline increase is better than forcing a low-quality fix now>"
EOF
# END lint-ratchet-baseline-conflict-recipe

exit 1
