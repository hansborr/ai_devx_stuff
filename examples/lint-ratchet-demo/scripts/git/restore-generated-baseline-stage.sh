#!/usr/bin/env bash
# Restore one generated baseline from an unmerged Git index stage.
set -uo pipefail

usage() {
  printf '%s\n' \
    'usage: bun run baseline:restore-stage -- --ours|--theirs <baseline>' \
    'supported baselines:' \
    '  lint-ratchet.baseline.json' >&2
}

if [ "$#" -ne 2 ]; then
  usage
  exit 2
fi

side=$1
baseline=$2
case "$side" in
  --ours) stage=2 ;;
  --theirs) stage=3 ;;
  *)
    printf 'baseline:restore-stage: expected --ours or --theirs, got: %s\n' "$side" >&2
    usage
    exit 2
    ;;
esac

# porting-knob: baseline-restore-allowlist -- retarget supported generated baselines
case "$baseline" in
  lint-ratchet.baseline.json) ;;
  *)
    printf '%s\n' \
      "baseline:restore-stage: unsupported path: $baseline" \
      'baseline:restore-stage: only lint-ratchet.baseline.json is supported' >&2
    usage
    exit 2
    ;;
esac

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  printf '%s\n' 'baseline:restore-stage: current directory is not inside a Git worktree' >&2
  exit 1
}
cd "$repo_root" || {
  printf 'baseline:restore-stage: could not enter repository root: %s\n' "$repo_root" >&2
  exit 1
}

merge_head=$(git rev-parse --git-path MERGE_HEAD)
cherry_pick_head=$(git rev-parse --git-path CHERRY_PICK_HEAD)
rebase_merge_dir=$(git rev-parse --git-path rebase-merge)
rebase_apply_dir=$(git rev-parse --git-path rebase-apply)
if [ ! -f "$merge_head" ] \
    && [ ! -f "$cherry_pick_head" ] \
    && [ ! -d "$rebase_merge_dir" ] \
    && [ ! -d "$rebase_apply_dir" ]; then
  printf '%s\n' \
    'baseline:restore-stage: no merge, cherry-pick, or rebase conflict is in progress' \
    "baseline:restore-stage: if the conflict markers were already committed, restore a parseable version from a parent commit instead, e.g. \`git show HEAD^:$baseline > $baseline\` (or \`git restore --source=<good-commit> -- $baseline\`), then regenerate with the baseline's update command" >&2
  exit 1
fi

if ! git cat-file -e ":${stage}:${baseline}" 2>/dev/null; then
  printf 'baseline:restore-stage: stage %s (%s) is unavailable for %s; confirm the file is still unmerged\n' \
    "$stage" "$side" "$baseline" >&2
  exit 1
fi

canonical_repo_root=$(realpath -- "$repo_root" 2>/dev/null) || {
  printf 'baseline:restore-stage: could not resolve repository root: %s\n' "$repo_root" >&2
  exit 1
}
expected_target="$canonical_repo_root/$baseline"
target="$repo_root/$baseline"
# Resolve the destination portably. BSD/macOS realpath has no -m (allow-missing
# components) flag, so canonicalize the existing parent directory and re-attach
# the basename instead of realpath-ing the possibly-absent target file itself.
target_parent=$(realpath -- "$(dirname -- "$target")" 2>/dev/null) || {
  printf 'baseline:restore-stage: could not resolve destination directory: %s\n' "$baseline" >&2
  exit 1
}
resolved_target="$target_parent/$(basename -- "$target")"
case "$resolved_target" in
  "$canonical_repo_root"/*) ;;
  *)
    printf 'baseline:restore-stage: refusing destination that resolves outside the expected repository path: %s -> %s\n' \
      "$baseline" "$resolved_target" >&2
    exit 1
    ;;
esac
if [ "$resolved_target" != "$expected_target" ]; then
  printf 'baseline:restore-stage: refusing destination that resolves outside the expected repository path: %s -> %s\n' \
    "$baseline" "$resolved_target" >&2
  exit 1
fi

temp_file=$(mktemp "${resolved_target%/*}/.restore-generated-baseline-stage.XXXXXX") || {
  printf 'baseline:restore-stage: could not create a temporary file for %s\n' "$baseline" >&2
  exit 1
}
cleanup_temp() {
  if [ -n "${temp_file:-}" ]; then
    rm -f -- "$temp_file"
  fi
}
trap cleanup_temp EXIT

if ! git show ":${stage}:${baseline}" >"$temp_file"; then
  printf 'baseline:restore-stage: failed to read stage %s (%s) for %s; destination left unchanged\n' \
    "$stage" "$side" "$baseline" >&2
  exit 1
fi
if ! mv -f -- "$temp_file" "$resolved_target"; then
  printf 'baseline:restore-stage: failed to replace %s atomically; destination left unchanged\n' \
    "$baseline" >&2
  exit 1
fi
temp_file=

printf 'baseline:restore-stage: restored stage %s (%s) to %s\n' \
  "$stage" "$side" "$baseline"
