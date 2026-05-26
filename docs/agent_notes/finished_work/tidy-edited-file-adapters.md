# Tidy Edited File Adapter Wiring

Date: 2026-05-25
Branch: `feat/autonomous-batch-iteration`

## Summary

Wired the shared `scripts/ai-hooks/tidy-edited-file.sh` hook through thin
Claude and Codex adapters.

- `.claude/hooks/tidy-edited-file.sh` resolves the repository root using the
  existing Claude wrapper pattern and execs the shared script.
- `.claude/settings.json` now runs the tidy hook in the `PostToolUse`
  `Edit|Write` chain after Prisma generation and doc-length checks.
- `.codex/hooks/tidy-edited-file.sh` resolves the repository root using the
  existing Codex wrapper pattern and execs the shared script.
- `.codex/hooks.json` now runs the tidy hook for `PostToolUse` `apply_patch`
  events with a status message and 120s timeout.

Both adapters are executable.

## Verification

- `bash scripts/test-ai-hooks.sh`
- `jq . .claude/settings.json`
- `jq . .codex/hooks.json`
- `bun run verify:changed`
