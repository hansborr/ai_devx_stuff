# 04 — lint-message-eval: paired iteration delta

Status: Done — `952d67eb` (paired-only delta; real test file is `scripts/lint-message-eval.test.ts`)
Track: T (tooling) · Priority: P3 · Size: S

## Evidence (verified 2026-07-15 on feat/lint-adoption-2026-07 pre-land; re-verify before implementing)

- `scripts/lint-message-eval/evaluator.ts:165` — control and treatment
  averages independently exclude unresolved arms, so `averageIterationDelta`
  can compare different fixture populations and report a misleading
  treatment effect when resolution rates differ between arms.
- Mitigating context (why P3, not P1): resolution counts ARE reported
  alongside the averages, so a skewed comparison is visible to a careful
  reader — this is a methodology improvement, not a silent-wrong number.

Failure: a message change that makes hard fixtures newly resolvable can
show a *worse* average delta (it added slow solves to one population only),
steering message tuning in the wrong direction.

## Do

1. Compute the iteration delta from paired fixtures where both arms
   resolved; report unpaired resolutions separately (they are signal too —
   "treatment resolved 3 fixtures control could not").
2. Keep the per-arm resolution counts in the output unchanged.

## Verify

```
bun run test:scripts:file -- scripts/lint-message-eval/evaluator.test.ts
bun run verify:changed
```

## Acceptance

A fixture set where the treatment resolves a superset of control fixtures
reports a paired delta over the intersection plus an explicit
newly-resolved count, and a test pins that asymmetric resolution no longer
skews the average.

Sources: codex cross-review P2; Fable 5 adjudication (verified, deferred).
