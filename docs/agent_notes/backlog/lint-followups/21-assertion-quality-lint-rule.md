# Leaf 21: Assertion-Quality Lint Rule

Status: Resolved - deferred after 2026-05-19 inventory
Sources:

- `docs/agent_notes/backlog/lint-hardening/15-assertion-failure-quality.md`
- `docs/agent_notes/backlog/lint-hardening/03-vitest-test-quality-rules.md`

## Resolution (2026-05-19)

Leaf 21 re-ran the assertion-quality inventory on
`feature/lint-hardening-leaf-21-assertion-quality` and deferred the local rule.
The `expectParseSuccess` / `expectParseFailure` migration is complete for the
target bug class: 38 files now use the helpers, there are 0 raw
`.safeParse(...).success` test assertion sites, and there are 0
`.safeParseAsync(...).success` rows.

The one raw `.safeParse(...).success` row is production schema logic in
`packages/shared/src/schemas/map-inputs.ts:36`, where a Zod `.refine(...)`
predicate accepts upload paths or URLs. The broader `.success` test assertions
are tRPC response-body `{ success: boolean }` checks or a `toast.success` spy,
not Zod parse results. A wider `.success` scan also found only post-helper Zod
result narrowing guards for data/error detail assertions.

Verdict: defer. A local rule today would either have no target findings or
would risk false positives on the production refine predicate, tRPC response
bodies, toast spies, and legitimate post-helper narrowing. Revisit only after
a real regression to the old pattern or after a wider parse-result helper
surface such as `safeParseAsync(...)` needs lint protection.

Detailed inventory:
`docs/agent_notes/finished_work/lint-hardening-leaf-21-assertion-quality-inventory.md`.

## Problem

`expectParseSuccess` and `expectParseFailure` migrated the current Zod
parse-result boolean assertions, but no lint rule prevents the old pattern
from returning.

## Scope

Decide whether to add a local lint rule for Musi-specific result-state
assertions after the helper pattern has had enough usage to prove its shape.

Candidate patterns:

- `expect(schema.safeParse(value).success).toBe(true)`;
- captured `.safeParse(...).success` assertions;
- `validateHomebrewData(...).success` assertions;
- broader `result.ok` / `success` boolean assertions only when a richer helper
  exists and false positives are understood.

## Candidate Work

- Inventory new boolean result-state assertions since the helper migration.
- Confirm Vitest rules do not already cover the bug class.
- Add local rule fixtures for valid helper usage and invalid boolean
  assertions.
- Keep the diagnostic tied to a named helper such as `expectParseSuccess` or
  `expectParseFailure`.
- Avoid a generic assertion-style rule unless there is a proven high-signal
  result type family.

## Exit Criteria

- Either a local rule lands for the narrow Zod/homebrew parse-result family,
  or the leaf records that helper usage plus existing Vitest rules are enough.

## Verification

- `bun run vitest run --project=eslint-rules`
- `bun run lint -- --max-warnings=0`
- Targeted package tests if assertions are migrated
- `bun run verify:changed`
