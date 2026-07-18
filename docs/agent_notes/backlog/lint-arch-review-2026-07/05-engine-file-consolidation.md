# 05 — Stop the engine fragmenting under its own rules

Status: Proposed — cap-policy ruling (item 2) recorded 2026-07-17 (landed as
leaf 02's S0); consolidation (item 1) remains, scope sharpened 2026-07-18
against the post-move tree (architecture review + codex/opus consult, see
below)
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
   **Sharpened scope — 2026-07-18** (post-move review + codex/opus consult;
   all file facts verified at HEAD that day):
   - Merge `baseline-format.ts` (103) into `baseline.ts` (227) — kills the
     mutual import (`baseline.ts` imports the formatter near its re-export
     block; `baseline-format.ts:6` imports types back). ~330 lines, under
     the 500 zone cap.
   - Fold `metrics-format.ts` (12) and `metrics-validation.ts` (15) — both
     one-line delegators to `metricStrategy()` — into `metric-strategies.ts`
     (~280 after), delete the pure re-export barrel `metrics.ts` (13), and
     repoint consumers to the real module.
   - Collapse the three debt-log schema satellites
     (`debt-log-coverage-shrink-schema.ts`, `debt-log-orphan-schema.ts`,
     `debt-log-regression-schema.ts` — imported only by the aggregator) into
     `governance/debt-log-schema.ts`: ~447 lines combined, within the cap.
     Headroom disposition below — this lands at 89% of the zone cap in a
     family that just grew a kind.
   - **Keep separate — real seams, do not merge:** `baseline-validation.ts`
     (structural parse vs registry-aware strict validation is the seam; the
     cap overshoot is corroborating, not the reason), `baseline-merge.ts`
     (3-way semantic merge
     boundary), `baseline-hash.ts` (config + rule-source identity),
     `baseline-constants.ts` (shared version policy — imported by six
     kernel files including ones staying separate),
     `baseline-merge-values.ts` (cycle-breaking primitive),
     `metrics-types.ts`/`metrics-parse.ts`/`metrics-complexity.ts`/
     `metric-comparison.ts`, the debt-log jsonl/write/accounting family,
     `governance/errors.ts`, and the eslint and group-baseline clusters.
   - Honesty note: this removes the cap-forced fragments and the one real
     cycle; it does not make "all import cycles vanish," and redesigning the
     `baseline.ts` facade/type hub is out of scope.
   - **Cap-headroom disposition — recorded 2026-07-18** (flag raised by the
     review author): the merged `debt-log-schema.ts` lands at ~447 of the
     500 zone cap, and the entry-kind family is growing (coverage-shrink is
     recent) — one more kind trips the cap. The cap is visibly steering
     shape in both directions in this leaf; that is acceptable only while
     deliberate, so the disposition is pre-decided: **growth past 500 from
     a genuine new entry kind takes a max-lines-exceptions baseline entry
     (the cap-policy ruling's escape hatch for genuine outliers), not a
     re-split of the spot just consolidated.** Re-splitting is warranted
     only if the kind family itself matures into a real seam (several more
     kinds, each schema substantial enough to stand as a module) — and
     then by kind, not back into cap-shaped satellites. The same rule
     generalizes: no future merge in this leaf needs headroom margin as a
     precondition, but any merged module that later trips the cap through
     legitimate growth gets an exceptions entry first and a seam argument
     before any split.
2. Decide the cap policy for the engine explicitly: either exempt the engine
   from the 300-line floor or accept larger caps for it (the
   max-lines-exceptions baseline is the mechanism). Record the ruling so the
   fragmentation pressure stops.

## Cap-policy ruling — 2026-07-17 (owner-delegated; four-model consult)

Item 2 is decided: **keep the ratchet enforcing, raise the floor for the
engine as zone policy — a scoped `max-lines` cap (~500) on the engine
package glob via a dedicated config block, with the max-lines-exceptions
baseline remaining the escape hatch for genuine outliers above that.**

- Full exemption was rejected unanimously across the consult (codex, Grok,
  Opus, Fable): the lint engine opting out of the flagship lint rule is the
  worst possible dogfood story for a public reference, and the cap is most
  useful exactly during a consolidation pass.
- The exceptions-baseline route was rejected on semantics (the consult
  split 2–2; the semantic argument decides it): baseline entries encode
  *debt* with lifecycle shrink pressure. "Seam-shaped engine modules
  legitimately run 300–600 lines" is deliberate policy, not debt — encoding
  it as a few dozen exception entries preserves the fragmentation pressure,
  manufactures false debt the lifecycle keeps flagging, and adds baseline
  churn to every consolidation. Zone policy belongs in config
  (`code-quality-configs.js` already parameterizes `local/max-lines` per
  file-set), where it also teaches adopters the per-zone-cap pattern.
- Sequencing: land the config block as a tiny precursor slice **before**
  leaf 02's first file move, keyed to the current paths
  (`scripts/lint-ratchet/**`, `scripts/lib/baseline/**`) and carried to
  `tools/lint-ratchet/**` as part of the move. Without it, merging
  fragments at real seams during relocation would itself trip the strict
  floor — the ratchet is currently penalizing the fix. During leaf 02, no
  *new* micro-splits; full consolidation stays this leaf's item 1.

## Sequencing

Satisfied preconditions: leaves 01/03 deleted the parallel baseline stack
(2026-07-17) and leaf 02 moved the engine to `tools/lint-ratchet`
(2026-07-18) — the paths above are the post-move ones. Independent of leaf
12 (test re-homing): the 2026-07-18 review claimed tests must move first to
halve this leaf's churn; the consult and the per-file import map refuted
that (several affected tests stay adapter-side regardless). Either order;
do not serialize.
