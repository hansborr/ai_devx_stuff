# Leaf 13: Core Footgun Deferred Rules

Status: 13a (server services) and 13b (`{ props: true }`) re-inventoried
and deferred; both deferred core-rule slices are resolved for this
follow-up.
Sources:

- `docs/agent_notes/backlog/lint-hardening/10-builtin-ai-footgun-rules.md`
- `docs/agent_notes/backlog/lint-hardening/evaluation-verdicts.md`

## 13a Resolution (2026-05-19)

`no-await-in-loop` re-inventoried over `packages/server/src/services/**`
(excluding tests). 7 findings classified as 3 intentional-sequential /
1 promise-all-safe / 3 transaction-boundary / 0 rate-limit-boundary /
0 other. Outcome: **defer the rule for this family**. The
distribution is dominated by post-commit fan-out preserving observable
order and Prisma `$transaction`-client serialization, which the rule
cannot distinguish from real bugs without per-site disables. No
production rewrite landed; the single promise-all-safe candidate at
`character-delete.ts:50` is a deletion-path optimization, not a bug.

## 13b Resolution (2026-05-19)

`no-param-reassign` with `{ props: true }` re-inventoried over
`scripts/**/*.ts`, `packages/client/src/**/*.{ts,tsx}`,
`packages/server/src/**/*.ts`, and `packages/shared/src/**/*.ts`
(excluding tests except the intentional
`packages/client/src/test/mock-trpc.tsx` helper). 17 findings classified
as 9 intentional-helper-state / 4 canvas-mutation / 2 accumulator /
1 prisma-update-input / 1 mock-state / 0 other. Outcome: **defer the
option for this scope**. The distribution is entirely deliberate
mutation boundaries: CLI parser state, Canvas 2D context properties,
lazy cache/compiler-path accumulators, a documented Prisma dynamic
update input, and test mock state. No production rewrite landed; the
inventory surfaced no genuine bug or small bug-prevention cleanup.

## Problem

Leaf 10 adopted the tractable core ESLint rules, but two higher-churn options
remain deferred:

- `no-await-in-loop`
- `no-param-reassign` with `{ props: true }`

## Scope

Revisit only with a focused classification slice. The first inventory showed
164 `no-await-in-loop` findings dominated by deliberate sequential code and 17
property-reassignment findings across canvas, CLI parser state, and cache
initialization patterns.

## Candidate Work

- For `no-await-in-loop`, classify one package or script family into:
  intentional sequential behavior, safe `Promise.all` rewrite, transaction or
  rate-limit boundary, and test scenario setup.
- For `{ props: true }`, pick one family such as canvas context handling or
  CLI parser state and decide whether refactor improves readability.
- Promote a rule only after a meaningful subset has real bug-prevention value.
- Reject or keep deferred if the rule remains mostly style pressure.

## Exit Criteria

- One deferred rule has a new adopt/defer/reject verdict, or one focused
  cleanup slice lands without enabling the rule yet.
- Any adoption comes with targeted tests for behavior-sensitive rewrites.

## Verification

- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- Targeted package/script tests for rewritten code
- `bun run verify:changed`
