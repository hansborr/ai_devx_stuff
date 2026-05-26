# Leaf 2: Changed-Gate Content Correctness

Status: Resolved
Depends on: none
Blocks: adding more changed-lint or pre-commit gates

Resolved note: `lint:changed`, `verify:changed`, and pre-commit now reject
source-relevant unstaged or untracked drift before changed verification, cache
changed-mode verification by staged fingerprint, and include staged deletions
in relevant changed-gate/script-smoke selection. The duplicate follow-up leaf
was removed.

## Historical Context

The original problem and candidate work are preserved below for provenance.
All items were implemented and verified. Do not treat these as open work.

**Original problem**: `scripts/lint-changed.sh` linted the working-tree copy
of changed files without rejecting partially staged targets. Pre-commit could
verify different content than the staged commit. `.husky/pre-commit` used
`--diff-filter=ACMR`, so staged deletions did not force relevant changed
checks.

**What shipped**: staged-first changed verification with unstaged/untracked
drift rejection, staged-fingerprint cache reuse for pre-commit, staged
deletion inclusion in relevant-path selection, and full smoke coverage for
all edge cases listed in the original plan.
