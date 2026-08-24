# 194. Three mutation acknowledgments remain weaker than the canonical literal-true response contract

Status: Not started
Theme: Response contract convergence · Area: cross-cutting · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Musi's canonical mutation acknowledgment requires `{ success: true }`, so output validation catches a handler that returns false or silently falls through. Homebrew collection link/unlink and inventory deletion instead declare `{ success: boolean }`. Those three endpoints therefore accept a state the handlers never intentionally return and lose the canonical contract's fall-through protection.

The generic schema's existing home in `auth.ts` is deliberate and documented. The remaining work is convergence on that schema, not another ownership move.

## Evidence

- `packages/shared/src/schemas/auth.ts:64-72` documents `successResponseSchema` as the generic acknowledgment for mutations with no entity to return and constrains `success` with `z.literal(true)`.
- A re-derived count finds exactly 14 production router files importing `successResponseSchema` under `packages/server/src/routers`; it is already the repository's cross-domain acknowledgment.
- `packages/shared/src/schemas/homebrew-campaign.ts:5-11` independently declares link and unlink output schemas with `z.boolean()`.
- `packages/shared/src/schemas/inventory.ts:116-118` declares the third weaker `deleteOutputSchema`.
- The corresponding handlers return literal true after completing their writes: `packages/server/src/routers/homebrew-campaign.ts:64-65`, `:88-92`, and `packages/server/src/routers/inventory.ts:123-125`.
- `packages/shared/src/schemas/MODULE.md:117-124` explicitly identifies `successResponseSchema` as a cross-domain contract and warns contributors not to treat it as auth-specific or move it without broad planning.

## Proposed direction

Converge `linkCollectionOutputSchema` and `unlinkCollectionOutputSchema in packages/shared/src/schemas/homebrew-campaign.ts:5-11`, and `deleteOutputSchema` in `packages/shared/src/schemas/inventory.ts:116-118`, onto the existing canonical `successResponseSchema` in `auth.ts`, importing it directly. A non-moving compatibility alias is the outer limit; do not relocate or re-own `successResponseSchema`.

Retain the domain-named exported schema constants and inferred types where they help callers read the endpoint vocabulary, but make those constants refer to the canonical literal-true schema. Their inferred `success` property then narrows from `boolean` to `true`; there are no separately declared client copies to maintain.

Add schema coverage proving that all three domain names accept `{ success: true }` and reject `{ success: false }`. Existing router tests should continue to exercise the handlers' literal-true results.

## Scope / caveats

- The prior CQ25-115 S1 ruling is binding: [SHARED-CLUSTER-PLAN.md](../code-quality-2026-07-25/SHARED-CLUSTER-PLAN.md):571 explicitly says not to move `successResponseSchema`. Do not create a neutral response module as part of this leaf.
- Keep `registerResponseSchema` separate. `packages/shared/src/schemas/auth.ts:53-60` documents why registration's opaque acknowledgment may evolve independently.
- This is an output-contract tightening, not a handler or response-payload change: all three handlers already return literal true.
- No router ownership, mutation behavior, or client UI work is in scope.
