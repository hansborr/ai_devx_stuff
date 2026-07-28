# 07. Spell-casting and level-up widen their own types, then pay to re-narrow them downstream

Status: Proposed — not promoted
Theme: Type-shape and duplication in the cast/level-up services · Area: server · Severity: medium · Size: XL

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

`services/spell-casting/` and `services/level-up/` both lose information at their
internal seams. A value arrives already validated or already discriminated, the
next type down the call chain is wider than the value, and every consumer after
that pays for the loss — with a re-validation, a `type-assertion-boundary` cast,
an unreachable defensive branch, or a hand-copied helper.

The same mechanism shows up six times:

- `NonCombatSpellOpts` carries `castAtLevel`, `ritual` and `metamagicIds` as
  independent fields, so `{ ritual: true, castAtLevel: 5, metamagicIds: [...] }`
  type-checks and silently drops the level and the metamagic — `castRitual`
  ignores both. Which of the three cast paths runs is decided by branch order,
  not by the type.
- `CharacterSpellContext` is built right after `spell.combat` has been narrowed
  and proven non-null, but stores only `spell` — so four downstream functions
  re-derive `spell.combat` and re-guard `!combat`, guards that can never fire.
- `getTargetParticipantIds` accepts a structural bag with `mode: string` even
  though its single caller passes a discriminated `CastCombatSpellInput`; any
  string compiles and falls into the single-target branch.
- Level-up copies a `Map<keyof AbilityScores, number>` into a
  `Record<string, number>` and then buys the narrowing back with two marked
  casts inside the locked-stats mutator.
- `LevelUpContext` types `hpMethod` as `string` although
  `hpMethodSchema`/`HpMethod` already exist in shared and already validate that
  field.
- `LevelUpContext` stores `previousClassLevel` but not `newClassLevel`, so
  `previousClassLevel + 1` is recomputed at four independent sites.

Layered on top is straight duplication with no owner: five behaviourally
identical private code-point comparators — four named
`codePointCompare(left, right)`, one named `compareCodePoint(a, b)` in the seed
parser — an inline re-declaration of `ABILITY_FULL_NAMES` rebuilt on every call,
and `castCantrip`/`castRitual` sharing three verbatim statements. Plus a handful
of dead branches and one stale doc block.

The cost is concrete: a maintainer changing the cast flow has to read four
functions to learn that one of them already proved the invariant, and a
maintainer changing ability-score ordering has to find five copies of the
comparator that a documented module contract depends on.

## Evidence

Spell-casting — widened / branch-ordered types:

- `packages/server/src/services/spell-casting/types.ts:27` — `NonCombatSpellOpts` with independent `castAtLevel`, `ritual`, `metamagicIds`.
- `packages/server/src/services/spell-casting/non-combat-cast.ts:173-188` — `castNonCombatSpellImpl` resolves the three paths by precedence: `spell.level === CANTRIP_LEVEL` (`:176`, from DB data), then `opts.ritual` (`:180`), then `castLeveled`. The comment at `:184-186` documents the precedence rule.
- `packages/server/src/services/spell-casting/non-combat-cast.ts:84-108` — `castRitual` ignores `castAtLevel` and `metamagicIds` entirely.
- `packages/shared/src/schemas/spell-casting-inputs.ts:11-21` — the wire contract is flat (`castAtLevel` + `ritual` + `metamagicIds`); consumed at `packages/server/src/routers/cast-spell.ts:126-133`.
- `packages/server/src/services/spell-casting/resolve-character-spell.ts:178-179` — `const combat = spell.combat; if (!combat) throw … "Spell is cast-only"`, then the returned literal at `:186-192` keeps only `spell`, matching `interface CharacterSpellContext` at `:118-124`.
- Downstream re-derivations of the same fact: `resolve-character-spell.ts:101-102` (same `"Spell is cast-only"` message), `:209-210` (`!combat || combat.resolution.kind !== "attack"`), `:236-237` (same shape for `"save"`), `:282` (`context.spell.combat?.resolution.kind === "attack"`).
- `packages/server/src/services/spell-casting/load-participants.ts:32-39` — `getTargetParticipantIds(input: { mode: string; targetParticipantId?: string; targetParticipantIds?: string[] })`, branching on `input.mode !== "characterSpell"`. Sole caller: `packages/server/src/services/spell-casting/spell-casting.ts:84`, passing the `CastCombatSpellInput` from `CombatSpellOpts` (`types.ts:18`).

