# Task 33: Commit-Shape Policy Documentation

Completed 2026-05-26.

## Summary

Recorded the commit-shape policy in contributor-facing documentation without
adding CI commitlint.

## Changes

- Expanded `AGENTS.md` to state that conventional commits are required, the
  local Husky `commit-msg` hook enforces the shape, non-squash merges are
  intentional, and CI commit-shape enforcement is not added by design.
- Left `CLAUDE.md` unchanged because it delegates to `@AGENTS.md`.
- Updated stale agent-note language that still framed task 33 as CI validation
  or squash-merge PR title/body checking.
- Marked the task 33 backlog note done.

## Verification

- `bun run verify:changed` passed in 180s.
