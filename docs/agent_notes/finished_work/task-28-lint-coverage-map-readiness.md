# Task 28: Lint Coverage Map Readiness

Date: 2026-05-26

## Landed

Documented the coverage-map gate as part of the recommended lint-ratchet and
local-rule reference design.

- `docs/guides/lint-ratchet.md` now explains the coverage map's role, drift
  findings, `--check-eslint-reach`, staged versus full mode, and the pieces
  adopters should copy or adapt.
- `docs/guides/local-eslint-rules.md` now links local-rule authors to the
  coverage-map responsibility when a `local/*` rule becomes a normal-lint or
  ratchet floor.

## Follow-Ups

- The task's read-first list mentioned `docs/generated/lint-coverage-map.md`,
  but this worktree has no file at that path. The current checker and living
  map use `docs/agent_notes/backlog/lint-followups/lint-coverage-map.md`.
  Decide later whether the reference docs should rename, mirror, or correct the
  generated-map path.
- The current map remains hand-maintained. A generator is still future work and
  should preserve the table shape expected by
  `scripts/lint-coverage-map-check.ts`.

## Verification

- `bunx prettier --check --ignore-unknown docs/guides/lint-ratchet.md docs/guides/local-eslint-rules.md docs/agent_notes/finished_work/task-28-lint-coverage-map-readiness.md`
- `bun run docs:lint-coverage-map:check -- --staged`
- `bun run docs:lint-coverage-map:check`
- `bun run verify:changed`
