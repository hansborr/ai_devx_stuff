# Vitest Worker-Override Simplification Candidate

Status: Backlog (design-taste, not a defect)
Date: 2026-07-14

## Origin

During the `integrate/memory-hardening-2026-07` review cycles, an external
focused review proposed replacing the worker-override governance layer with a
fixed cap. Its three crash-path findings (solo-fallback admission, permissive
focused classification, `test:coverage` admission bypass) were confirmed and
fixed on the integration branch; this proposal was deliberately deferred — it
rolls back reviewed, verified design rather than fixing a defect.

## The Proposal

Set a single default `VITEST_MAX_WORKERS=6` at the Vitest choke point
(`scripts/vitest.sh`), allow only lower overrides, and delete the layered
override machinery:

- the per-project worker-cap edits in the four package Vitest configs;
- `scripts/vitest-worker-count.ts` and its tests;
- CLI-to-native-env translation and the group-0 translation-origin marker in
  `scripts/test-all.sh` / `scripts/test-changed.sh`;
- the elevated (5,580 MB) test-reservation mode in
  `scripts/verify/memory-budget.sh` (a lower-only cap makes the 3,200 MB
  reservation universally correct);
- the associated smoke-test and documentation surface.

## What the Current Design Buys (why it was kept)

- Every worker channel (`NON_SERVER_TEST_MAX_WORKERS`, native
  `VITEST_MAX_WORKERS`, CLI flags) is validated 1–8 and
  reservation-congruent: a 7–8-worker or malformed request books the elevated
  reservation instead of under-reserving.
- The precedence semantics (native-env > CLI > configured-env) were verified
  against installed Vitest 4.1.7 source; the upgrade landmarks are documented
  in `docs/agent_notes/backlog/lint-deep-dive-2026-07/77-cap-vitest-workers.md`.
- It went through nine review rounds; the behavior is correct as shipped.

The trade is complexity, not correctness: the machinery exists to make 7–8
workers *safe*, and nothing currently needs 7–8 workers.

## Decision Criteria for a Future Pass

Do the simplification if, after a few months of use:

- no workflow has needed more than 6 workers (grep session/CI logs for
  `NON_SERVER_TEST_MAX_WORKERS` / elevated-reservation admissions); and
- a Vitest major upgrade is due anyway (the translation layer is the main
  version-coupled surface — see the upgrade landmarks doc above).

Skip it if elevated-worker runs turn out to have real users, or if the
lower-only rule would silently degrade a measured fast path.

## Scope Warning

This is exactly the kind of change that spirals: it touches admission
reservations, four Vitest configs, two shell libraries, generated smoke
metadata, and `docs/ai-harness.md`. If undertaken, treat it as its own lane
with the full review-cycle discipline, not a drive-by cleanup.
