# 5. Spell participant loading routes the caster query through `unknown` into a hand-mirrored type that weakens always-selected fields to optional

Status: Not started
Theme: Prisma boundary type fidelity · Area: server · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The spell-casting loader runs a Prisma query with a fixed include and then
throws the inferred result type away. `narrowCasterRaw` takes the query row as
`unknown` and asserts it into `CasterRaw`, a hand-maintained mirror of the
selected relation tree. Because the mirror is never checked against the query,
the two contracts can drift independently while everything still compiles: a
field can be dropped from `CASTER_INCLUDE`, or renamed in the schema, and the
resolvers keep typechecking against a shape the database no longer returns.

The mirror is also wrong today, in a subtle way: it declares `source`,
`prepared`, and `spellSlots` as optional, even though the schema makes the
first two non-nullable columns and the fixed include always selects the slots
relation. Those manufactured optional states force the resolution code to carry
fallback branches — a `?? "class"` default for a spell's source, an
`undefined`-tolerant prepared check, an optional chain over spell slots — for
conditions the query never produces. A contributor reading those branches has
to reverse-engineer that the "absent" cases are artifacts of the mirror, not
real persisted-data states; a contributor changing the query shape gets no
compiler help at all.

## Evidence

- `packages/server/src/services/spell-casting/load-participants.ts:10-20` —
  `CASTER_INCLUDE` always selects `character` with `stats`, `proficiencies`,
  `classes` (with `class`/`subclass`), `spells` (with `spell`), and
  `spellSlots`. The include is a fixed `as const` object; nothing is
  conditional.
- `packages/server/src/services/spell-casting/load-participants.ts:41-43` —
  `function narrowCasterRaw(value: unknown): CasterRaw { return value as
  CasterRaw; }` with a `type-assertion-boundary: prisma` marker; the sole call
  at `:92` feeds `LoadedSpellParticipants.casterRaw`. TypeScript never compares
  the inferred query result to `CasterRaw`.
- `packages/server/src/services/spell-casting/resolve-spell.ts:31-49` — the
  hand-written `CasterRaw` mirror: `source?: string` (`:43`), `prepared?:
  boolean` (`:44`), and `spellSlots?:` (`:47`) are all optional.
- `packages/server/prisma/schema.prisma:1003-1008` — `CharacterSpell.prepared
  Boolean @default(false)` and `source SpellSource` are both non-nullable, so
  the query result always carries concrete values; `CharacterSpellSlot`
  (`:990-1001`) is the always-included slots relation, returned as an array,
  never `undefined`.
- Dead fallbacks the optionals force, all in
  `packages/server/src/services/spell-casting/resolve-character-spell.ts`:
  `spellSourceSchema.parse(known.source ?? "class")` at `:152`;
  `assertPreparedAndCastLevel(spell, prepared: boolean | undefined, …)` at
  `:112-119` (undefined treated as unprepared), fed `known.prepared` at `:162`;
  `caster.spellSlots?.find(…)` at `:130` inside `assertSlot` (`:128-134`,
  reached via the call at `:163`) — an absent array reads as "No remaining
  spell slot", a state the fixed include never produces.
- The repo already has the checked idioms this file skips:
  `Prisma.…GetPayload` derivations at
  `packages/server/src/utils/character-mapping.ts:25`,
  `packages/server/src/utils/chat-helpers.ts:9`, and
  `packages/server/src/routers/campaign.ts:59`; `satisfies
  Prisma.…Include`/`…Select` anchors on include constants at
  `packages/server/src/routers/srd.ts:68-105`,
  `packages/server/src/routers/monster.ts:176`, and
  `packages/server/src/routers/magic-item.ts:37`.
- The mirror does serve a real purpose: the module's pure-resolver test seam.
  `packages/server/src/services/spell-casting/resolve-character-spell.test.ts:140`
  builds the minimal fixture `{ character: null }`, and
  `packages/server/src/services/spell-casting/MODULE.md` ("Test Seams")
  sanctions co-located focused tests on pure resolution helpers. The full
  structured fixture at `resolve-character-spell.test.ts:248-270` already
  supplies `source`, `prepared`, and `spellSlots` explicitly, so tightening the
  contract costs those tests nothing.

## Proposed direction

