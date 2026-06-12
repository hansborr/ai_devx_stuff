# 13b: Parameterized Complexity-Message Parser Shape Test

Status: Done (2026-06-12, landed in "test(lint): cover complexity message labels")
Order: 13b
Source: carried forward from the deleted legacy Leaf 42 note during the
2026-06-11 backlog cleanup (formerly item 2 of the Leaf 13 bundle).

## Context

`scripts/lint-ratchet/lint-ratchet-metrics.ts` parses core ESLint
`complexity` messages by regex. The goal is insurance against an upstream
ESLint message-shape change, not a behavior rewrite.

If 03d1 has landed, the parser may have moved into one of the split metrics
modules — locate it first (03d1's notes name the new module).

## Scope

Add a table-driven test in
`scripts/lint-ratchet/lint-ratchet-baseline.test.ts` covering representative
`getFunctionNameWithKind` labels such as `Function 'foo'`, `Method 'foo'`,
and `Arrow function`.

## Definition Of Done

The complexity-message regex has table-driven coverage for the
representative message shapes, so an upstream message change fails a focused
test instead of silently miscounting.

## Verification

- `bash scripts/vitest.sh run scripts/lint-ratchet/lint-ratchet-baseline.test.ts`
- `bun run typecheck`
- `bun run verify:changed`

## Notes

- 2026-06-12: Parser had moved to
  `scripts/lint-ratchet/lint-ratchet-metrics-complexity.ts` after 03d1.
  Existing behavior already accepted the representative core labels; added
  table-driven coverage in `lint-ratchet-baseline.test.ts` for `Function`,
  `Method`, and `Arrow function` labels while preserving the missing-messageId
  and rejection coverage.
- Verification passed:
  `bash scripts/vitest.sh run scripts/lint-ratchet/lint-ratchet-baseline.test.ts`,
  `bun run typecheck`, and `bun run verify:changed`.
