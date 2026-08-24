# 172. Three advisory suites hand-copy the complete bounded-history fixture

Status: Landed on fix/cq-172
Theme: Shared advisory fixtures · Area: harness · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Three drift-ai advisory suites independently construct the same commit record,
file change, and complete `BoundedFullHistory` fixture. The repeated setup
obscures the scenario-specific inputs and makes every addition to the history
contract a synchronized test-maintenance task.

The third copy in `birth-size-delta-advisory.test.ts` was omitted from the
original inventory. It is materially identical to the other two, so extracting
only the named pair would leave the duplication in place.

## Evidence

- `scripts/drift-ai/bounded-full-history.ts:83-103` defines the complete
  `BoundedFullHistory` contract whose records, caps, scanned range, truncation
  state, disclosure fields, timing, and error state each fixture must populate.
- `scripts/drift-ai/ownership-advisory.test.ts:14-73` spends 60 lines defining
  `rec`, `change`, and `history`; the suite-specific advisory scenario does not
  begin until `:76`.
- `scripts/drift-ai/test-orphaning-advisory.test.ts:14-73` repeats those same
  60 lines. A direct comparison differs only at `:67`, where `elapsedMs` is `9`
  instead of the ownership suite's `12`.
- `scripts/drift-ai/birth-size-delta-advisory.test.ts:18-77` contains a third
  copy of the same three helpers, differing from the ownership copy only in
  `elapsedMs: 7` at `:71`.

## Proposed direction

Extract the duplicated `rec`/`change`/`history` `BoundedFullHistory` fixture
from `ownership-advisory.test.ts` and
`test-orphaning-advisory.test.ts` into a shared drift-ai test helper, for example
`bounded-history.test-helper.ts`, that accepts per-suite overrides.

Include `birth-size-delta-advisory.test.ts` in the same extraction. The helper
should:

- Export explicitly named factories for a `CommitRecord`, a file change, and a
  complete `BoundedFullHistory`.
- Keep the common caps, disclosure, range, and completion defaults in one place.
- Accept records and `Partial<BoundedFullHistory>` overrides so individual
  suites can express only the facts relevant to their scenarios.
- Replace all three local helper blocks and remove their now-redundant type and
  disclosure imports.

## Scope / caveats

- This is test-fixture consolidation only; do not move construction policy into
  production history collection code.
- Preserve a suite's existing `elapsedMs` through an override if its rendered
  output depends on that value. Do not silently choose one copy's value as the
  semantic default.
- Do not absorb the differently shaped `CollectedHistory` helpers in the
  hotspot and coldspot suites; this leaf covers the three structurally identical
  complete-history fixtures only.
- There is no sequencing dependency or prior-pack ruling for this extraction.
