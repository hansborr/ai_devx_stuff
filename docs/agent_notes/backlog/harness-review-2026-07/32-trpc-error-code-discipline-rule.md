# 32. Enforce "use tRPC error codes consistently" with a rule banning plain `Error` throws in routers/services

Status: Done — `local/no-plain-error-in-trpc` at error for routers/services, with the documented `upload-service.ts` REST carve-out (`11f5d8f7`→`ae34ef94`).
Lens: lint-rules · Area: server · Severity: high · Size: M · Confidence: med
Theme: error-code-discipline · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
AGENTS.md (Code Standards) says "Use tRPC error codes consistently" — prose only, nothing
enforces it. A plain `throw new Error(...)` reached through a tRPC procedure surfaces to the
client as an opaque `INTERNAL_SERVER_ERROR` 500, losing the intentional code semantics the
repo cares about (e.g. the `NOT_FOUND`-on-mismatch auth convention in
`docs/authorization.md:10-11`). Agents writing service code default to `throw new Error`
because nothing pushes back at lint time. (Codex independently proposed the same rule as
`no-plain-error-in-trpc` — convergent finding.)

## Evidence
- 239 `new TRPCError` in non-test `packages/server/src` (audit said ~246; verified 239 on
  2026-07-01 — minor drift, direction unchanged).
- COUNT CORRECTION: the audit's "~29 `throw new Error(`" does not hold for the proposed scope.
  Verified: only **5** plain `throw new Error(` in non-test `routers/` + `services/` — all in
  `packages/server/src/services/upload-service.ts` (lines 41, 109, 112, 117, 120). Across all
  of non-test, non-generated `packages/server/src` it is 26, but the remainder live in
  `config/env.ts` (1), `seed/**` (7), `socket/broadcast-registry.ts` (2), and `src/test/**`
  (11) — startup, seed-CLI, and test-infra code where plain `Error` is arguably correct.
- Nuance on the 5: `upload-service.ts` is consumed by both the Fastify multipart route
  (`routes/upload-routes.ts`) and the tRPC `map` router (`routers/map.ts`), so its plain
  errors do cross a tRPC boundary via `map` procedures.
- No existing enforcement: no error-code rule in `eslint-config/local-plugin.js` rules
  registry, nothing in `eslint-config/*.js`.

## Proposed direction
Scoped `no-restricted-syntax` first (cheap): in `packages/server/src/routers/**` and
`packages/server/src/services/**` (non-test), ban `ThrowStatement > NewExpression[callee.name='Error']`
with a message pointing at `TRPCError` and `docs/authorization.md`. If the inventory
review wants more precision (allowing internal invariant throws that a router catches and
re-wraps), upgrade to a local rule with the house parseable-marker escape
(`// plain-error-boundary: <reason>`, same mechanism as `type-assertion-boundary` — see
AGENTS.md Code Standards). A second, later half (separate leaf-sized decision) could validate
that `new TRPCError({ code })` uses only codes the repo intends per surface; do not bundle it
here.

## Scope / caveats
- Rollout: with only 5 findings, prefer fixing `upload-service.ts` outright (convert to
  `TRPCError({ code: "BAD_REQUEST" | "UNSUPPORTED_MEDIA_TYPE"-equivalent })` or a typed
  domain error the Fastify route maps to a 4xx) and land the rule at zero findings in normal
  lint. If the upload-route error-mapping refactor is judged non-trivial, follow the house
  convention instead: ratchet entry with the 5-finding baseline
  (`docs/guides/lint-ratchet.md`, "Adding a new rule to an already linted area").
- Keep `seed/**`, `config/env.ts`, `socket/**`, and `src/test/**` out of scope — those are
  not tRPC surfaces; widening scope there is what would have produced the audit's inflated
  ~29 count.
- Watch for `throw err` re-throws and custom error subclasses — the selector above only
  catches direct `new Error(...)`; that is intentional for v1 (subclass throws are a design
  decision, not an accident).
- One small commit: config entry (or rule + tests + registration) + the upload-service fix +
  baseline/ratchet registration if needed.
