# 05 — Stop the engine fragmenting under its own rules

Status: Proposed
Priority: P1 · Size: M · Risk: low-medium (large mechanical moves; review churn)
Source: lint architecture review 2026-07-16 (R5) — raised by all five
reviewers (Sonnet P2, others P1).

## Problem

`scripts/lint-ratchet/` holds 84 non-test TS files for one tool (verified
at HEAD 2026-07-16), including 2-line modules (`baseline-constants.ts`,
`cli-errors.ts`) and re-export barrels (`metrics.ts` is 14 lines of pure
re-exports; `baseline.ts` carries a re-export block). Note: these do *not*
violate the repo's `local/no-barrel` rule — that rule only fires on files
named `index.ts`/`index.tsx`, so non-index barrels skate past it — but they
are exactly the shape it exists to forbid. The engine's max-lines ratchet
is leaking into its architecture: files split to satisfy the cap, not at
real seams.

## Do

1. Consolidate by concept: CLI, metrics, debt-log schema family, baseline
   codec. Keep splits only at real seams — collect / compare / merge / git.
2. Decide the cap policy for the engine explicitly: either exempt the engine
   from the 300-line floor or accept larger caps for it (the
   max-lines-exceptions baseline is the mechanism). Record the ruling so the
   fragmentation pressure stops.

## Sequencing

Cheaper after leaves 01/03 delete the parallel baseline stack (~2,000 LOC of
the file count goes away on its own); don't consolidate files those leaves
will delete.
