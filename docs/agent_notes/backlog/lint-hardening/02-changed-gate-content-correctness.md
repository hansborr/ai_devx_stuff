# Leaf 2: Changed-Gate Content Correctness

Status: Parked
Depends on: none
Blocks: adding more changed-lint or pre-commit gates

## Problem

`scripts/lint-changed.sh` currently lints the working-tree copy of changed
files collected from base, staged, and unstaged diffs. It does not reject
partially staged lint targets, so pre-commit can verify different content than
the staged commit. `.husky/pre-commit` also uses `--diff-filter=ACMR` for
source-relevant work, so pure staged deletions do not force relevant changed
checks.

## Decision

Use staged-first changed verification. `lint:changed`, `verify:changed`, and
pre-commit should fail fast when source-relevant unstaged or untracked changes
are present. The diagnostic should tell the contributor or agent to stage the
intended commit, or stash/restore unrelated source-relevant work, before
running the gate.

This is an enforcement rule, not a soft recommendation. Commit gates must not
silently lint, typecheck, or test a different working-tree state than the staged
snapshot.

## Candidate Work

- Enforce the staged-first rule before changed gates run.
- Reject unstaged source-relevant changes rather than attempting to build exact
  staged snapshots for every tool. Typecheck and changed tests also observe the
  working tree, so the important invariant is no source-relevant working-tree
  content differs from the staged commit being verified.
- Treat a staged rename plus an unstaged source-relevant edit to the new path as
  an unstaged source-relevant violation.
- Move the changed-verification cache toward staged-state reuse: agents should
  stage the intended commit, run `bun run verify:changed` once, and have
  pre-commit skip when the staged fingerprint matches that successful run.
- Include staged deletions in pre-commit's relevant-path selection. Change the
  source-relevant skip and optional script-gate selections from
  `--diff-filter=ACMR` to `ACMRD`, or run the relevant gate whenever the
  changed-path list is empty but `git diff --cached --diff-filter=D` reports a
  relevant deletion. Do not mechanically change the unrelated freshness/doc
  advisory filters unless they get their own deletion behavior. Pick one
  approach and add a smoke test for the pure-deletion case.
- Keep `lint:changed` full-lint fallback for lint-affecting config changes, but
  make the diagnostic explicit about whether it is checking staged files,
  working-tree files, or the full repo.
- After Leaf 1 lands, make changed lint use the same `--max-warnings=0` policy
  as full lint.

This leaf does not need to wait for Leaf 1. Staged-content correctness is
independent of warning policy; two agents can promote Leaf 1 and Leaf 2 in
parallel if a human asks for that work.

## Smoke Coverage

Add focused coverage for:

- staged violation;
- unstaged relevant tracked edits;
- untracked relevant files;
- partially staged targets;
- staged deletion;
- config-change full-lint fallback;
- staged-marker pre-commit reuse;
- paths with spaces;
- clean no-op cases.

## Verification

- `bun run test:scripts:changed`
- Targeted shell smoke tests for `.husky/pre-commit` behavior.
- `bun run verify:changed`
- `bun run lint:changed`