Spell-casting — duplication and dead shape:

- `codePointCompare`, five behaviourally identical 3-line bodies: `combat-transaction.ts:12-16`, `load-participants.ts:26-30`, `resolve-character-spell.ts:36-40`, `spell-casting.ts:47-51`, and `packages/server/src/seed/spell-parser/extract-spell-combat.ts:66-70` (named `compareCodePoint`, params `a`/`b`). No *server-side* shared helper exists. `scripts/lib/codepoint-compare.ts:10` re-exports `compareByCodepoint` from `tools/lint-ratchet/src/kernel/codepoint-compare.ts:34`, but that is a scripts/tooling seam and it iterates `codePointAt`, so it orders supplementary-plane strings differently from these `<`/`>` bodies. Do not import it into `packages/server` and do not reuse its name.
- `packages/server/src/services/spell-casting/MODULE.md:63-64` — "`CombatSpellCastResult.affectedCharacterIds` is deduped and code-point ordered", i.e. the comparator is a documented contract.
- `packages/server/src/services/spell-casting/resolve-character-spell.ts:72-81` — `characterSaveModifier` builds a fresh `Record<AbilityAbbreviation, string>` of full ability names per invocation; the identical `ABILITY_FULL_NAMES` is exported at `packages/shared/src/rules/character-rules.ts:61-68` (pinned by `character-rules.test.ts:108-118`), and `resolve-character-spell.ts:3-8` already imports from that exact module.
- `packages/server/src/services/spell-casting/non-combat-cast.ts:64-82` and `:84-108` — `castCantrip` and `castRitual` share three verbatim statements (13 lines, `:69-81` / `:95-107`) after the ritual-eligibility throw at `:89-94`: the `!spell.concentration` early return, the `replaceConcentration` transaction, and the same six-field result literal.
- `packages/server/src/services/spell-casting/combat-transaction.ts:151-197` — `let result: CombatSpellTxResult = {…}` at `:154`, assigned as the last statement of the `$transaction` callback at `:195`, returned at `:197`. The sibling idiom that returns the transaction value directly is at `non-combat-cast.ts:158-166`.
- `packages/server/src/services/spell-casting/combat-transaction.ts:105` and `:132` — `const damage = damageByTarget(opts)` computed independently in `applyCharacterPass` and `applyParticipantPass` from the same `opts`.
- `packages/server/src/services/spell-casting/types.ts:9` imports `CasterRaw`/`TargetRaw` from `./resolve-spell.js` (used at `types.ts:39`, `:45`) while `resolve-spell.ts:20` imports `LoadedSpellParticipants`/`LoadedSpellTarget` from `./types.js` — a type-only cycle. `SpellStatsBlock`/`CasterRaw`/`TargetRaw` are declared at `resolve-spell.ts:22`, `:31`, `:51`; `load-participants.ts:6` also reaches into `resolve-spell.js` for `CasterRaw`, and `resolve-character-spell.ts:31` for `CasterRaw`/`TargetRaw` (used at `:72`, `:89`, `:142`). `CasterRaw` depends on the `Spell as SpellRow` prisma import at `resolve-spell.ts:14` (consumed at `:45`).
- `packages/server/src/services/spell-casting/resolve-spell.ts:141` — `export { getTargetSaveModifier, mapToSpellAttackResult } from "./resolve-character-spell.js"`, redundant with the direct imports at `:15-19` (both are used internally at `:92` and `:104`).
- `packages/server/src/services/spell-casting/spell-casting.ts:43-46` — the doc block "Deduped + stable-ordered character IDs touched by this cast. / Caster first, target only if it's a different character." sits directly above `function codePointCompare` at `:47`; the function it describes, `collectAffectedCharacterIds`, is at `:53`. The "Caster first" sentence is stale: `:55` sorts the whole deduped set.
- `packages/server/src/services/spell-casting/spell-casting.ts:126-135` — five-line public-API JSDoc above `export async function castNonCombatSpell(opts) { return castNonCombatSpellImpl(opts); }`.
- `packages/server/src/services/spell-casting/combat-eligibility.ts:32-39` — `if (matchingClasses.length !== 1) return { kind: "castOnly", reason: "ambiguous-class-source" }` immediately followed by `const matchingClass = matchingClasses[0]; if (!matchingClass) return` the same value.

Level-up:

