# 33. Ban hand-built array-literal query keys in client production code (typed keys via `queryOptions()` only)

Status: Proposed — from the 2026-07-01 AI-harness review; NOT implemented. Re-verify file:line before acting.
Lens: lint-rules · Area: client · Severity: med-high · Size: S-M · Confidence: high
Theme: typed-query-keys · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
TanStack Query cache correctness depends on key identity. A hand-built
`queryKey: ["character", id]` that drifts from the tRPC-generated key silently breaks
invalidation and optimistic updates — the classic stale-cache bug agents introduce, because
raw array keys are the dominant pattern in training data. The repo's convention is typed keys
via `trpc.*.queryOptions().queryKey` / `queryFilter()` and the central invalidation helpers in
`lib/query-invalidation.ts`. Today that convention is 100% followed in production code but
enforced by nothing — this rule codifies a currently-clean invariant before it erodes. (Codex
rated this P0 — convergent finding, though as a guard, not a cleanup.)

## Evidence
- CLAIM CORRECTION: the audit named `invite-panel.tsx` and `use-notifications.ts` as known
  offenders. Verified both are NOT offenders: `packages/client/src/components/campaign/members/invite-panel.tsx:121-144`
  derives `invitesQueryKey` from `invitesQueryOptions.queryKey`, and
  `packages/client/src/hooks/use-notifications.ts:61-68` uses
  `trpc.notification.list.queryOptions(...).queryKey` throughout. Both are examples of the
  sanctioned pattern, not violations.
- Verified current production findings: **0**. Every `queryKey: [` array literal in
  `packages/client/src` (26 sites) lives under `packages/client/src/test/` mocks
  (`mock-trpc*.ts{,x}`, `mock-trpc-helpers.ts`) using the `["test", …]` convention.
- 14 non-test files call `invalidateQueries`/`setQueryData`/`getQueryData`; all pass typed
  `queryOptions().queryKey` / `queryFilter()` objects (spot-verified `lib/query-invalidation.ts`,
  `hooks/realtime-invalidation.ts`, the `hooks/character-sheet/use-*.ts` set,
  `components/campaign/npcs/npc-panel.tsx`).
- The 8 enabled `@tanstack/query` plugin rules (`eslint-config/client-configs.js:66-73`,
  including `prefer-query-options`) do not cover key construction — verified against the
  plugin's rule list; there is no upstream "no untyped key" rule.

## Proposed direction
Cheapest v1 is config-only `no-restricted-syntax` scoped to `packages/client/src` excluding
`src/test/**` and `*.test.*`: flag `Property[key.name='queryKey'] > ArrayExpression` (and the
same array-literal shape as the first argument of `setQueryData`/`getQueryData` calls). If
selector precision proves awkward for the call-argument half, do a small local rule instead
(register per `docs/guides/local-eslint-rules.md`, pairedGuide
`docs/guides/add-client-feature-module-cache-socket.md`, policy-shape message naming
`trpc.<router>.<proc>.queryOptions()` / `queryFilter()` as the sanctioned alternative).

## Scope / caveats
- Zero production findings verified → straight to normal lint per the house rollout
  convention; no ratchet entry needed.
- Explicitly exempt `packages/client/src/test/**`: the mock layer's `["test", …]` keys are the
  point of the mocks. Do not try to make mocks use real trpc keys in this leaf.
- The rule cannot catch a *stale but typed* key (wrong procedure's queryOptions) — out of
  scope; it removes the raw-literal class only.
- Non-tRPC queries (if one ever appears, e.g. a plain `useQuery` for a static asset) would
  need an allowlisted key-factory module; none exist today, so defer that machinery.
- One small commit: config entry (or rule + tests + local-plugin registration) + a
  restricted-syntax config test row (`eslint-rules/restricted-syntax-and-globals-config.test.js`
  pattern).
