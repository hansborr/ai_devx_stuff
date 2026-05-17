# Leaf 24: Parked LLM-Core Rules — Sort Fix Follow-Ups

Status: Landed (2026-05-16); both sort comparator fixes shipped previously in `0652826e` (test(server): fix numeric sort comparators (AUD-LINT-001)).
Source: `docs/agent_notes/in_progress/eslint-llm-parked-rules-verification.md`
— "Follow-up" section.

## Problem

The 2026-05-11 verification audit of `eslint-plugin-llm-core` rejected six
upstream rules after per-site verification. Two latent `.sort()` smells in
test code remain — both work today only by coincidence (uniform-width
3-digit HTTP codes; single-digit concurrency indices). They are not bugs
producing wrong output now, but they are exactly the shape
`no-incorrect-sort` was designed to surface.

## Decision

Fix the two sites by hand. Do not enable the `no-incorrect-sort` rule
itself — recall on the codebase was 2/21 signal-to-noise.

## Sites

- `packages/server/src/routers/cast-spell-concentration.test.ts:383` —
  change `codes.sort()` to `codes.sort((a, b) => a - b)` so the assertion
  stays robust to status-code width changes.
- `packages/server/src/test/race-helpers.test.ts:35` — change
  `[...seenIndices].sort()` to `[...seenIndices].sort((a, b) => a - b)` so
  the test stays correct if `concurrency` is raised past 9.

## Rollout

Both are one-character-class fixes inside test files. Pick them up the
next time these files are touched, or land as a single tiny PR.

## Verification

- `bun run test:server --run cast-spell-concentration race-helpers`
- `bun run verify:changed`

## References

- `docs/agent_notes/in_progress/eslint-llm-parked-rules-verification.md`
  — full per-rule audit. Re-read before considering any of the other five
  upstream rules (`no-empty-catch`, `max-nesting-depth`,
  `no-commented-out-code`, `no-exported-function-expressions`,
  `prefer-early-return`); the audit's verdict was "skip" on all five with
  per-site reasoning.

## Implementation Result

Both sort-comparator fixes landed earlier in commit `0652826e`
(`test(server): fix numeric sort comparators (AUD-LINT-001)`). Both
sites verified on 2026-05-16:

- `packages/server/src/routers/cast-spell-concentration.test.ts:383` —
  `.sort((a, b) => a - b)` in place.
- `packages/server/src/test/race-helpers.test.ts:35` —
  `.sort((a, b) => a - b)` in place.

The `no-incorrect-sort` rule itself remains intentionally not
adopted (2/21 signal-to-noise per the original audit).
