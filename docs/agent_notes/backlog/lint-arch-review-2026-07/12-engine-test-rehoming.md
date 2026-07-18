# 12 — Re-home engine-owned lint-ratchet tests into the package

Status: Proposed — filed 2026-07-18 from the post-move architecture review
(candidate 1), corrected and scoped by a codex + opus consult
Priority: P1 · Size: M · Risk: low-medium (partly a port, not a move; per-file
judgment calls)
Source: architecture review 2026-07-18 (post-leaf-02); codex/opus consult
2026-07-18. Partly unfinished leaf-02 cleanup: the `baseline.test.ts` split
was already settled in the leaf 02 slice plan ("split, and the ratcheted path
stays put" — `02-slice-plan.md`, S3 notes).

## Problem

`scripts/lint-ratchet/` holds 22 test files; 19 import `@musi/lint-ratchet`
internals. The package's own 19-file suite covers kernel + git-rail only —
`src/governance/` has 23 source files and **zero** in-package tests (verified
2026-07-18). Nothing is duplicated (zero filename overlap between the suites);
the governance layer is simply untested from inside the package, while the
adoption guide claims the package carries its behavioral coverage
(`docs/guides/lint-ratchet-adoption.md`, "what the copied tests cover"). A
copied `tools/lint-ratchet` under-delivers on the portability story.

Two corrections to the review that proposed this (it framed the move as
"copy the directory → tests travel"):

- The boundary checker scans package **tests** too
  (`tools/lint-ratchet/test/boundary/check-package-boundary.ts` — "the
  portable engine and its tests are always scanned"), so every moved test
  must satisfy zero repo-relative/`@musi/*`-external imports. Most of the 19
  need porting to fixture contexts, not moving.
- "Keep only 3 adapter tests" is wrong: `report.test.ts`,
  `baseline-merge-cli.test.ts`, and `check-registry.test.ts` test
  adapter-owned modules — 6 stay on subject-ownership grounds before any
  analysis of the rest.

## Ownership rule (acceptance criterion)

Ownership is decided by **what the assertion is about**, not what the test
imports — "exercises engine behavior through the Musi binding" does not by
itself qualify a test to stay. A test stays adapter-side only when its
assertion concerns: the real Musi registry/globs, Musi path/context
construction, harness schema / rule docs / diagnostics rendering, a
fixed-path CLI/git wrapper, or mode composition. Engine semantics move into
package fixtures. Where an adapter-side test is a governance module's *only*
coverage, split rather than move: a fixture-context unit test in the package
(recovers governance coverage) plus a thin binding smoke adapter-side.
Acceptance is semantic ownership + package self-containment, not a target
file count.

## Starting dispositions (final call per file is the implementing lane's)

- **Move (only pkg imports):** `debt-log-schema`, `edit-check-protocol`,
  `retire-promotion-proof`.
- **Move after porting `lint-ratchet.test-helper.ts`** (it imports only
  `@musi/lint-ratchet/kernel/baseline.js`, so it can move):
  `baseline-debt-accounting`, `summary`, `trend`, `zero-baseline`.
- **Move after porting `tmp-repo.test-helper.ts`** (76 loc, node+vitest
  only): `debt-log`, `git-tracked-files`.
- **Port to synthetic contexts or split** (import
  `engine-binding`/`paths`/`lint-ratchet-config`): `baseline-debt-accounting-git`,
  `debt-log-write`, `propose` — engine semantics move; any real-binding
  assertion stays as a smoke.
- **Split** (codex consult has per-file line anchors): `baseline.test.ts`
  (per the settled slice-plan ruling; harness-diagnostics import also blocks
  a whole-file move), `current-collector.test.ts` (keep the real-Musi
  ratchet-ID/glob assertion), `edit-check.test.ts` (keep production-registry
  scope assertions; move soft-skip/drift/availability behavior).
- **Stay:** `cli`, `modes`, `local-rule-fix-text`, `report`,
  `baseline-merge-cli`, `check-registry`, `output` (imports
  `packages/shared` harness-diagnostics and drives the full CLI —
  adapter integration test).

## Sequencing

Independent of leaf 05 item 1 — do not serialize. The review claimed this
leaf is a prerequisite that "halves candidate 2's import churn"; both
consults and the import map say otherwise (several affected tests stay
adapter-side regardless, and whichever lands second absorbs the other's
renames either way). Registration surfaces travel with the move: vitest
project membership, smoke subjects, coverage map.
