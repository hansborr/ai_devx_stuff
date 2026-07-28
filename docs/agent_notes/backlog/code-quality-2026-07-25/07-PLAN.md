# 07-PLAN. Spell-casting and level-up: scheduling plan

Status: Planned — supersedes the Proposed direction in
[`07-spell-casting-and-level-up-shape.md`](./07-spell-casting-and-level-up-shape.md)

Date: 2026-07-26 · Area: server · Source leaf: 07 (XL)

Cross-model planning session: `consult codex` (four internal angles — domain
modelling, blast radius, test/gate risk, framing — synthesized) and
`consult cursor` (Grok, "is this the right approach at all"). Both were asked
independently. Where they disagreed, the call and the reason are in
[Rejected alternatives](#rejected-alternatives--why). Every claim below was
re-resolved by symbol name against `c69ce720`.

## Reconciled scope decision

**The leaf's diagnosis is right, its step list is roughly half padding, and one
of its two headline steps is modelling the wrong thing.**

The "widen then re-narrow" mechanism is real at exactly three seams — the
discarded `spell.combat` narrowing, the structural `{ mode: string }` bag, and
the `Map` → `Record<string, number>` copy in ASI. Everywhere else the leaf is
counting style twins (step 4), a type-only cycle with no runtime cost (step 8),
a facade that already works (step 9), a banner-section file split (step 12), and
seed-parser cleanups that belong to leaf 06 (step 13).

Both consults independently reached "shrink". Both independently rejected steps
4, 8, 12 and most of 13. They split on step 5, and that split decides the plan —
see below.

**Verified live at `c69ce720`: `git diff 883d48bf..c69ce720` is empty for
`packages/server/src/services/spell-casting/`,
`packages/server/src/services/level-up/` and `packages/server/src/seed/`. The
leaf's Evidence is not stale; every anchor re-resolves.**

### The step-5 call: do not build the internal `CastMode` union

The leaf's step 5 proposes resolving
`{ kind: "cantrip" } | { kind: "ritual" } | { kind: "slot"; level; metamagicIds? }`
after `loadCharacterSpell` and switching on it exhaustively — "the same
precedence, expressed structurally instead of ordinally".

Cursor called this the structural heart of the leaf. Codex called it wrong
modelling. **Codex is right, and the deciding facts are checkable:**

- `castRitual` (`non-combat-cast.ts:castRitual`) discards both `castAtLevel` and
  `metamagicIds`. `castCantrip` discards them too. The union would encode that
  discard as intended design by attaching `metamagicIds` only to the `slot` arm.
- Metamagic is not slot-scoped in this codebase's own domain model — it is an
  orthogonal modifier applied by `applyMetamagicCost`
  (`utils/metamagic-helpers.ts`), and the wire schema offers it on every cast.
- The router announces the cast from the **raw request**, not from what the
  service did: `routers/cast-spell.ts:buildCastChatContent` computes
  `upcast` from `input.castAtLevel > spellBaseLevel` and appends the
  `metamagic:` tag from `input.result.metamagic`. A ritual cast submitted with
  `castAtLevel: 5` is therefore announced "at level 5" while the service ignored
  the level entirely.

So the current three-way precedence is not a type-shape problem waiting for a
union; it is an **undecided rules question wearing a type-shape costume**. Making
it exhaustive would freeze the answer without anyone deciding it. Slice 07.3
below pins the behaviour in characterization tests and files the question
instead. The union is deferred until the rules answer exists.

### Kept

- **Step 1**, the comparator hoist — but scoped to `services/spell-casting/`
  only. The fifth copy (`seed/spell-parser/extract-spell-combat.ts:compareCodePoint`)
  stays for leaf 06, which dissolves the `06 <-> 07` "agree on one home"
  negotiation entirely.
- **Step 2**, the `ABILITY_FULL_NAMES` import — server half only. Its seed half
  (`seed/spell-parser/extract-spell-metadata.ts:ABILITY_MAP`) goes to leaf 06.
- **Step 6**, `CharacterSpellContext` carrying the narrowed `combat`. Both
  consults kept this; it is the leaf's single best item.
- **Step 7**, typing `getTargetParticipantIds`. Kept, and the `MAX_COMBAT_SPELL_TARGETS`
  guard **stays** — ruling below.
- **Step 9's stale doc block only.** The block above
  `spell-casting.ts:codePointCompare` describes `collectAffectedCharacterIds`
  and its "Caster first" sentence is false. Free to fix inside slice 07.1.
- **Step 10**, but with codex's shape, not the leaf's — carry the `Map` rather
  than re-typing the copy.
- **Step 11's two type fixes** (`newClassLevel`, `HpMethod`). Not the rename.
- **Step 12's test relocation only.** The file split is dropped; moving three
  misfiled `describe`s is a real, free navigation fix.

### Dropped

- **Step 3 (`castWithoutSlot`) — dropped.** Thirteen shared lines, and extracting
  them entrenches exactly the cantrip/ritual semantics slice 07.3 puts under
  question. Revisit only after the rules decision.
- **Step 4 (transaction-return style + `damageByTarget` hoist) — dropped.** No
  type information is lost or bought back; it is a style twin of an existing
  sibling idiom, in a concurrency-sensitive transaction. Both consults dropped it.
- **Step 5 (internal `CastMode`) — deferred**, replaced by slice 07.3. See above.
- **Step 8 (break the type-only cycle) — dropped.** Type-only, zero runtime cost,
  and moving Prisma-shaped `CasterRaw`/`TargetRaw` into the generic `types.ts`
  relocates ownership debt rather than retiring it. The leaf's supporting claim
  is also wrong (see Evidence corrections).
- **Step 9's rename and re-export — dropped.** `spell-casting.ts:castNonCombatSpell`
  is a documented facade seam (`spell-casting/MODULE.md`, "External Entry Points"
  and "Test Seams"); churning it buys no type information.
- **Step 12's file split — dropped**, and the leaf's justification for it does not
  survive checking. See Evidence corrections.
- **Step 13 (seed parsers) — removed from leaf 07 entirely**, to leaf 06. Both
  consults said so; codex added that the seed-parser tests do not prove
  full-corpus regeneration equivalence, so a boundary change can silently alter
  committed JSON under `packages/server/src/seed/`. Leaf 06 already owns seed
  provisioning and byte-diff discipline.

### Evidence corrections (claims in the leaf that do not survive checking)

1. **`load-participants.ts:getTargetParticipantIds`'s "Too many spell targets"
   throw is NOT unreachable.** The leaf reasons from
   `castCombatSpellInputSchema.max(MAX_COMBAT_SPELL_TARGETS)` being the router's
   `.input()`. But `spell-casting.ts:runCastCombatSpellCore` is a documented
   external entry point (`spell-casting/MODULE.md`, "External Entry Points"),
   `services/encounter-combat/spell-action.ts:castCombatSpell` calls it directly,
   and `CastCombatSpellInput` carries an ordinary `string[]` — Zod's `.max()` is
   not encoded in the TypeScript type. **Ruling: keep the guard**, and add a
   comment naming the direct-facade caller so the next reader does not re-derive
   this.
2. **Step 8's "no importer needs a split import" is false.**
   `resolve-spell.test.ts` imports `getTargetSaveModifier`, `mapToSpellAttackResult`
   and `type TargetRaw` in one statement from `./resolve-spell.js`. Deleting the
   pass-through re-export forces that import to split. (Moot — step 8 is dropped.)
3. **Step 12's premise is false.** The leaf argues "six banner sections in one
   file … siblings `subclass.ts`, `sorcerer.ts`, `asi.ts` are single-concern".
   They are not: `subclass.ts` carries three banners (pure validation / DB
   validation + resolution / DB write), `sorcerer.ts` two, `asi.ts` three. The
   pure → DB-read → DB-write banner triad is this module family's idiom, not a
   `core.ts` defect. `core.ts` differs only by additionally splitting prereq / HP
   / context assembly.
4. **The TDD note about step 5 overstates its coverage.**
   `spell-casting-non-combat.test.ts` "ritual casts without consuming a slot"
   casts Alarm — a level-1 spell — at `castAtLevel: 1`, i.e. at its base level.
   It proves no slot is consumed; it does **not** prove a higher `castAtLevel` is
   ignored. Both discard paths (level and metamagic) are untested. This is what
   slice 07.3 fixes.
5. **The ratchet warning is imprecise.**
   `lint-ratchet.baseline.json`'s `ratchet/local-type-assertion-boundary` entry is
   `mode: "no-new"` with `"items": {}` — the current count is zero. Removing a
   cast therefore moves nothing; removing a *marker while keeping the cast* is a
   hard lint failure, not a count change. Read `docs/guides/lint-ratchet.md` only
   if a cast has to survive.
6. **"Code-point" is the wrong word.** The four `<`/`>` bodies compare UTF-16
   code units, which differs from true code-point order for supplementary-plane
   strings. Behaviour must be preserved byte-for-byte; the *prose* in
   `spell-casting/MODULE.md` ("deduped and code-point ordered") may be corrected
   in slice 07.1. Every ID reaching this comparator today is ASCII, so no
   observable ordering changes.

## Slices

Five slices in two independent streams. Each is one agent session.

| # | Scope | Done criteria | Verification |
|---|---|---|---|
| **07.1** | Add `packages/server/src/utils/string-order.ts` exporting one comparator (byte-identical `<`/`>` body) plus `string-order.test.ts`. Repoint the four copies in `combat-transaction.ts`, `load-participants.ts`, `resolve-character-spell.ts`, `spell-casting.ts`. Move the doc block above `spell-casting.ts:codePointCompare` down onto `collectAffectedCharacterIds` and delete its false "Caster first" sentence. Correct the `MODULE.md` ordering wording to UTF-16 code-unit. **Do not touch `seed/spell-parser/extract-spell-combat.ts`.** | `grep -rn "function codePointCompare" packages/server/src/services/spell-casting/` returns nothing; a test pins the `affectedCharacterIds` ordering contract named in `spell-casting/MODULE.md`; the seed copy is untouched | `bun run test -- packages/server/src/services/spell-casting/spell-casting.test.ts packages/server/src/services/spell-casting/load-participants.test.ts` |
| **07.2** | Steps 2, 6, 7 together — they are one type-fidelity change across three adjacent files. Import `ABILITY_FULL_NAMES` from `@musi/shared/rules/character-rules.js` in `resolve-character-spell.ts:characterSaveModifier` (the module already imports from there). Add the narrowed `combat` to `CharacterSpellContext` and its constructing literal; drop the unreachable `!combat ||` halves in `resolveAttack`/`resolveSaves` and the optional chain in `resolveCharacterSpell`; change `resolveDamageDice` to take the narrowed `combat` so its duplicate `"Spell is cast-only"` guard goes with it. Type `getTargetParticipantIds` as `CastCombatSpellInput`, narrow on `input.mode` before reading `targetParticipantIds`, drop `?? ""`. **Keep the `MAX_COMBAT_SPELL_TARGETS` throw** and comment it with the `runCastCombatSpellCore`/`spell-action.ts` direct-caller reason. | No `!combat` guard remains downstream of `resolveCharacterSpellContext`; `getTargetParticipantIds` no longer accepts `mode: string`; the max-target throw survives with a **new** focused test that calls it directly with an over-limit array (it has none today — verified: the symbol is referenced only by `spell-casting.ts` and its own module) | `bun run test -- packages/server/src/services/spell-casting/spell-casting.test.ts packages/server/src/services/spell-casting/load-participants.test.ts packages/server/src/services/spell-casting/resolve-spell.test.ts packages/server/src/services/spell-casting/combat-eligibility.test.ts` then `bun run typecheck` |
| **07.3** | Characterization only, no production change. Add tests to `spell-casting-non-combat.test.ts` for: ritual cast with `castAtLevel` **above** the spell's base level (assert the level is discarded, no slot consumed); ritual cast with `metamagicIds` (assert no sorcery-point deduction); cantrip cast with `castAtLevel`/`metamagicIds`. Each test comment names the open question. Append an **"Open rules question"** section to `07-spell-casting-and-level-up-shape.md` recording the three discards, the `buildCastChatContent` announce-from-request mismatch, and that the internal `CastMode` union is blocked on this decision. Read `docs/guides/change-rules-logic.md`. | Three new tests pass against unchanged production code; the leaf carries the open question; no behaviour changed | `bun run test -- packages/server/src/services/spell-casting/spell-casting-non-combat.test.ts` |
| **07.4** | Race-sensitive. **Test first:** extend `asi.test.ts` (and the ASI case in `level-up-concurrency.test.ts`) so all six abilities are exercised — current coverage only drives STR, so a six-key iteration that silently omits INT/WIS/CHA would pass today. Then change `AsiContext.abilityDeltas` to `ReadonlyMap<keyof AbilityScores, number>` in `level-up/types.ts`, carry the map `validateAsiChoice` already builds instead of copying it into a `Record<string, number>`, and iterate the map in `applyAsiDeltasFromFresh`. Both `type-assertion-boundary` markers go with their casts. Trim the `AsiContext` JSDoc to the delta-vs-absolute invariant. Read `docs/CONCURRENCY.md` and `docs/guides/add-race-sensitive-mutation.md`. | Zero casts remain in `asi.ts`; `applyAsiDeltasFromFresh` still re-validates the cap against `freshStats` inside the lock and still throws `CONFLICT`; all six abilities covered | `bun run test -- packages/server/src/services/level-up/asi.test.ts packages/server/src/services/level-up/level-up-concurrency.test.ts` then `bun run lint` |
| **07.5** | Add `newClassLevel: number` to `LevelUpContext`, computed once in `validateAndBuildContext`, and consume it at `core.ts:buildClassOperation`, `level-up.ts` and `apply-level-up.ts` in place of `previousClassLevel + 1`. Change `hpMethod: string` to the shared `HpMethod` from `@musi/shared/schemas/character-inputs.js`. Move the `validateBasicPrereqs`, `validateHpRoll` and `validateMulticlassPrereqs` describes out of `asi.test.ts` into `core.test.ts`, leaving `asi.test.ts` with its own two. **No rename of `buildClassOperation`, no split of `core.ts`.** | `grep -rn "previousClassLevel + 1" packages/server/src/services/level-up/` returns nothing; `asi.test.ts` imports nothing from `./core.js` | `bun run test -- packages/server/src/services/level-up/core.test.ts packages/server/src/services/level-up/asi.test.ts packages/server/src/services/level-up/level-up.test.ts packages/server/src/services/level-up/level-up-subclass.test.ts packages/server/src/services/level-up/level-up-multiclass-sorcerer.test.ts` |

### Dependency edges

- `07.1 -> 07.2` — file overlap only (`resolve-character-spell.ts`,
  `load-participants.ts`, `spell-casting.ts`), not semantics. Either order works
  if you are willing to rebase; sequencing is cheaper.
- `07.3` is independent of everything and can land first, last, or in parallel —
  it touches only a test file and the leaf doc. It **blocks** any future
  `CastMode` work.
- `07.4 -> 07.5` — both touch `level-up/types.ts`. File overlap only.
- **Stream A** = {07.1, 07.2, 07.3}, **Stream B** = {07.4, 07.5}. The two streams
  share no file and can run concurrently in separate worktrees.
- **The `06 <-> 07` edge in `00-index.md` dissolves.** With step 13 removed from
  leaf 07, nothing in this plan touches `packages/server/src/seed/`. Leaf 06 gains
  the no-op map at `generate-subclasses.ts`, the `parse-glossary-entry.ts` branch
  collapse, the `extract-spell-metadata.ts:ABILITY_MAP` derivation and the
  `extract-spell-combat.ts:compareCodePoint` copy, and owns the shared-`seed/`-helper
  home decision alone.

### Index reconciliation (slice 07.1 applies these)

1. `00-index.md`, "How to use this pack": drop `06<->07` from the Server
   dependency list.
2. `00-index.md`, "Read this first": leaf 07 is no longer "three streams"; it is
   two streams of five slices. Point the row at this file.
3. Leaf 06's Scope/caveats already claims the reciprocal edge; note there that
   the seed items now belong wholly to 06.

## Operational risks

- **07.4 is the only genuinely dangerous slice.** `applyAsiDeltasFromFresh` must
  stay inside `apply-level-up.ts`'s `updateCharacterStatsLocked` callback. The
  invariant is fresh-row addition + cap recheck + `CONFLICT`, not "no casts".
  Existing concurrency coverage is strong but drives STR only — write the
  six-ability coverage **before** changing the representation, or a
  five-of-six iteration ships green.
- **07.2 changes an exception path's identity.** Retiring the duplicate
  `"Spell is cast-only"` guard in `resolveDamageDice` means that message now
  originates from exactly one place. If any test or client asserts on the count
  or origin of that message, it will move.
- **07.5 does not remove the `hpMethod: "roll"` + `hpRolled: null` state.** The
  shared schema's `.refine()` does not produce a discriminated TypeScript union,
  and direct service calls currently fall back to average while recording
  `"roll"`. Typing the field is a naming fix, not a state-space fix. Do not let
  the slice grow to chase it.
- **Ordering is an observable contract.** `spell-casting/MODULE.md` pins
  `affectedCharacterIds` as deduped and ordered, and `combat-transaction.ts`
  additionally uses the same comparator for multi-row **lock order** — changing
  it would change deadlock behaviour under concurrency, not just output. Byte-identical
  body only; never `localeCompare`.
- **07.3 pins behaviour that may be wrong.** That is deliberate: the tests are
  characterization tests, each labelled with the open question. If the rules
  decision lands, they change with it. Do not present them as desired behaviour.

## Rejected alternatives — why

| Rejected | Why |
|---|---|
| **The leaf as written: 13 commits on one branch** | Both consults independently returned "shrink". Five of the thirteen steps buy no type information at all, and the leaf's own caveats already say the three streams are separable. |
| **Internal `CastMode` discriminated union (step 5)** | Cursor's pick; rejected on codex's reasoning, verified. Metamagic is orthogonal to slot level, ritual is a procedure rather than a resource, and the union would formalize three undecided discards. Slice 07.3 turns it into a rules question first. Revisit after that decision. |
| **A wire-level cast union in `castSpellInputSchema`** | The leaf's own caveat is correct and both consults agreed: the cantrip branch is decided by `spell.level` from the DB, and a server cannot trust a client-declared cast kind. |
| **One unified `ResolvedCast` domain object across combat and non-combat** | Cursor considered and rejected it: two entry points, two persistence shapes, two result types. Unification invents coupling the seams do not have. |
| **`Partial<Record<keyof AbilityScores, number>>` for `abilityDeltas` (the leaf's step 10)** | Codex's `ReadonlyMap<keyof AbilityScores, number>` is strictly better: `validateAsiChoice` already builds exactly that map, so carrying it removes the lossy copy, the `Object.entries` widening, both casts and the second six-key registry. The leaf's version re-types the copy and keeps it. |
| **A class-transition discriminated union for `LevelUpContext` (codex's step-11 reframe)** | Genuinely better modelling — `isNewClass` + nullable `targetClassRecordId` + `previousClassLevel` are three correlated fields that should be one union. But it reshapes a context consumed across `core.ts`, `level-up.ts`, `apply-level-up.ts` and `subclass.ts`, which is not one session, and it is not what the leaf evidenced. **Deferred, not dropped:** open it as its own leaf if 07.5 lands clean and the correlation causes a second defect. |
| **Splitting `level-up/core.ts` (step 12)** | Both consults dropped it, and the leaf's stated premise is false — its siblings carry the same banner triad (see Evidence corrections). The only real defect in that step is three misfiled `describe`s, kept in 07.5. |
| **Hoisting the comparator across `services/` and `seed/` at once** | Creates the `06 <-> 07` coordination the leaf then has to caveat around. Scoping to `spell-casting/` makes the edge disappear; leaf 06 hoists its own seed helpers on its own schedule. |
| **Deleting the `Too many spell targets` guard** | The leaf offered it as a choice. Ruled: keep. `runCastCombatSpellCore` is a documented facade with a live non-router caller, and array length is not in the TypeScript type. |
| **`castWithoutSlot` extraction (step 3)** | Thirteen lines, and it hardens the semantics 07.3 puts under question. Cheap to do later, expensive to undo. |
