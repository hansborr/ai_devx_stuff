# 49. The player and monster attack hooks each own a full private copy of the stateful target-pick lifecycle

Status: Not started
Theme: attack target-pick lifecycle duplication · Area: client · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Resolving an attack from the VTT drawer is a multi-step stateful protocol: load
the active map, derive which tokens are eligible targets, close the drawer,
activate the map's target-pick overlay, fire the `attemptAttack` mutation on
pick, invalidate the encounter detail and combat-log queries on success, and
restore the correct drawer whether the pick lands or is cancelled. Two hooks —
`useWeaponAttack` (115 lines) and `useMonsterAttack` (97 lines) — each own that
entire protocol independently. The only shared piece is the token-to-participant
eligibility mapping in `drawer-targeting.ts`; everything else — the gated
`map.get` query, the tokens memo, the mutation with its two invalidations and
error toast, the close → pick → restore sequence, the empty-eligibility guard —
is written twice.

The copies have already drifted in quiet ways. The weapon hook derives
eligibility lazily inside `apply`, while the monster hook memoizes it up front.
Their `canAttack` gates are also expressed differently: weapon checks non-empty
encounter/map IDs, a non-null attacker, and `tokens.some`; monster checks
`mapId !== null` and `eligible.size > 0`. Their restore syntax differs, but both
installed callbacks capture the values from the invocation that created them. Every future attack mode — spell attacks are the
obvious next one — either adds a third copy of the protocol or forces the
unification this leaf does now, and any fix to cleanup, eligibility,
invalidation, or restoration behavior must be discovered and applied twice.

## Evidence

- `packages/client/src/hooks/vtt-drawer/use-weapon-attack.ts:36-115` — the
  player hook owns the full lifecycle: `map.get` query gated on `hasMap`
  (`:44-47`), success invalidations `invalidateEncounterDetail` +
  `invalidateEncounterCombatLogs` (`:49-53`), the
  `encounterCombat.attemptAttack` mutation with `onTRPCError({ action:
  "resolve attack" })` (`:55-62`), the tokens memo (`:66-69`), `canAttack` via
  a `tokens.some` scan (`:70-77`), and `apply` (`:79-112`) doing eligibility
  derivation (`:83`), the `eligible.size === 0` guard (`:84`), drawer close
  (`:89`), `activateTargetPick` (`:90`), the `mode: "character"` payload
  (`:95-102`), and `openCharacter` restore on both pick and cancel
  (`:104`, `:107`).
- `packages/client/src/hooks/vtt-drawer/use-monster-attack.ts:34-97` — the
  monster hook repeats the same protocol step for step: gated `map.get` query
  (`:41-44`), tokens memo (`:45-48`), the same mutation with the same two
  invalidations and `onTRPCError({ action: "resolve monster attack" })`
  (`:49-57`), `apply` (`:64-94`) with the empty-eligibility guard (`:66`),
  drawer close (`:67`), `activateTargetPick` (`:68`), the `mode: "custom"`
  payload (`:73-84`), and `openMonster` restore on pick and cancel
  (`:86`, `:89`).
- `packages/client/src/hooks/vtt-drawer/drawer-targeting.ts:35-49` —
  `eligibleTargetParticipants` is the only piece of the protocol that has been
  extracted and shared.
- Capture syntax differs, but semantics do not: weapon copies `characterId` /
  `participantId` into locals (`use-weapon-attack.ts:86-87`), while monster's
  installed callbacks close over that render's `attackerParticipantId`
  (`use-monster-attack.ts:86,89`). Both retain their captured values across a
  later render.
- Eligibility timing differs: weapon derives it inside `apply`
  (`use-weapon-attack.ts:83`); monster memoizes it at render
  (`use-monster-attack.ts:59-62`) and gates `canAttack` on it (`:96`).
- `packages/client/src/hooks/vtt-drawer/MODULE.md:70-76` documents both hooks
  as separate owners of `encounterCombat.attemptAttack`; the "Invalidation
  rules" list (`:89-101`) carries a row for `useWeaponAttack` (`:95-96`) but no
  row for `useMonsterAttack`, an existing accuracy gap the doc refresh below
  closes.
- `packages/client/src/test/mock-use-weapon-attack.ts:11-13` — a central
  default-real mock is keyed to the module path and its exported shape, so the
  adapters' public signatures are load-bearing for component tests.

## Proposed direction

Extract the shared lifecycle into an internal coordinator; shrink both hooks to
thin adapters that keep their public contracts byte-compatible.