- `packages/server/src/services/level-up/asi.ts:29` builds `new Map<keyof AbilityScores, number>()`; `:36` declares `const abilityDeltas: Record<string, number> = {}`; `:45` copies into it. `packages/server/src/services/level-up/types.ts:19` stores it as `abilityDeltas: Record<string, number>`.
- `packages/server/src/services/level-up/asi.ts:83-84` — `interop` marker + `freshStats[key as keyof CharacterStats] as number`; `:92-93` — `prisma` marker + `(data as Record<string, unknown>)[key] = next`. Both marker comments spell out the invariant the widened type discarded.
- `packages/server/src/services/level-up/core.ts:229-250` — `buildClassOperation` calls `tx.characterClass.create(...)` at `:234` or `advanceClassLevel(tx, …)` at `:244` and returns `Promise<CharacterClass>`; it executes, it does not build.
- `previousClassLevel + 1` derived independently at `core.ts:134`, `core.ts:248`, `level-up.ts:73`, `apply-level-up.ts:63`, while `types.ts:90` already carries `previousClassLevel` (`LevelUpContext` at `types.ts:86-102`).
- `packages/server/src/services/level-up/types.ts:94` — `hpMethod: string`; `packages/shared/src/schemas/character-inputs.ts:272-274` exports `hpMethodSchema` and `type HpMethod`, and `:279` already validates the field.
- `packages/server/src/services/level-up/core.ts:120` — `Omit<LevelUpContext, "featureIds" | "postLevelUpClasses" | "metamagicIds" | "subclassInfo">` as a return type.
- Six banner sections in one file: `core.ts:24-26` "Basic prerequisites", `:99-101` "HP roll validation", `:112-114` "Context assembly", `:152-154` "DB reads — run inside the level-up transaction", `:191-194` "Post-level-up class roster", `:225-227` "DB writes — run inside the level-up transaction". Siblings `subclass.ts`, `sorcerer.ts`, `asi.ts` are single-concern.
- Test misplacement: `core.test.ts:3` imports only `buildPostLevelUpClasses` and has a single `describe` at `:25`, while `asi.test.ts:7` imports `validateBasicPrereqs, validateHpRoll, validateMulticlassPrereqs` from `./core.js` and hosts their describes at `:179`, `:214`, `:319`.

Seed parsers (micro dead/redundant code):

- `packages/server/src/seed/rules-glossary-parser/parse-glossary-entry.ts:41-46` — both branches of `if (candidateTag) { … } else { … }` perform the identical `name = name.slice(0, tagStart).trim()`; only the `if` arm additionally sets `tag = candidateTag` (`:42`), which `:54` reads to pick the category.
- `packages/server/src/seed/generate-subclasses.ts:129` — `features: features.map((f) => ({ ...f, id: f.id }))`, an exact no-op.
- `packages/server/src/seed/spell-parser/parse-spell-block.ts:176` — inside `splitDescription` (`:174`), `const durationIdx = lines.findIndex((l) => /\*\*Duration:\*\*/.test(l))` hardcodes the `**Field:**` marker shape that `FIELD_MARKER_RE` (`:38`) / `extractField` (`:61`) already own. `durationIdx` is a line index consumed at `:179` (`lines.slice(durationIdx + 1)`) to locate where the description body starts; Duration's *value* is separately extracted through `extractFieldFromLines` at `:97`. Only the `**Field:**` marker literal is duplicated knowledge.
- `packages/server/src/seed/spell-parser/extract-spell-metadata.ts:8-15` — hardcoded inverse `ABILITY_MAP` (`strength -> STR`, …).

## Proposed direction

Each numbered step is one commit. Steps 1-4 are mechanical and unlock reviewing
the rest cheaply.

1. **Hoist the code-point comparator.** Add one exported `codePointCompare` to a
   server-side util (e.g. `packages/server/src/utils/`), import it in
   `combat-transaction.ts`, `load-participants.ts`, `resolve-character-spell.ts`,
   `spell-casting.ts`, and `seed/spell-parser/extract-spell-combat.ts` (dropping
   the `compareCodePoint` alias). Behaviour must be byte-identical; keep a test
   that pins the ordering contract named in `spell-casting/MODULE.md:63-64`.

2. **Import `ABILITY_FULL_NAMES` instead of re-declaring it.** In
   `resolve-character-spell.ts:72-81`, delete the inline `names` object and add
   `ABILITY_FULL_NAMES` to the existing `@musi/shared/rules/character-rules.js`
   import at `:3-8`. Optionally, in the same commit, derive
   `seed/spell-parser/extract-spell-metadata.ts:8-15`'s inverse map from the
   shared constant rather than hardcoding it.

