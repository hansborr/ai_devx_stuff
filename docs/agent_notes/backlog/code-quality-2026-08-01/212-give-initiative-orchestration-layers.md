# 212. Give initiative orchestration layers depth-signalling names

Status: Not started
Theme: Initiative rolling obscures three orchestration depths behind two names and an alias · Area: server · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Initiative rolling crosses three service depths, but the request-facing and
caller-owned layers share `rollAllInitiative`, while the outer module conceals
that collision with an `executeRollAllInitiative` import alias. The persistence
implementation then uses that same execute-shaped name.

Those overlapping names make search results and go-to-definition navigation
ambiguous about which layer owns authorization, orchestration, randomness, and
persistence. They also depart from the depth-signalling convention documented
for adjacent combat and rest wrapper/core pairs.

## Evidence

- `packages/server/src/services/encounter-combat/initiative-action.ts:7-28` —
  the request-facing `rollAllInitiative` imports the middle layer's
  same-named export as `executeRollAllInitiative` and invokes the alias after
  authorization and state validation.
- `packages/server/src/services/combat-actions/combat-actions.ts:187-203` —
  the caller-owned middle layer is also exported as `rollAllInitiative` and
  delegates to a lower `executeRollAllInitiative`.
- `packages/server/src/services/combat-actions/initiative.ts:27-55` — the
  lowest layer named `executeRollAllInitiative` loads participants, rolls and
  sorts initiative, and persists every result in a transaction.
- `packages/server/src/services/README.md:151-172` — the service taxonomy
  requires caller-owned cores to use depth-signalling `run*Core` or `execute*`
  names and explicitly forbids same-named wrapper/core pairs.

## Proposed direction

Keep the request-facing `rollAllInitiative(ctx, input)` name, rename the
caller-owned middle export to `runRollAllInitiativeCore(opts)`, and rename the
low-level implementation to a role-specific name such as
`rollAndPersistAllInitiative(opts)`. Import each export by its declared name;
remove the `rollAllInitiative as executeRollAllInitiative` alias.

Update `packages/server/src/services/combat-actions/MODULE.md`,
`packages/server/src/services/encounter-combat/MODULE.md`, and the focused
initiative test imports and descriptions with the same vocabulary. Preserve the existing
behavioral assertions around empty encounters, random-roll bounds, sorting,
and persisted `initiative`/`sortOrder`; this should be a symbol-only change,
with no query, transaction, ordering, or broadcast edits.

## Scope / caveats

- Do not change initiative ordering, tie behavior, random-number injection,
  transaction boundaries, persisted fields, authorization, or broadcast
  ownership.
- Prior-pack record CQ25-58, task T3 in
  [53-PLAN.md](../code-quality-2026-07-25/53-PLAN.md) covers ordered
  participant reads and activation sorting, not these service names. Coordinate
  with that task if it edits
  `packages/server/src/services/combat-actions/initiative.ts`; keep naming
  changes separate from its behavioral work.
- Do not rename the public tRPC `encounterCombat.rollAllInitiative` procedure or
  the request-facing service export. The ambiguity exists below that stable
  boundary.
