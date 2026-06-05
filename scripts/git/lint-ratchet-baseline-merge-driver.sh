#!/usr/bin/env bash
# Git merge driver for lint-ratchet.baseline.json.
#
# The baseline is generated from the full source tree, so this driver refuses a
# textual merge. It leaves Git's current-branch temp file untouched, which keeps
# the working-tree JSON parseable, prints the recovery recipe, and exits nonzero
# so Git still records the path as conflicted.
set -euo pipefail

if [ "$#" -ne 5 ]; then
  cat >&2 <<'EOF'
lint-ratchet baseline merge driver: expected arguments %O %A %B %L %P.
Install with `bun run lint:ratchet:install-merge-driver`.
EOF
  exit 2
fi

current_file=$2
path=$5

if [ ! -f "$current_file" ]; then
  printf 'lint-ratchet baseline merge driver: current temp file missing: %s\n' "$current_file" >&2
  exit 2
fi

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

exit 1
