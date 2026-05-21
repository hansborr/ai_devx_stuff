# Leaf 41e: Coverage Map Staged Check

Date: 2026-05-21

## Summary

Closed the Codex review P2 follow-up from Leaf 41d where changed/pre-commit
verification could validate a fixed worktree coverage map while committing an
older staged copy. `scripts/lint-coverage-map-check.ts` now accepts `--staged`
and reads `docs/agent_notes/backlog/lint-followups/lint-coverage-map.md` from
`git show :...` for staged gates.

`verify --changed` and `.husky/pre-commit` pass `--staged`; full `verify` and
plain `bun run docs:lint-coverage-map:check` still read the worktree by design.
A Vitest regression stages a drifty map in a temp repo, restores the worktree
map to a clean version, and proves the staged path fails while the worktree
path passes.

## Verification

- `bun run docs:lint-coverage-map:check`
- staged-drift probe with `bun run docs:lint-coverage-map:check -- --staged`
- `bash scripts/vitest.sh run --passWithNoTests --project=scripts scripts/lint-coverage-map-check.test.ts`
- `bun run lint -- --max-warnings=0`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bash scripts/test-verify.sh`
- `bun run typecheck`
- `MUSI_INTERACTIVE_TIMEOUT=900 bun run verify:changed`
