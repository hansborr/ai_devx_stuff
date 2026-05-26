# Lint System Improvements Backlog Migration

Completed 2026-05-26.

## Summary

Migrated the 2026-05-26 lint-system review synthesis, preserved by commit
`a0975f3a`, into a split backlog folder:
`docs/agent_notes/backlog/lint-system-improvements/`.

## Changes

- Added `00-index.md` as the ordering and promotion source.
- Added 19 initial leaf task notes so agents can promote one item without
  rereading the full review synthesis. A same-day review follow-up split the
  oversized harness execution-manifest leaf into `07a`-`07d`, bringing the
  folder to 22 promotable leaves.
- Preserved the source review's non-goals and design principles in the index.
- Called out overlaps with `lint-reference-readiness/` where the new queue
  refines or duplicates older lint-reference tasks.
- Updated `docs/agent_notes/backlog/README.md` and `docs/agent_notes/LOG.md`
  so future sessions can find the migrated queue.

## Leaf Split

- Correctness and parity: CI coverage-map gate, CI lint step deduplication,
  ratchet CI pass deduplication, and verify/CI ratchet parity.
- Policy ownership: derived linted-script reinclude patterns, ratchet
  suppression metadata, harness controls simple-slot validation, harness tier
  metadata, harness runner generation, harness changed semantics, and parallel
  runner unification.
- Portability and performance: pinned agent-hook tools, lint tool doctor
  parity, CI ESLint cache spike, and CI validate fanout.
- Policy clarity: warning severity semantics, max-lines lifecycle,
  `eslint.config.js` entrypoint exports, and `lint:agent` alias retirement.
- Architecture and adopter docs: TypeScript hook runner spike, fast edit-loop
  linter spike, and lint platform positioning.

## Judgment Calls

- The source review's suggested roadmap grouped the work into about 13 items.
  The migration used smaller leaves where implementation owners, verification
  gates, or rollback risk differed. CI wiring, ratchet behavior, ESLint policy
  data, hook portability, and documentation clarity each need separate
  promotion points.
- Commentary trimmed from the leaves was mostly point-in-time audit narrative,
  repeated rationale, or implementation speculation. The active backlog keeps
  context, scope, definition of done, verification, overlap, and non-goal
  details that future agents need before editing code.
- The harness execution-manifest work was intentionally split after review
  because it mixed simple command-slot validation, tier metadata, runner
  generation, and changed/staged input semantics. Those are now separate
  `07a`-`07d` leaves.

## Verification

- Markdown files were formatted by the post-edit tidy hook during patching.
- `bunx prettier --check --ignore-unknown docs/agent_notes/backlog/lint-system-improvements/*.md docs/agent_notes/backlog/README.md docs/agent_notes/LOG.md docs/agent_notes/finished_work/lint-system-improvements-backlog-migration.md`
- `git diff --check`
- `bun run verify:changed`
