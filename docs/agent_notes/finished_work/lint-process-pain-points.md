# Lint Process Pain Points

Completed 2026-05-27.

## Summary

Finished the actionable items from
`docs/agent_notes/backlog/lint-system-improvements/20-lint-process-pain-points.md`.

## Changes

- Made the PostToolUse lint coverage hook ratchet-aware so files covered by
  committed ratchet entries no longer emit misleading normal-ESLint warnings.
- Documented staging intended source-relevant changes before
  `bun run verify:changed` in `AGENTS.md`.
- Removed hardcoded local ratchet generated key suffixes from
  `scripts/test-lint-ratchet.sh`.
- Added a focused portable runtime import-boundary check before the copied
  ratchet runtime smoke.
- Split JSX `type-assertion-boundary` RuleTester coverage into smaller named
  groups.
- Left earlier edit-time complexity feedback deferred unless it recurs.

## Verification

- `bash scripts/ai-hooks/test.sh`
- `bash scripts/test-lint-ratchet.sh`
- `FORCE_VERIFY=1 bun run test -- --project=eslint-rules type-assertion-boundary.test.js`
- `bun run format:changed:check`
