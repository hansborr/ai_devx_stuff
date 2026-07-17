# 25 — `no-unbounded-promise-all`, server-scoped

Status: Done — merged via `ab318d05` / `4528e972` (lint-adoption pack).
Track: L (lint rules) · Priority: P1 · Size: S
Created: 2026-07-15

> 06 ranked P2, 07 ranked P1; codex's argument won the tiebreak — it
> complements the existing transaction rules by protecting DB-pool and API
> capacity.

## Evidence (verified 2026-07-15; re-verify before implementing)

- No rule bounds `Promise.all` fan-out today. Live server `Promise.all` sites
  exist (e.g. `packages/server/src/services/character-create.ts`,
  `packages/server/src/socket/index.ts`) — audit each during the probe: the
  target is `Promise.all(collection.map(...))` over unbounded collections,
  not small static tuples.
- Musi's concurrency rules (`local/concurrency-guard`,
  `no-outer-client-in-transaction`, `no-broadcast-in-transaction`) guard
  transaction correctness but nothing guards pool/API *capacity* when a
  handler fans out one Prisma call per array element.

Failure: an agent maps a 500-element campaign roster to
`Promise.all(members.map((m) => prisma...))` and exhausts the connection
pool; every gate passes.

## Do

1. Add a server-scoped local rule flagging `Promise.all`/`Promise.allSettled`
   over a dynamic `.map(...)` (or spread of unknown length); message steers
   to chunking or a bounded-concurrency helper.
2. **Exclude small static tuples** (array literals of ≤ N elements) — that is
   the calibration that keeps this low-noise.
3. Read `docs/CONCURRENCY.md` first; if a bounded-concurrency helper is the
   steer, it may belong in the existing race-sensitive helper surface rather
   than a new util.
4. Probe, then hard-error or ratchet depending on live findings.

## Verify

```
bun run lint:probe-rule
bun run lint:eslint-rules
bun run --filter @musi/server test
```

## Acceptance

- Unbounded dynamic fan-out through `Promise.all` fails lint in
  `packages/server`; static tuples and client code are untouched.
- The message names the sanctioned bounded alternative.