3. **Dedup the no-slot concentration path.** Extract the shared three statements
   of `castCantrip`/`castRitual` (`non-combat-cast.ts:64-108`) into one
   `castWithoutSlot(prisma, characterId, spell)`; `castRitual` keeps only its
   eligibility throw before delegating.

4. **Return the transaction value in `executeCombatSpellTransaction`.** Replace
   the outer `let result` (`combat-transaction.ts:151-197`) with
   `return opts.prisma.$transaction(async (tx) => { …; return { concentrationDescriptions, slotUsed, slotLevel }; })`,
   matching the sibling idiom at `non-combat-cast.ts:158-166`. In the same
   commit, hoist the duplicate `damageByTarget(opts)` (`:105`, `:132`) to a
   single computation passed into both passes.

5. **Resolve an internal `CastMode` after the DB read.** In `non-combat-cast.ts`,
   after `loadCharacterSpell`, compute
   `type CastMode = { kind: "cantrip" } | { kind: "ritual" } | { kind: "slot"; level: number; metamagicIds?: string[] }`
   and `switch` on it exhaustively. The cantrip arm is chosen from `spell.level`,
   the ritual arm from `opts.ritual`, the slot arm otherwise — the same
   precedence, expressed structurally instead of ordinally. The wire input stays
   flat (see caveats).

6. **Let `CharacterSpellContext` carry the narrowed `combat`.** Add
   `combat: <the narrowed type>` to the interface at
   `resolve-character-spell.ts:118-124` and to the literal at `:186-192`, then
   drop the now-unreachable `!combat ||` halves at `:209-210` and `:236-237`,
   and the optional chain at `:282`. To retire the duplicate
   `"Spell is cast-only"` guard at `:101-102`, change `resolveDamageDice`
   (`:100`) to take the already-narrowed `combat` instead of `spell: Spell` —
   its only call site is `:189`, downstream of the `:178-179` narrowing — since
   that guard belongs to the helper's signature, not to the context type.

7. **Give `getTargetParticipantIds` the real input type.** Change
   `load-participants.ts:32-35` to take `CastCombatSpellInput` (already imported
   in this module family via `types.ts`) so the `mode` discrimination is checked
   by the compiler. Single caller: `spell-casting.ts:84`. The body must narrow
   on `input.mode` before reading `targetParticipantIds` — only the
   `characterSpell` arm carries that field — which also drops the `?? ""`
   fallback at `:38`. That makes the `Too many spell targets` throw at `:40-42`
   unreachable: `castCombatSpellInputSchema` already applies
   `.max(MAX_COMBAT_SPELL_TARGETS)` (`packages/shared/src/schemas/spell-action-inputs.ts:63`)
   and is the router's `.input()` (`packages/server/src/routers/encounter-combat.ts:53`).
   Decide explicitly in the commit message: keep it as defense-in-depth for
   non-schema callers, or delete it.

8. **Break the type-only cycle.** Move `SpellStatsBlock`, `CasterRaw` and
   `TargetRaw` from `resolve-spell.ts:22/:31/:51` into
   `spell-casting/types.ts`, moving the `Spell as SpellRow` prisma import
   (`resolve-spell.ts:14`) with them since `CasterRaw` consumes it at `:45`.
   Delete the `import type … from "./resolve-spell.js"` at `types.ts:9`, and
   repoint `load-participants.ts:6`, `resolve-character-spell.ts:31` and
   `resolve-spell.test.ts:5`. In the same commit delete the pass-through
   re-export at `resolve-spell.ts:141` — with the types moved, no importer needs
   a split import.

9. **Fix the doc-block placement and the wrapper naming in `spell-casting.ts`.**
   Move the block at `:43-46` down to `collectAffectedCharacterIds` at `:53` and
   drop its stale "Caster first" sentence (`:55` sorts the whole set; see
   `MODULE.md:63-64`). Separately, rename `castNonCombatSpellImpl` to
   `castNonCombatSpell` in `non-combat-cast.ts` and move the public-API JSDoc at
   `spell-casting.ts:126-132` onto the implementation. `spell-casting.ts` is the
   module facade (`MODULE.md:29-35`) and the directory has no `index.ts`, so
   replace the wrapper body at `spell-casting.ts:133-135` with a pass-through
   re-export — `export { castNonCombatSpell } from "./non-combat-cast.js";` —
   and delete the now-dead `import { castNonCombatSpellImpl } from "./non-combat-cast.js";`
   at `spell-casting.ts:11`. That keeps `routers/cast-spell.ts:9` and
   `spell-casting-non-combat.test.ts:9` resolving unchanged. Do not repoint
   those two importers at `./non-combat-cast.js`: `MODULE.md:35` requires
   external callers to import through the facade and `MODULE.md:79-80` requires
   boundary tests to exercise facade entry points.

