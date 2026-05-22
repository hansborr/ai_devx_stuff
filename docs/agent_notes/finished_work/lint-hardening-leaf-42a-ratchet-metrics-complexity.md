# Leaf 42a: lint-ratchet metrics complexity drain

Date: 2026-05-21

## Scope

This leaf drained only `scripts/lint-ratchet-metrics.ts` from
`ratchet/core-complexity-lint-ratchet-runtime`. The sibling runtime files stay
for later sub-leaves:

- `scripts/lint-ratchet.ts`
- `scripts/lint-ratchet-baseline.ts`

## Change

The three over-cap functions in `scripts/lint-ratchet-metrics.ts` were split
into small file-local helpers without changing public exports or observable
behavior:

- `parseComplexitySeverityMessage` from complexity 15: extracted message-id,
  regex-group, line, and node-type validation helpers.
- `parseComplexityFunction` from complexity 14: extracted per-field parsers and
  a completion guard for persisted per-function baseline entries.
- `validateMetricItem` from complexity 15: split strict validation into
  metric-specific helpers for `effective-line-count`, `complexity-severity`,
  and the remaining count-only metrics.

The helper split preserves existing `ConfigError` messages, validation order,
strict-vs-structural baseline behavior, return shapes, and exported names.

## Baseline

`lint-ratchet.baseline.json` was lowered for
`ratchet/core-complexity-lint-ratchet-runtime`: the
`scripts/lint-ratchet-metrics.ts` item was removed entirely. No other baseline
entries changed.

## Verification

- `bun test scripts/lint-ratchet-baseline.test.ts` pre-refactor
- `bun test scripts/lint-ratchet-baseline.test.ts` post-refactor
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

Note: the broad `bun test scripts/` command also collects codemod fixture
`.test.ts` files under `scripts/codemods/fixtures` and copied worktree fixtures;
those fail module resolution before ratchet coverage. The ratchet subset above
is the applicable script-test gate for this leaf.
