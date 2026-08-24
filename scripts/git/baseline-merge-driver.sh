#!/usr/bin/env bash
# One Git merge-driver body for every generated baseline.
#
# Git invokes the *installed* copy of this file, which the installer copies
# standalone into <git-common-dir>/musi/baseline-merge-driver.sh. It must stay
# dependency-free: pure bash, no sourcing of sibling scripts, all per-driver data
# embedded in the descriptor below. The clone-local merge config passes the
# driver key as the first argument, followed by Git's %O %A %B %L %P placeholders
# (see musi_baseline_driver_command in baseline-merge-driver-lib.sh).
#
# The semantic merge lives in the worktree (dispatched via bun) so a stale
# installed driver copy does not silently freeze the TypeScript logic. If that
# path is unavailable or cannot resolve the three-way merge, this shell shim
# falls back to the per-driver manual-recovery recipe and exits nonzero so Git
# still records the path as conflicted.
#
# One body replaced four near-identical driver scripts (arg guard, path
# resolution, truth-up marker, bun dispatch, fallback recipe). The
# near-duplicates copy had silently diverged — it dropped the missing-current
# -file guard and the fallback status messages the other three carried; that was
# copy-drift, not intentional trimming, so the unified body keeps the fuller
# behavior for every driver. Only the manual-recovery recipe text is genuinely
# per-driver and stays verbatim per baseline below.
set -euo pipefail

driver_key=${1:-}
shift 2>/dev/null || true

case "$driver_key" in
  lint-ratchet)
    printf '%s\n' \
      'lint-ratchet baseline merge driver registration is stale; migrate it with `bun run lint:ratchet:install-merge-driver`.' >&2
    exit 2
    ;;
  knip-unused-exports)
    driver_label="knip unused-exports"
    semantic_driver="scripts/sensor-knip-unused-exports-merge-cli.ts"
    install_hint="bun run sensor:knip-unused-exports:install-merge-driver"
    ;;
  near-duplicates)
    driver_label="near-duplicates"
    semantic_driver="scripts/sensor-near-duplicates-merge-cli.ts"
    install_hint="bun run sensor:near-duplicates:install-merge-driver"
    ;;
  max-lines-exceptions)
    driver_label="max-lines exceptions"
    semantic_driver="scripts/max-lines-exceptions-merge-cli.ts"
    install_hint="bun run lint:max-lines-exceptions:install-merge-driver"
    ;;
  *)
    printf 'baseline merge driver: unknown driver key %s (expected the metric key baked into merge.<name>.driver).\n' \
      "$driver_key" >&2
    exit 2
    ;;
esac

if [ "$#" -ne 5 ]; then
  # shellcheck disable=SC2016 # backticks are literal decoration in the message, not command substitution.
  printf '%s baseline merge driver: expected arguments %%O %%A %%B %%L %%P.\nInstall with `%s`.\n' \
    "$driver_label" "$install_hint" >&2
  exit 2
fi

base_file=$1
current_file=$2
other_file=$3
path=$5

if [ ! -f "$current_file" ]; then
  printf '%s baseline merge driver: current temp file missing: %s\n' "$driver_label" "$current_file" >&2
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
pre_merge_head_sha=""
git_dir=$(git rev-parse --git-dir 2>/dev/null || true)
if [ -n "$repo_root" ] && [ -n "$git_dir" ]; then
  pre_merge_head_sha=$(git rev-parse --verify 'HEAD^{commit}' 2>/dev/null || true)
  case "$git_dir" in
    /*) git_dir_abs=$git_dir ;;
    *) git_dir_abs="$repo_root/$git_dir" ;;
  esac
  truth_up_marker="$git_dir_abs/musi/$driver_key-baseline-postmerge-truth-up-required"
  mkdir -p "$(dirname "$truth_up_marker")" || truth_up_marker=""
fi

if [ -n "$repo_root" ] && [ -f "$repo_root/$semantic_driver" ] && command -v bun >/dev/null 2>&1; then
  if (
    cd "$repo_root"
    bun run "$semantic_driver" \
      "$base_file_abs" "$current_file_abs" "$other_file_abs" "$path" "$truth_up_marker" \
      "$pre_merge_head_sha"
  ); then
    exit 0
  fi
  printf '\n%s baseline semantic merge fell back to manual resolution.\n\n' "$driver_label" >&2
else
  printf '%s baseline semantic merge unavailable; using manual resolution.\n\n' "$driver_label" >&2
fi

print_conflict_recovery() {
  case "$driver_key" in
    knip-unused-exports)
      cat >&2 <<EOF
knip unused-exports baseline conflict: $path is generated, so do not hand-merge it.
Git kept the 'ours' side in the working tree so the JSON stays parseable.
That is the current branch during git merge and git cherry-pick.
During git rebase the sides are swapped: the kept version is the upstream
base, not the branch being rebased.

Resolve every other (non-baseline) conflict first, then run:
  bun scripts/sensor-knip-unused-exports.ts --update

Then inspect the baseline diff against both sides:
  git diff HEAD -- $path
  git diff MERGE_HEAD -- $path

MERGE_HEAD exists only during git merge; use REBASE_HEAD during a rebase or
CHERRY_PICK_HEAD during a cherry-pick.

Then run:
  git add $path
EOF
      ;;
    near-duplicates)
      cat >&2 <<EOF
near-duplicates baseline conflict: $path is generated, so do not hand-merge it.
Git kept the current side parseable. Resolve source conflicts, then run:
  bun scripts/sensor-near-duplicates.ts --update
Inspect the result against both sides before staging:
  git diff HEAD -- $path
  git diff MERGE_HEAD -- $path
EOF
      ;;
    max-lines-exceptions)
      cat >&2 <<EOF
max-lines exceptions baseline conflict: $path is a configuration ledger; do not hand-merge conflict markers.
Git kept the 'ours' side in the working tree so the JSON stays parseable.
That is the current branch during git merge and git cherry-pick.
During git rebase the sides are swapped: the kept version is the upstream
base, not the branch being rebased.

Resolve every other (non-baseline) conflict first, then inspect both sides' configured entries:
  git show :2:$path
  git show :3:$path

Hand-edit the kept file's entries to incorporate the other side's intended cap changes,
including additions and retirements.

Then normalize and validate the reconciled configuration:
  bun run lint:max-lines-exceptions:update
  bun run lint:max-lines-exceptions

Confirm the reconciled caps suffice for the merged source by running full lint:
  bun run lint
or rely on the full-lint commit gate before committing.

Then inspect the baseline diff against both sides:
  git diff HEAD -- $path
  git diff MERGE_HEAD -- $path

MERGE_HEAD exists only during git merge; use REBASE_HEAD during a rebase or
CHERRY_PICK_HEAD during a cherry-pick.

Then run:
  git add $path
EOF
      ;;
  esac
}

print_conflict_recovery

exit 1
