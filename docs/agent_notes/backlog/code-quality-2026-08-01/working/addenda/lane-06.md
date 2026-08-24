# Phase-1 hotspot addendum — lane 06 (tests)

Status: Dispatch material — not a schedulable note

Lane-00 signals for your scope (full map: `working/hotspots.md`):

- **Giant suites** (size = maintenance surface; judge shape, not length
  alone): `scripts/drift-ai.test.ts` **2,765 lines**, drift-triage tests
  1,144, several other drift-ai suites > 800;
  `packages/shared` `homebrew.test.ts` 1,228 and
  `encounter-inputs.test.ts` 1,030, `spellcasting` test 676; the
  map-canvas-store test 808; `sheet-layout` test has 19 revisions
  (production file: 8 fix/reverts — check whether the test churns with it
  or lags it).
- **Test-clone mass:** the triage reducer deferred 460 test-only literal
  rows and 48 test-only clone pairs by policy, and the eslint-rules Dolos
  top 40 is **entirely test-only clone pairs** — that deferred mass is
  yours to weigh: is it healthy table-driven repetition or copy-paste
  suites wanting helpers/fixtures?
- `scripts/tests/` (shell-smoke substrate) had **134 pinned-range file
  touches** — the highest churn of any scripts subdirectory. Weight it
  heavily; the prior audit read little of it.
- Layer-direction: the reducer's three review-first rows all involve a
  **utility test importing service-layer files** in `packages/server` —
  test-shaped layering is squarely yours.

Weighting: scripts-side suites (drift-ai tests, shell-smoke substrate)
first, the giant shared/client suites second, e2e and configs at normal
weight.