10. **Narrow `abilityDeltas` and delete both level-up casts.** Type it as
    `Partial<Record<keyof AbilityScores, number>>` in `level-up/types.ts:19` and
    build it that way in `asi.ts:36-45`. In `applyAsiDeltasFromFresh`
    (`asi.ts:77-95`), iterate a `const` ability-key list rather than
    `Object.entries` (which still yields `string`), which removes the `interop`
    cast at `:84` and lets the Prisma write be keyed by a known field union
    instead of `(data as Record<string, unknown>)` at `:93`. Refresh the JSDoc
    at `level-up/types.ts:11-18` in the same commit — its "keys are snake-case
    stat keys" sentence is what the new type states, so trim it to the
    delta-vs-absolute invariant it uniquely carries.

11. **Tighten `LevelUpContext`.** Add `newClassLevel: number` (computed once in
    `validateAndBuildContext`) and consume it at `core.ts:248`, `level-up.ts:73`
    and `apply-level-up.ts:63`; change `hpMethod: string` (`types.ts:94`) to the
    shared `HpMethod`; rename `buildClassOperation` (`core.ts:229`) to something
    that says it writes — e.g. `applyClassLevel` — since it sits under the "DB
    writes" banner.

12. **Split `level-up/core.ts` along its own banners.** Six sections in one file
    is the finding; the natural cut is prerequisite/HP validation, context
    assembly, transaction reads, and transaction writes. Move
    `validateBasicPrereqs`, `validateHpRoll` and `validateMulticlassPrereqs`
    tests out of `asi.test.ts:179/:214/:319` into the test file that sits beside
    whichever module ends up owning them, leaving `asi.test.ts` with its own two
    describes.

13. **Seed-parser micro cleanups (separable, see caveats).** Hoist the shared
    `name = name.slice(0, tagStart).trim()` out of the `if`/`else` at
    `parse-glossary-entry.ts:41-46` and keep the tag assignment as
    `if (candidateTag) tag = candidateTag;` — the branches share only the `name`
    assignment, and dropping `tag` would send every tagged entry to the
    `general` category (`:54`). Delete the no-op map
    at `generate-subclasses.ts:129`; merge the duplicated eligibility guard at
    `combat-eligibility.ts:32-39` into a single check; and, in
    `parse-spell-block.ts`, keep `splitDescription`'s *index* semantics while
    removing the hardcoded marker literal — add
    `function findFieldLineIndex(lines: string[], target: SpellFieldName): number`
    next to `extractFieldFromLines` (`:83`), implemented as
    `lines.findIndex((l) => extractField(l, target) !== undefined)`, and call
    `findFieldLineIndex(lines, "Duration")` at `:176`. `lines.slice(idx + 1)` at
    `:179` stays exactly as it is. Optionally reuse the same helper inside
    `extractFieldFromLines` so the marker scan has one owner.

## Scope / caveats

- **Do not turn the cast-mode union into a wire contract.** Keep
  `castSpellInputSchema` flat. A `{kind:"ritual"} | {kind:"slot"; …}` wire shape
  would not remove the impossible states: the cantrip branch is decided by
  `spell.level` loaded from the DB (`non-combat-cast.ts:176`), not by the
  caller, and a server cannot trust a client-declared cast kind — a cantrip
  would still arrive as `{kind:"slot", level:0}` and still be re-routed by the
  same precedence check. The flat shape is also not local to the service: it is
  `castSpellInputSchema` (`packages/shared/src/schemas/spell-casting-inputs.ts:11-21`)
  used by the client and by `packages/server/src/routers/cast-spell.ts:126-133`.
  Step 5 is an *internal* mode resolved after `loadCharacterSpell`; the wire
  contract does not change. If you ever do change it, that is a separate piece
  of work and needs `docs/guides/add-trpc-procedure.md`.
