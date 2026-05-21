# Leaf 9: Changed-Gate Content Correctness

Status: Parked
Source: `docs/agent_notes/backlog/lint-hardening/02-changed-gate-content-correctness.md`

## Problem

Changed gates can observe working-tree content that differs from the staged
commit. Pre-commit can also miss relevant pure deletions when source-relevant
selection excludes deleted paths.

## Scope

Make changed verification staged-first:

- `lint:changed`, `verify:changed`, and pre-commit should fail fast when
  source-relevant unstaged or untracked changes are present.
- Pre-commit relevant-path selection should include staged deletions.
- Diagnostics should tell contributors to stage the intended commit or
  stash/restore unrelated source-relevant work.

## Candidate Work

- Enforce the staged-first rule before changed gates run.
- Treat partially staged lint targets as violations.
- Treat staged rename plus unstaged relevant edit to the new path as a
  violation.
- Include staged deletions in relevant-path selection.
- Keep the full-lint fallback for lint-affecting config changes, with clearer
  output about what is being checked.
- Move changed-verification cache reuse toward staged fingerprints.

## Exit Criteria

- Pre-commit verifies the content that will be committed.
- Pure staged deletions trigger relevant changed gates.
- Clean no-op cases still skip quickly.

## Verification

- `bun run test:scripts:changed`
- Targeted shell smoke tests for `.husky/pre-commit`
- `bun run lint:changed`
- `bun run verify:changed`
