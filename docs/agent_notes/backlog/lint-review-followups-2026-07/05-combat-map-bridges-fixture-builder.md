# 05 — combat-map-bridges test fixture builder

Status: Superseded — 2026-07-19 by `../arch-plans-2026-07/06-turn-movement-server-origin.md`.
The `useMovementTracking` hook suite this leaf schedules a fixture
builder for was deleted when turn movement moved to the
server-authoritative origin (the hook, its six `renderHook` tests, and
`combat-map-bridges.test.ts` itself no longer exist); the replacement
selector tests in `turn-movement.test.ts` already use small local
builders. Nothing left to do.
Track: C (client) · Priority: P3 · Size: S

## Evidence (verified 2026-07-15 on feat/lint-adoption-2026-07 pre-land; re-verify before implementing)

- `packages/client/src/components/campaign/combat/combat-map-bridges.test.ts:11`
  onward — the movement-tracking tests repeatedly construct nearly identical
  encounter, token, map, and hook fixtures per test; scenario differences
  (active token position, tracking flag, boundary key) are buried in the
  copy-paste.

Failure: adding a movement edge-case test means copying ~20 lines of setup
and mutating two fields, so scenarios drift apart in irrelevant details and
the meaningful variation is hard to see in review.

## Do

Opportunistic — fold into the next change that touches the movement tests
rather than promoting standalone:

1. A `renderMovementTracking(overrides)` builder plus a `mapWithTokenAt(...)`
   helper, per the existing client test-helper conventions.
2. Rewrite the existing tests to state only their scenario-relevant
   overrides; behavior of the suite unchanged.

## Verify

```
bun run --filter @musi/client test -- src/components/campaign/combat/combat-map-bridges.test.ts
```

## Acceptance

Each test declares only what differs from the default scenario; a new
boundary-case test needs single-digit lines; the suite is green and asserts
the same behaviors as before the refactor.

Sources: codex cross-review simplification; Fable 5 adjudication
(opportunistic).
