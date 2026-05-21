# Leaf 10: Test-Quality Follow-ups

Status: 10a resolved (defer rule, fix 5 bugs); 10b and 10c still parked.
Sources:

- `docs/agent_notes/backlog/lint-hardening/03-vitest-test-quality-rules.md`
- `docs/agent_notes/backlog/lint-hardening/evaluation-verdicts.md`
- `docs/agent_notes/finished_work/lint-hardening-leaf-10a-vitest-conditional-expect-inventory.md`

## 10a Resolution (2026-05-19)

`vitest/no-conditional-expect` was re-inventoried on
`feature/lint-hardening-leaf-10a-vitest-conditional-expect`. 55 findings
classified as 5 bug / 6 safeParse / 20 unreachable / 16 concurrency / 8
other. Outcome: **defer the rule**, **fix the 5 bugs**. The bug fixes
landed in commit `a44e71a4` (mid-roll RNG threaded through the two
`combat-actions.test.ts` cases that previously could silently skip
assertions on a natural-1). The rule stays off because >30% of the
remaining findings are legitimate idiomatic shapes the rule cannot
distinguish from real bugs.

## Problem

The first `@vitest/eslint-plugin` slice landed a useful subset, but two
test-quality surfaces remain after the 10a resolution above:

- `eslint-plugin-testing-library` has not been evaluated for client tests.
- `eslint-plugin-jest-dom` has not been evaluated for client tests.

The Vitest inventory also deferred `vitest/prefer-to-be` and
`vitest/prefer-to-have-length`, but those were style-only findings. Revisit
them only through an explicit matcher-style cleanup, not as part of the
bug-focused `no-conditional-expect` slice.

## Scope

Promote these as separate focused slices unless a human explicitly asks for a
combined test-quality pass. This leaf already carries the Vitest bug-triage
work; do not create a separate leaf for `vitest/no-conditional-expect` unless
the promoted triage slice needs to split again.

Recommended order (10a already resolved):

1. Testing Library client `.test.tsx` inventory.
2. jest-dom client `.test.tsx` inventory.

## Candidate Work

- For Testing Library, scope to client tests only. Do not apply React Testing
  Library rules to server/shared tests.
- For jest-dom, evaluate recommended matcher rules after Testing Library
  scope is known.
- Record any reject/defer/subset verdicts in the central verdict register.

## Exit Criteria

- Each promoted plugin or rule has a clear adopt/defer/reject outcome.
- No warning-only committed migration state remains.
- Real test bugs are fixed rather than suppressed.

## Verification

- `bun run lint`
- Targeted package tests for any rewritten tests
- `bun run test:changed`
- `bun run verify:changed`
- `bun run vitest run --project=eslint-rules` if local test-location lint
  behavior changes
