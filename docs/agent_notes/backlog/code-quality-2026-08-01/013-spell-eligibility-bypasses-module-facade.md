# 13. The character-spell router imports spell eligibility from a spell-casting internal file that the module's own doc says must be reached through the facade

Status: Not started
Theme: module facade discipline · Area: server · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The spell-casting module documents a deep-module boundary: its MODULE.md names
exactly three external entry points and then says outright that "External
callers should import through the module facade, not internal files." The
facade honors that contract — `spell-casting.ts` exports exactly the three
documented functions and nothing else. But the character-spell router reaches
past it: it imports `resolveCombatEligibility` directly from
`services/spell-casting/combat-eligibility.ts`, an internal implementation
file, and calls it at two production sites.

So the documented dependency graph and the real one disagree. A contributor who
trusts the MODULE.md contract — which is exactly what module docs in this repo
exist for — will conclude the module's internal files are free to be renamed,
merged, or split behind the facade, and then discover the hidden router edge
only when the build breaks. The violation is invisible from inside the module:
nothing in `services/spell-casting/` mentions that a router depends on one of
its internals. The function itself is not orchestration at all — it is a pure
projection in a 55-line file (no database access, no locks) that maps a spell row onto
the shared-schema `combatEligibility` shape, which is why the router wanted it
next to `mapSpell` in the first place. It is a shared read utility living in a
module whose stated purpose is transactional orchestration, and both sides pay
for the mismatch.

## Evidence

- `packages/server/src/services/spell-casting/MODULE.md:29-35` — "External
  Entry Points" lists exactly `runCastCombatSpellCore`, `castNonCombatSpell`,
  and `dropConcentration`; line 35: "External callers should import through the
  module facade, not internal files."
- `packages/server/src/services/spell-casting/spell-casting.ts:66,128,136` —
  the facade's only three exports are those three functions; it does not
  re-export `resolveCombatEligibility`.
- `packages/server/src/routers/character-spell.ts:16` — `import {
  resolveCombatEligibility } from
  "../services/spell-casting/combat-eligibility.js";` — a direct internal-file
  import from outside the module.
- `packages/server/src/routers/character-spell.ts:94-98` and `:213-217` — the
  two production call sites, both response-payload projections sitting next to
  `mapSpell` calls (imported from `utils/spell-mapping.ts` at `:23`).
- `packages/server/src/services/spell-casting/combat-eligibility.ts:18-55` —
  the function is pure: no Prisma, no locks; it returns
  `CharacterSpellWithDetails["combatEligibility"]`, a shared-Zod-derived type.
  Its only imports (`:1-4`) are `@musi/shared` modules and
  `../../utils/caster-resolver.js`.
- Importer count, measured at the pin: exactly three files import
  `combat-eligibility.js` — the co-located test, the router, and
  `services/spell-casting/resolve-character-spell.ts:32` (used at `:151`). The
  router is the sole cross-module importer.
- The repo already models this exact seam one directory over:
  `utils/spell-mapping.ts`'s `mapSpell` is consumed by both
  `routers/character-spell.ts:23` and
  `services/spell-casting/resolve-character-spell.ts`, and MODULE.md's Gotchas
  already maintains a "Shared dependencies" list of sanctioned `utils/*`
  modules (`MODULE.md:103-108`).

## Proposed direction

Move the pure projection out of the module rather than widening the facade:

1. Move `packages/server/src/services/spell-casting/combat-eligibility.ts` to a
   named server utility — `packages/server/src/utils/spell-eligibility.ts`,
   alongside `utils/spell-mapping.ts` and `utils/caster-resolver.ts` (which it
   already depends on). Move the co-located `combat-eligibility.test.ts` with
   it.
2. Import it from the new location in both `routers/character-spell.ts` and
   `services/spell-casting/resolve-character-spell.ts`.
3. In the same change, update `services/spell-casting/MODULE.md`: add the new
   util to the existing "Shared dependencies" list in Gotchas
   (`MODULE.md:103-108`). The three facade entry points stay untouched.

Do **not** take the alternative of exposing eligibility as a fourth facade
entry point. The facade's documented purpose is transactional orchestration —
it owns transaction boundaries, spell slots, and concentration — and a pure
read projection does not belong on it. The utils extraction follows the
`mapSpell` precedent exactly, keeps the facade contract and the doc delta
minimal, and MODULE.md already treats `utils/*` as the sanctioned
shared-dependency layer. No cycle risk: the moved file imports only
`@musi/shared` and `utils/caster-resolver.ts`, which itself imports only
shared.

Total footprint: one file move, two import updates, one test move, one doc
line — a one-commit fix.

## Scope / caveats

- **No behavior change.** The eligibility logic (`castOnly` reasons, the
  single-matching-class rule, the `spellcastingAbility` gate) moves verbatim.
  Tightening or refactoring its internals is out of scope.
- **The MODULE.md line is part of the fix, not a follow-up.** The change
  contradicts the module doc by construction (a file leaves the module), so the
  shared-dependencies update must land in the same commit as the move.
- Prior 2026-07-25 pack: the landed server-comments work (CQ25-118, S7 row in
  `docs/agent_notes/backlog/code-quality-2026-07-25/SERVER-COMMENTS-PLAN.md:651`)
  and `05-router-and-service-boundaries.md:141` both mention
  `combat-eligibility.ts` approvingly as "already extracted" — descriptive
  context about the router's mapping helpers, not a ruling on the import path;
  neither slice changed the router import, and nothing there blocks this move.
- Prior pack leaf
  `docs/agent_notes/backlog/code-quality-2026-07-25/07-spell-casting-and-level-up-shape.md`
  remains Proposed, but its live `07-PLAN.md` is `Status: Planned` and slice
  07.2 schedules the redundant-check cleanup at `combat-eligibility.ts:32-39`.
  This move relocates those lines without changing their behavior. If this
  leaf lands first, retarget slice 07.2 to `utils/spell-eligibility.ts`; if
  07.2 lands first, move its revised logic verbatim. Do not work the two
  concurrently.
- MODULE.md's Test Seams section (`MODULE.md:79-82`) already sanctions
  co-located focused tests for pure resolution helpers; the moved test keeps
  that shape in `utils/`, matching `utils/spell-mapping.test.ts`.
- No sequencing edges: no other leaf in this pack edits
  `routers/character-spell.ts`, `combat-eligibility.ts`, or the spell-casting
  MODULE.md. [005-spell-participant-loading-discards-prisma.md](./005-spell-participant-loading-discards-prisma.md)
  touches a different file (`load-participants.ts`) in the same module —
  disjoint, no ordering constraint.
