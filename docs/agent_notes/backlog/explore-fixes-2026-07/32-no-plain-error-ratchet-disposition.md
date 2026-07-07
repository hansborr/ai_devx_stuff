# 32 — Decide the disposition of the `no-plain-error-in-trpc` permanent debt

Status: Done (decision made 2026-07-03: option 1)
Track: D (ratchet drain) · Priority: P2 · Size: S

## Evidence (verified 2026-07-03; re-verify before implementing)

- `ratchet/local-no-plain-error-in-trpc-server` carries exactly 5 baseline
  findings, all in `packages/server/src/services/upload-service.ts`
  (`:41,:109,:112,:117,:120`).
- `packages/server/src/routes/MODULE.md` ("Error convention") documents these
  plain `Error` throws as **load-bearing, intentional** REST-boundary
  behavior: the route's try/catch maps them to HTTP 400, deliberately not
  `TRPCError`.

So this is not drainable debt — it is a documented permanent exception
sitting in a baseline that is supposed to trend to zero. Every future reader
of the ratchet report re-discovers (or worse, "fixes") it.

## Do

Pick one, record the choice here, implement it:

1. **(Likely right)** Exempt `upload-service.ts` from the rule/ratchet
   explicitly (rule option, scoped disable with the documented reason, or
   ratchet `ignores` entry — whichever the ratchet registry supports), citing
   `routes/MODULE.md`. Baseline drops to zero → retire the ratchet per the
   zero-baseline lifecycle.
2. Keep the baseline entries as-is and add a "permanent, see MODULE.md" note
   to the ratchet registry — only if explicit exemptions are considered worse
   than standing debt.

Option 1 matches the repo's stated policy that baselines are debt to drain,
not exception registries.

## Decision

2026-07-03: Chose option 1. `upload-service.ts` remains the explicit
REST-boundary exception cited to `packages/server/src/routes/MODULE.md`;
normal ESLint now enforces `local/no-plain-error-in-trpc` for server
routers/services outside that exception, and the ratchet was retired after the
baseline reached zero.

## Verify

```
bun run lint:ratchet && bun run test -- packages/server/src/routes/upload-routes.test.ts
```

## Acceptance

The ratchet no longer reports upload-service findings as drainable debt; the
documented REST-boundary behavior is untouched; the decision and rationale
are recorded.
