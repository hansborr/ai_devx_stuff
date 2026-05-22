# Leaf 42b: lint-ratchet script complexity drain

Date: 2026-05-21

## Scope

This leaf drained only `scripts/lint-ratchet.ts` from
`ratchet/core-complexity-lint-ratchet-runtime`. The sibling
`scripts/lint-ratchet-baseline.ts` runtime complexity debt remains for the
next sub-leaf.

## Change

The two over-cap functions in `scripts/lint-ratchet.ts` were split into small
file-local helpers without changing public API or observable behavior:

- `parseArgs` from complexity 22: moved indexed flag walking into
  `parseArgFlags` / `consumeParsedArg`, with mode and reason handling in
  focused helpers. `UsageError` messages and return shape are unchanged.
- `addFinding` from complexity 13: extracted independent `lines` and
  `perFunction` merge helpers while preserving count, earliest-line, max-lines,
  and complexity append behavior.

`scripts/lint-ratchet-baseline.ts` and `scripts/lint-ratchet-metrics.ts` were
not touched.

## Baseline

`lint-ratchet.baseline.json` was lowered for
`ratchet/core-complexity-lint-ratchet-runtime`: the
`scripts/lint-ratchet.ts` item was removed entirely. No other baseline entries
changed.

## Verification

- `bun run lint -- --max-warnings=0`
- `bun run lint:ratchet`
- `bun run lint:ratchet:update`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bash scripts/test-lint-changed.sh`
- `bun run lint:shell`
- `bun run lint:config-sensors`
- `bun run typecheck`
- `bun test scripts/lint-ratchet*.test.ts`
- `MUSI_INTERACTIVE_TIMEOUT=900 bun run verify:changed`