1. **Add a coordinator hook** in `packages/client/src/hooks/vtt-drawer/`
   (e.g. `use-attack-target-pick.ts`) that owns everything both hooks currently
   duplicate: the `map.get` query gated on `mapId`, the tokens memo, the
   `eligibleTargetParticipants` derivation, the `encounterCombat.attemptAttack`
   mutation with the shared `onSuccess` invalidations
   (`invalidateEncounterDetail` + `invalidateEncounterCombatLogs`) and
   `onTRPCError` wired to a caller-supplied action verb, and the drawer-close →
   `activateTargetPick` → restore-on-pick-and-cancel sequence including the
   `eligible.size === 0` guard. API:
   `{ encounterId, attackerParticipantId, mapId, errorAction, restoreDrawer }`
   in; `{ hasEligibleTargets, isPending, apply(buildPayload) }` out, where
   `buildPayload` receives the narrowed non-null context plus
   `targetParticipantId` and returns the typed `attemptAttack` input — the type
   derived from the shared Zod contract / tRPC router types, with no
   assertions — so payload construction stays in the two adapters.
2. **Shrink `useWeaponAttack` and `useMonsterAttack` to adapters** that keep
   their exported names and argument/result shapes exactly, so components,
   co-located tests, and `test/mock-use-weapon-attack.ts` stay untouched. The
   weapon adapter passes the `mode: "character"` weapon payload and an
   `openCharacter(savedCharacterId, savedParticipantId)` restore; the monster
   adapter passes the `mode: "custom"` structured-action payload and an
   `openMonster(attackerParticipantId)` restore. `isStructuredMonsterAction`
   and its type stay in the monster file. Preserve the distinct error action
   strings (`"resolve attack"` vs `"resolve monster attack"`) via
   `errorAction`. Preserve each adapter's current gate: weapon requires its
   existing non-empty encounter/map checks plus a non-null attacker and eligible
   target; monster retains `mapId !== null` plus an eligible target. When
   `apply` installs the pick session, store the restore callback/value from that
   invocation so both adapters retain their current closure semantics.
3. **Test the coordinator co-located**, per the module's test-seam guidance:
   success invalidation, non-conflict error toast, pending-state reset, and
   cancel-restores-drawer. The existing `use-weapon-attack.test.ts` and
   `use-monster-attack.test.ts` must pass unmodified or with mechanical-only
   updates (`bun run test -- packages/client/src/hooks/vtt-drawer/use-weapon-attack.test.ts`
   etc.).
4. **Refresh `MODULE.md`** in the same change (repo rule: refactors carry the
   module-doc update): note the coordinator as an internal, non-entry-point
   flow helper; keep the External Entry Points list limited to the two
   adapters; keep the per-hook invalidation rows accurate (which means adding
   the missing `useMonsterAttack` row); keep the gotcha that attack resolution
   has no `CONFLICT` recovery.

## Scope / caveats

- **Out of scope:** `useCastPlacement` / `useConfirmCast` (a different pick
  protocol — no mutation fires on pick), any new attack mode (spell attacks),
  any change to `rollMode` behavior (both adapters keep the hardcoded
  `"normal"`), and any server or drawer-store change.
- **Behavior-drift risk during unification.** The weapon hook checks
  `hasEncounter` and derives eligibility lazily inside `apply`, while the
  monster hook memoizes it and has non-nullable ids by signature; a careless
  merge can change `canAttack` gating or restore stale eligibility. The restore
  callback must capture drawer-reopen arguments at apply time, or a prop change
  mid-pick reopens the wrong drawer.
- **Do not over-generalize the coordinator toward `use-cast-placement`'s
  protocol** — it would bloat the API for a consumer that does not fit.
- **No assertion shortcuts in the payload-builder typing.** Deriving the
  `attemptAttack` input union from the shared schemas is the point; a cast
  would trip the `type-assertion-boundary` lint policy (see
  `docs/guides/local-eslint-rules.md`).
- The prior 2026-07-25 pack touched these hooks through
  CLIENT-CLUSTER-PLAN.md slice X1 for type/verb naming and MODULE entry-point
  documentation. Leaf 15's drawer-state modeling was explicitly dropped
  permanently. Neither prior item covers this duplicated lifecycle, so there is
  no ordering constraint.
- **Coordination with [191-let-players-choose-strength-dexterity.md](./191-let-players-choose-strength-dexterity.md):**
  serialize edits to `use-weapon-attack.ts` and its test. If 191 lands first,
  preserve its optional `abilityOverride` apply argument and mutation
  forwarding when shrinking the hook to an adapter; if this leaf lands first,
  191 must add the override to the thin weapon adapter and capture it in the
  coordinator payload builder. The byte-compatible contract promise applies to
  the public interface present when this refactor lands.
