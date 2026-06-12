# 03k: ESLint-Rules Floor Parity

Status: Done (2026-06-12, landed in "refactor(lint): promote eslint-rules
floors")
Order: 03k (independent of the other 03 batches; worked in Ordering position
under the one-leaf-per-run rule)
Parent: `03-zero-baseline-promotion-and-scripts-inversion.md`.

## Context

`eslint-rules/` is NOT part of the `scripts/**` inversion — it is already in
normal lint — but six zero ratchets pin floors there because normal lint has
per-rule suppressions or weaker levels for custom rule implementations:

- `ratchet/core-complexity-eslint-rules` — "per-rule implementation
  complexity exceptions" in normal lint;
- `ratchet/core-no-magic-numbers-eslint-rules` — normal lint "only warns"
  and has per-rule suppressions;
- `ratchet/regexp-no-unused-capturing-group-eslint-rules` and
  `ratchet/regexp-no-useless-non-capturing-group-eslint-rules` — per-rule
  suppressions;
- `ratchet/vitest-no-commented-out-tests-eslint-rules-tests` and
  `ratchet/vitest-no-conditional-expect-eslint-rules-tests` —
  RuleTester-specific suppressions in the test family.

Drain here means raising normal lint to the ratchet's strength (error-level,
suppressions removed or narrowed to line scope with reasons), then deleting
the ratchet. Inventory first: the suppressions live in `eslint-config/*.js`
blocks and possibly inline `eslint-disable` comments in `eslint-rules/*.js`.

## Scope

1. Inventory current exceptions per rule (config blocks + inline disables);
   re-run lint with each exception removed to see live findings.
2. For each of the six: fix findings and align normal lint to the floor, or
   record a keep-narrow verdict in `evaluation-verdicts.md` (RuleTester
   patterns may legitimately need the scoped suppressions — that is a
   defensible keep for the two vitest floors).
3. Delete drained ratchets; `bun run lint:ratchet:update`.

## Definition Of Done

Each of the six eslint-rules floors is either enforced at equal-or-stricter
strength by normal lint (ratchet deleted) or has a recorded verdict
explaining the kept floor.

## Notes

- Promoted all six floors into normal lint; no keep verdicts were needed.
  The implementation-family complexity and regexp per-file suppressions were
  stale, and the eslint-rules no-magic-numbers floor now uses the shared
  ratchet options at `error` severity for `eslint-rules/*.js`.
- Removed the stale RuleTester suppressions for
  `vitest/no-commented-out-tests` and `vitest/no-conditional-expect`; the
  full `eslint-rules/*.test.js` family passes with those rules enabled.
- Deleted the six zero ratchets from the registry, baseline, harness
  manifest, generated harness-controls doc, and coverage map. As with recent
  zero-ratchet removals, `lint:ratchet:update` required the orphan-removal
  `--allow-worse` path; the debt log records this as a normal-lint promotion,
  not accepted debt.

## Verification

Umbrella gate set, plus the eslint-rules test target
(`eslint-rules/*.test.js`) — and note Leaf 07 extends guard tests over this
same config surface; avoid conflicting edits if it is in flight.