Keep `CasterRaw` as the resolver's narrow structural contract — it earns its
keep as the pure-helper test seam — but make it honest and make TypeScript
check it:

1. **Tighten `CasterRaw` to what `CASTER_INCLUDE` actually guarantees.** In
   `resolve-spell.ts:31-49`, make `source`, `prepared`, and `spellSlots`
   required — the fixed include always selects them and the schema makes the
   columns non-nullable. Then delete the fallbacks those optionals forced in
   `resolve-character-spell.ts`: the `known.source ?? "class"` default at
   `:152`, the `boolean | undefined` parameter of `assertPreparedAndCastLevel`
   at `:114` (the `prepared !== true` guard for `false` stays — that is real
   behavior), and the `spellSlots?.find` optional chain at `:130`.
2. **Replace the `unknown` cast with a plain annotated assignment.** In
   `load-participants.ts`, drop `narrowCasterRaw` and write
   `const casterRaw: CasterRaw = casterRow` (after the null check at `:61`), so
   TypeScript structurally checks Prisma-inference-to-contract assignability
   and any query/consumer drift fails compilation. The
   `type-assertion-boundary: prisma` marker at `:42` goes with it.
3. **Optionally anchor the include:** `CASTER_INCLUDE satisfies
   Prisma.EncounterParticipantInclude`, matching the existing anchors in
   `routers/srd.ts`, `routers/monster.ts`, and `routers/magic-item.ts`, so a
   typo in the include object fails at the declaration instead of at the
   assignment.

Do **not** replace `CasterRaw` wholesale with
`Prisma.EncounterParticipantGetPayload<…>`: that couples the pure resolvers to
the full generated model shapes and would force full-payload test fixtures or
new test-category casts, against the module's MODULE.md test-seam guidance.

If the plain assignment in step 2 does not compile, that is a real
query/contract mismatch — fix it in the contract, never by reintroducing a
cast.

TDD: adjust the co-located suites alongside each step —
`bun run test -- packages/server/src/services/spell-casting/resolve-character-spell.test.ts packages/server/src/services/spell-casting/resolve-spell.test.ts packages/server/src/services/spell-casting/load-participants.test.ts`.

## Scope / caveats

- **`TargetRaw` (`resolve-spell.ts:51-58`) and `SPELL_TARGET_INCLUDE` are out
  of scope.** The sibling mirror has different mechanics (no `unknown` cast on
  its path here) and belongs to the broader mapper sweep in
  [006-server-mappers-maintain-parallel-handwritten.md](./006-server-mappers-maintain-parallel-handwritten.md);
  keep the two leaves off concurrent edits to `resolve-spell.ts`.
- **Do not relocate `CasterRaw`/`TargetRaw` into `types.ts`.** The 2026-07-25
  pack already ruled on exactly that move: 07-PLAN's dropped Step 8
  (`docs/agent_notes/backlog/code-quality-2026-07-25/07-PLAN.md:110-113`) —
  relocation "relocates ownership debt rather than retiring it". That ruling
  rejected the relocation fix, not the tighten-in-place fix this leaf does.
  Also `resolve-spell.test.ts` imports `type TargetRaw` together with runtime
  symbols from `./resolve-spell.js` (07-PLAN.md:137-139), so the type exports
  stay where they are.
- **Sequence against the prior pack's open plan slice.** 07-PLAN slice 07.2
  (still open) edits `resolve-character-spell.ts` and
  `load-participants.ts` — the `ABILITY_FULL_NAMES` import, the narrowed
  `combat` context, and `getTargetParticipantIds` typing. No semantic
  dependency in either direction, but the file overlap is total: do not work
  the two concurrently, and whichever lands second rebases its line references.
- **Behavior is unchanged by design.** Every deleted fallback covers a state
  the fixed include cannot produce; the observable guards (`prepared !== true`,
  empty-or-exhausted slot → "No remaining spell slot") keep their semantics for
  the states that do occur. If removing a fallback changes a test's observable
  result, stop — that is evidence the state was reachable, and the contract
  (not the fallback) is what needs correcting.
- The minimal `{ character: null }` fixtures are unaffected (the tightened
  fields live inside the nullable `character` branch); only fixtures that build
  a non-null `character` must supply the three fields, and the existing
  structured fixture already does.
