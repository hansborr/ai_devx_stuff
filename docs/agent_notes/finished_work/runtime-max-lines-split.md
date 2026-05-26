# Runtime Max-Lines Split

Date: 2026-05-25
Branch: `feat/autonomous-batch-iteration`

## Summary

Drained `ratchet/local-max-lines-runtime` from 2 findings to 0 by splitting
the two oversized lint-ratchet runtime files. The overall `lint:ratchet`
current finding count is now 27.

## Extraction

- `scripts/lint-ratchet.ts` is now a small CLI/public-export facade.
- Runner internals moved under `scripts/lint-ratchet/`: CLI parsing, runtime
  path constants, rule-source hashing, generated ESLint config/cache handling,
  ESLint execution, current finding aggregation, diagnostics formatting, mode
  orchestration, and runtime error classes.
- `scripts/lint-ratchet-baseline.ts` is now a public baseline type/export
  facade.
- Baseline internals moved under `scripts/lint-ratchet/`: shared constants,
  config/core hash helpers, registry validation, baseline build/format,
  baseline parse/registry validation, and update-decision logic.
- `ratchet/core-complexity-lint-ratchet-runtime` and
  `ratchet/local-max-lines-runtime` now cover `scripts/lint-ratchet/**/*.ts`.
  Fixture copy lists, `test:scripts:changed`, and the lint coverage map were
  updated for the helper directory.

## Verification

- `bun run lint:ratchet:summary`
- `bash scripts/test-lint-ratchet.sh`
- `bun test scripts/lint-ratchet*.test.ts`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bun run typecheck`
- `bun run verify:changed`
