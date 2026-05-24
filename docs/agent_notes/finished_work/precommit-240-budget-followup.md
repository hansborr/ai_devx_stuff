# Pre-Commit 240s Budget Follow-Up

Date: 2026-05-23
Branch: `fix/lint-alignment-gaps`

## Summary

Changed-mode manual verify now runs lint, ratchet, coverage-map, typecheck,
Vitest, and script smokes in parallel (`parallel-verify-changed`) instead of
serially. Full `verify` remains sequential.

The default pre-commit and verify watchdogs are back to the intended
`MUSI_INTERACTIVE_TIMEOUT=240` / `MUSI_INTERACTIVE_WARN_AFTER=210` budget.

`verify:changed` and pre-commit now pass the staged changed-file list into
`test:scripts:changed` through `MUSI_SCRIPTS_CHANGED_FILES` when there are no
staged deletions. Staged deletions still use the conservative full script
smoke selection.

`scripts/test-lint-ratchet.sh` no longer copies the live full ratchet registry
for fixture cases that only assert `ratchet/local-type-assertion-boundary`;
those fixtures now write a narrow one-rule registry.

## Timing

Measured in this worktree:

- `bash scripts/test-lint-ratchet.sh`: `4m46s -> 1m54s`.
- `bun run test:scripts:changed`: `2m11s` for this branch's broad script
  selection.
- `FORCE_VERIFY=1 bun run verify:changed`: `199s`, budget state OK under
  warn=210s / hard=240s.
- `FORCE_VERIFY=1 .husky/pre-commit`: `204s`, budget state OK under
  warn=210s / hard=240s.

The latest forced pre-commit run landed at 204s after including the
`ai-hooks` changed-mode metadata integration in the staged set.

## Verification

- `bash scripts/test-lint-ratchet.sh`
- `bash scripts/test-verify.sh`
- `bash scripts/test-test-scripts.sh`
- `bash scripts/test-dependency-freshness.sh`
- `bash scripts/test-ai-hooks.sh`
- `bun run lint:shell`
- `bun run lint:changed`
- `bun run test:scripts:changed`
- `FORCE_VERIFY=1 bun run verify:changed`
- `FORCE_VERIFY=1 .husky/pre-commit`