- **Preserve the precedence comment** at `non-combat-cast.ts:184-186` (ritual-only
  unprepared spells can still cast via ritual; the prepared check lives inside
  `castLeveled`). It encodes an SRD rule the branch order alone does not state.
  Rules-touching edits: read `docs/guides/change-rules-logic.md`.
- **The comparator is a contract, not an implementation detail.** Hoisting in
  step 1 must keep code-point ordering exactly; do not "improve" it to
  `localeCompare`. `spell-casting/MODULE.md:63-64` pins the observable ordering
  of `affectedCharacterIds`.
- **Keep the `castNonCombatSpell` doc block.** `spell-casting.ts:126-132`
  carries the five-line public-API JSDoc ("Caller: character ownership auth +
  broadcast. Module: everything else."). Drop the `Impl` suffix and move that
  JSDoc onto the implementation; do not swap the wrapper for a bare
  `export { castNonCombatSpellImpl as castNonCombatSpell }`, which loses it.
- **Step 10 is race-sensitive.** `applyAsiDeltasFromFresh` re-validates the ASI
  cap against `freshStats` *inside the lock* and must keep surfacing concurrent
  DM bumps as `CONFLICT` rather than silently clobbering (`asi.ts:71-75`
  banner comment, and the `CONFLICT` throw at `:88`). Read
  `docs/CONCURRENCY.md` and `docs/guides/add-race-sensitive-mutation.md` before
  touching it, and keep `level-up-concurrency.test.ts` green. If a cast has to
  survive, its `// type-assertion-boundary: <category> - <reason>` marker must
  survive with it — see `docs/guides/local-eslint-rules.md`; removing markers
  moves ratcheted lint counts, so check `docs/guides/lint-ratchet.md`.
- **`combat-eligibility.ts:32-39` is not a plain delete.** The `length !== 1`
  check also rejects `> 1`, which the `matchingClasses[0]` guard does not, and
  the index guard is what satisfies `noUncheckedIndexedAccess`. Collapse to one
  guard that does both (e.g. destructure `const [matchingClass] = …` and test
  `matchingClasses.length !== 1 || !matchingClass`), do not remove either arm.
- **Do not replace `durationIdx` with `extractFieldFromLines` — it would break
  spell parsing.** `extractFieldFromLines` returns a
  *value* (`string | undefined`), while `splitDescription` needs the *line
  index* of the Duration line to compute `lines.slice(durationIdx + 1)`
  (`parse-spell-block.ts:176`, `:179`). Swapping in the value-returning helper
  destroys the description boundary and every parsed spell would lose or
  mis-slice its `desc`/`higher_level`. Only the marker literal may be
  deduplicated, via an index-returning helper (step 13). Pin
  `splitDescription`'s output on a Duration-bearing block before touching it;
  the seed JSON it feeds is regenerated, so a silent boundary shift would land
  in `packages/server/src/seed/` data.
- **This leaf is XL and should be scheduled as three streams, not one branch.**
  Steps 1-9 (spell-casting), steps 10-12 (level-up) and step 13 (seed parsers)
  touch disjoint files and share only the duplication cause; each is
  independently landable. Do not open one branch for all thirteen commits.
  Step 13 touches `packages/server/src/seed/`, not the cast/level-up services,
  and can be split into its own leaf at any time; it sits here because two of
  its cleanups (the comparator copy and the inverse ability map) are the same
  duplication that steps 1-2 fix.
- Follow TDD throughout: every step above is behaviour-preserving, so the
  existing suites (`spell-casting` tests, `level-up*.test.ts`) are the
  regression net — extend them before refactoring where coverage is thin. For
  step 5, `castRitual`'s dropped `castAtLevel` is already pinned
  (`spell-casting-non-combat.test.ts:149-176` casts a level-1 ritual and asserts
  no slot is consumed); the untested hole is `ritual: true` together with
  `metamagicIds`, which `castRitual` silently discards.
- If module boundaries move (steps 8, 12), refresh the affected `MODULE.md`
  per `docs/guides/add-module-doc.md`.
- No sequencing dependency on leaves 08 or 09 — different package.
- **Leaf 06 depends on this leaf's step 13**: it deletes the no-op map at
  `generate-subclasses.ts:129` and collapses `parse-glossary-entry.ts:41-46`,
  both of which leaf 06 steps 4-6 rewrite, so land step 13 before leaf 06
  step 6. Step 1's `codePointCompare` hoist and leaf 06 step 4's slug/`cleanDesc`
  hoist must agree on one home for shared `seed/` helpers — decide it once, in
  whichever leaf lands first.
