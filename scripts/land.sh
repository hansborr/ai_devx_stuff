#!/usr/bin/env bash
# Land the current feature branch into the protected branch behind a FULL
# verify gate.
#
# Usage: bash scripts/land.sh   (run from the feature-branch worktree)
#
# Why this exists: pre-commit can run in fast-commit mode (skips the slow
# `test` / `scripts` slots — see scripts/verify/steps-lib.sh), which lets an
# autonomous workflow land many cheap commits on a feature branch. This script
# is the backstop: it runs the full, sequential `bun run verify` (which always
# runs every slot, fast-commit marker or not) before integrating, then merges
# with `--no-ff`. The merge deliberately skips the pre-commit hook (git does not
# run it for merge commits), so the heavy gate runs exactly once here.
#
# Not automatic: the push is left to a human. This script never pushes.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT" || exit 1

branch="$(git symbolic-ref --short HEAD 2>/dev/null || true)"
if [ -z "$branch" ]; then
  echo "land: HEAD is detached — run from a feature branch." >&2
  exit 1
fi
case "$branch" in
  main | master)
    echo "land: already on $branch — run from a feature branch." >&2
    exit 1
    ;;
esac

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "land: uncommitted changes — commit or stash them first." >&2
  exit 1
fi

echo "land: running full verify on $branch …"
# Full (no-flag) verify is sequential and always runs test + scripts. The heap
# bump mirrors the known full-gate OOM-at-4GB issue.
NODE_OPTIONS="--max-old-space-size=6144" bun run verify

echo "land: verify passed — merging $branch into main (--no-ff; skips pre-commit by design)"
# Single-worktree assumption: `git switch main` fails if main is checked out in
# a sibling worktree. Multi-worktree support is intentionally out of scope.
git switch main
git merge --no-ff "$branch"

echo "land: merged $branch → main. Review the merge, then push when ready (push is NOT automatic)."
