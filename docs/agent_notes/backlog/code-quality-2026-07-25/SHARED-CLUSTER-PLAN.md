# SHARED-CLUSTER-PLAN. The eight shared leaves: scheduling plan

Status: **Finished — 21 of 22 slices landed, closing all eight leaves; U3 is
closed-declined with reasons** (W1 in merge `028a21d5`; W2, A1, D1, D2, K1,
K2, K3 in merge `7a4b10ac`; I1, I2, I3, R1, R2 and R3 in merge `ec4d732c4`;
S1, S2, S3, U1, U2, E1 and E2 in merge `75bad57dc`). There is no open shared
tail. See [Slices](#slices), whose `State` column is the authority. The
[index reconciliation](#index-reconciliation-applied-2026-07-26) this plan
carried was applied to `00-index.md` on 2026-07-26, after slice D.

Originally planned as: **one live rules defect that shrinks to a single adapter
fix, two real modelling errors, three bounded cleanups, one leaf re-framed from a
naming problem into a documentation problem, and two leaves cut roughly in
half.** Supersedes the `## Proposed direction` of leaves
[18](./18-shared-class-identity.md),
[19](./19-weapon-and-armor-catalog.md),
[20](./20-rules-tables-to-formulas.md),
[21](./21-shared-constants-single-source.md),
[22](./22-shared-discriminated-unions.md),
[23](./23-schema-layout-and-naming.md),
[25](./25-dice-model.md) and
[26](./26-shared-dead-and-vestigial.md).

Date: 2026-07-26 · Area: shared · Source leaves: 18, 19, 20, 21, 22, 23, 25, 26
(leaf 24 landed 2026-07-26)

Cross-model planning session: `consult codex` (own subagents across SRD 5.2.1
domain modelling, schema/type design, persistence and back-compat risk, and
cross-package blast radius, synthesized) and `consult cursor` (Grok, "step back —
is this domain modelled right, and would you model it differently?"). Both were
asked the same question independently. **They split on the shape of the leaf-19
fix — the biggest call in this cluster — and on three leaf claims that turn out
to be false.** Those rulings, with their reasons, are in
[Ruling: leaf 19](#ruling-leaf-19--the-live-defect-and-a-much-smaller-fix-than-the-leaf-proposes)
and [Corrections to the leaves](#corrections-to-the-leaves-verified). Every count
and anchor below was re-measured against `313b6dfe` (`main`); the leaves'
evidence is pinned to `883d48bf` and some anchors have moved
(`packages/shared/src/schemas/homebrew.ts` shifted by one line when leaf 24 landed
as `c36c9a17`, so its private `MAX_LEVEL` is at `:84`, not `:83`).

## Verdict

**`packages/shared` models the 5E domain correctly. This cluster contains exactly
one live defect (19), two genuine modelling errors (25 and 18), and five leaves of
hygiene against a sound shape — two of which (23 and 26) are substantially not the
problems they say they are.**

The package has **two kinds of boundary and does not always say which is which**,
and that single fact decides all eight leaves:

1. **Persisted-JSON and wire seams.** `InventoryItem.properties`,
   `Equipment.weaponData`, `HomebrewEntry.data`,
   `CharacterLevelChoice.choiceData`, `Notification.data`, `Spell.classes`,
   `ChatMessage.metadata` — Prisma `Json` columns parsed by Zod. Zod strips
   unknown keys, so **any key removed from one of these schemas is erased from
   every legacy row at read time**, and a form that rebuilds its payload from a
   narrower model writes that loss back to the database.
2. **Inward-facing vocabularies and internal state.** `WEAPON_PROPERTIES`,
   `DamageTypeName`, `SKILL_ABILITY_MAP`'s key set, the class ids in the rules
   tables, `DiceGroup`'s term kinds — closed sets that live and die inside the
   package and are neither persisted nor transmitted.

Nearly every proposal in these eight leaves is a proposal to *tighten* something.
Four rules sort them, and both consults converged on essentially the same four:

- Close canonical SRD vocabularies and static rules tables.
- Keep genuinely open DB and user boundaries open, and narrow at the adapter.
- Use Zod for persisted and wire shapes; use ordinary TypeScript unions for
  internal parser and rules state that is neither persisted nor transmitted.
- **Do not make two representations identical merely because they are related.**

That last rule is the one this cluster most needs, and it is the one leaf 19 gets
wrong. There is nothing incoherent about a domain having a **storage spelling**
and a **rules spelling** for the same concept, as long as exactly one declared
adapter translates between them. What is incoherent is having two spellings and
*no* adapter — which is the actual bug. Leaf 19 proposes to fix it by unifying the
spellings across the seed, three schemas, a Prisma comment and a client form; the
fix is one line in the adapter that already exists. See
[Ruling: leaf 19](#ruling-leaf-19--the-live-defect-and-a-much-smaller-fix-than-the-leaf-proposes).

Three leaves have already been half-answered by the repo itself, and each answer
shrinks its leaf:

- [`00-index.md`](./00-index.md#executive-summary) records 124 `*InputSchema` exports each paired with an
  inferred `*Input` type. **Re-measured on `313b6dfe`: still exactly 124.** So
  leaf 23 is not a naming problem. Its real finding is that
  `packages/shared/src/schemas/MODULE.md` — the *only* navigational aid a
  barrel-less contract layer has — is **wrong about four of its own files**. See
  [Ruling: leaf 23](#ruling-leaf-23--not-a-naming-problem-a-lying-module-doc).
- `knip.config.ts:21-24` blanket-exempts `packages/shared/src/{schemas,rules,map}/**`
  from unused-`exports` and `types` reporting. Leaf 26's uncalled helpers are a
  *policy consequence*, not an oversight, and no gate will confirm any cleanup
  landed. Two of its three substantive claims are additionally false (corrections
  4 and 5), so what survives is about a third of the leaf.
- `docs/guides/change-rules-logic.md:21-23` mandates transcribing SRD tables as
  reviewable constants. That refutes leaf 20's own headline ("rules tables to
  formulas") — and so does a behaviour change the leaf itself documents. See
  [The two traps the index warns about](#the-two-traps-the-index-warns-about).

So: **eight leaves → one urgent one-line defect fix (19), two modelling
corrections (25, 18), two bounded cleanups (21, 20), one leaf re-framed as
documentation (23), and two leaves cut to their honest remainder (22, 26).**

### Ruling: leaf 25 — the dice model

**Both consults and I agree without reservation: the sentinel record is a
modelling error, the discriminated union is right, and it is unusually cheap.
Keep leaf 25 in full.**

A flat modifier term `+5` is encoded `{ count: 0, sides: 0, keep: undefined,
modifier: 5, sign }` (`packages/shared/src/dice/dice-notation.ts:155`), while
`parseDiceTerm` throws when `sides < MIN_DIE_SIDES` (`:130-133`). The type
describes a state its own parser refuses to construct. `rollDice` is safe only
because `for (let i = 0; i < group.count; i++)`
(`packages/shared/src/dice/dice-roller.ts:15-17`) never fires for a flat term, so
`rng(1, 0)` is never called. That is safety by arithmetic accident, not safety
expressed in the type. `1d20+5` is genuinely two terms — the notation splits at
`+` before either term is parsed — so the union matches the grammar rather than
imposing on it.

It is cheap because the input AST is package-private in practice.
`git grep -n '\bDiceGroup\b\|\bParsedNotation\b'` over `packages/` and `e2e/`,
excluding `packages/shared/src/dice/`, returns **zero hits** (re-measured). The 14
out-of-package importers of `@musi/shared/dice/types.js` take only `RngFn`,
`RollResult` or `DiceGroupResult`. `./dice/*.js` is a declared subpath export
(`packages/shared/package.json:17-20`), so reshapeability here is a usage fact
rather than a visibility one — the leaf says exactly this and it holds. No Zod
schema is needed for the AST; it is neither persisted nor transmitted.

**The boundary that must not move:** `DiceGroupResult` and `RollResult` are wire
*and persisted* shapes. `rollResultSchema`
(`packages/shared/src/schemas/dice-inputs.ts:37-42`) validates roll metadata read
back from JSON, and roll results are written into `ChatMessage.metadata`
(`packages/server/src/routers/dice.ts`) and parsed on the client
(`packages/client/src/components/campaign/chat/chat-message.tsx`). A flat term
must keep emitting `{ rolls: [], subtotal }`. **No `kind` on the result side, and
no dropping `rolls` for flat terms, ever.** Both consults raised this
independently and the leaf caveats it.

**One refinement neither the leaf nor either consult states precisely.**
`dice-roller.ts:31` computes `subtotal = (diceSum + group.modifier) * group.sign`,
so a *dice* group carrying a nonzero modifier is arithmetically meaningful even
though the parser never emits one — and `dice-roller.test.ts:20-23` pins exactly
that combination (`{ count: 1, sides: 20, keep: undefined, modifier: 5, sign: 1 }`).
Under the union that state stops existing. The fixture must be **rewritten as two
terms**, not deleted, or the suite silently loses its `1d20+5` assertion. That is
the one place this rewrite can drop coverage without any test going red.

### Ruling: leaf 18 — class identity

**Keep, shrunk, with one renaming correction. Both consults independently
endorsed the leaf's model and its refusal to normalise the persisted column.**

This is not one concept spelled two ways. It is a **primary key** and an
**external-source classification**, which is the normal shape for any system that
ingests a third-party catalog:

- `Class.id` is a free-form `String @id` (`packages/server/prisma/schema.prisma:468-469`,
  commented `// e.g. "class-barbarian"`), FK'd from `CharacterClass.classId`
  (`:904`), and every SRD row is seeded prefixed. This is what the rules tables
  key on.
- The SRD's own index (`bard`, `cleric`, …) is persisted *inside* the
  `Spell.classes` Json column as eight spell-list tags, documented at
  `packages/shared/src/schemas/spell.ts:37-40` and consumed by the seed script.

Having both is correct. Having **no declared adapter**, and converting between
them at seven undeclared sites, is the defect: the dual-key fallback at
`packages/shared/src/rules/spellcasting.ts:196-197`
(``PREPARED_SPELLS_BY_CLASS[classId] ?? PREPARED_SPELLS_BY_CLASS[`class-${classId}`]``),
five `replace(/^class-/, "")` strips, and one `` `class-${classId}` `` comparison.

So leaf 18 steps 1-2 are right, and its caveat forbidding a `Spell.classes`
migration is right: that is a Json backfill plus a seed rewrite, and
`packages/server/src/utils/spell-mapping.ts` parses those tags **without a
fallback**, so a partial backfill breaks spell reads.

**Correction that matters for the commit message: do not call the prefixed type
`ClassId`.** It is not the type of `CharacterClass.classId` — the leaf's own
caveat says so (`Class.id` is free-form, homebrew classes are `HomebrewEntry`
rows, nothing stops a future writer). A type called `ClassId` will be read as "the
type of the FK", and the next reader will narrow a public signature to it, which
is precisely what the leaf spends a paragraph forbidding. **Name it
`SrdClassId`** (codex proposed `SrdClassId`/`SrdClassRecordId`; cursor was
agnostic). The name then carries the constraint, and the unknown-id fallbacks
(`?? 0` at `weapon-mastery.ts:102`, `return []` at `multiclass-rules.ts:91-93`,
`?? null` at `spellcasting.ts:204`, the caster-type formula at `:374`) read as
deliberate rather than vestigial.

**Declare the correspondence once, in one direction.** Codex's refinement, adopted:
write `Record<SpellClassId, SrdClassId>` as the single authoritative map (total,
8 → 8) and *derive* the partial reverse from it rather than hand-maintaining two
tables. The leaf asks for both to be written; two hand-written maps is the drift
it is trying to remove.

**Shrink step 5.** Steps 1-4 end by deleting the dual-key fallback — the actual
hazard. Step 5 asks each of the six conversion sites to "decide what a
non-spellcaster class id means", which is six behaviour decisions across `server`
and `client` (two feed a tRPC query argument, two gate a validation branch) bought
for a compile-time gain in `shared`. Re-scope it: **route the six sites through
the mapping while preserving today's behaviour exactly, pinning each with a test
first.** Do not change any site's answer for a non-spellcaster id in this pack.

**One addition, from codex.** `listSpellsInputSchema.classId`
(`packages/shared/src/schemas/spell.ts:275-286`) accepts any `idField` even though
it queries the closed `Spell.classes` vocabulary. Once `SpellClassId` is a named
type this is a one-line tightening of a request schema with a closed domain —
take it in I1.

## The two traps the index warns about

[`00-index.md`](./00-index.md#read-this-first) warns that this cluster contains an obvious fix that is wrong
in two specific shapes. Both are real and both live in these eight leaves.

**Trap 1 — the proficiency-bonus formula.** `PROFICIENCY_BONUS_TABLE`
(`packages/shared/src/rules/character-rules.ts:13`) is 20 rows of exactly
`2 + floor((level - 1) / 4)`, and `:81` returns
`PROFICIENCY_BONUS_TABLE[level] ?? DEFAULT_PROFICIENCY_BONUS`. **The table is also
the out-of-range guard.** `proficiencyBonus(21)` is `2` today and `6` under
clamp-then-formula; `proficiencyBonus(5.5)` is `2` today and `3` under the
formula. `getCantripsKnown` has the identical hole: its clamp at
`spellcasting.ts:324` does not integer-round, so a fractional level still misses
the table and yields `0`. Leaf 20 step 3 forbids the conversion and
`docs/guides/change-rules-logic.md:21-23` forbids it independently, so **the leaf's
caveat is sufficient**. R1 pins the three answers as tests so nobody can make the
change silently — with codex's qualification recorded in the test's own comment:
pinning `2` is *characterisation of current behaviour*, not an adjudicated ruling
that `2` is the right domain answer for an invalid character level.

**Trap 2 — the schema change that strips legacy persisted homebrew keys.** It is
the homebrew item form, not a Zod schema: `parseWeaponData`
(`packages/client/src/components/homebrew/item/item-form-data.ts:126-138`) reads
raw `unknown` with no schema, and `buildWeaponData` (`:182-191`) **rebuilds the
entire weapon payload from the form's own `ItemWeaponData`**, so any key the form
stops modelling is deleted from `HomebrewEntry.data` on the next save of that
item. Renaming `twoHandedDice` to `versatileDice` there without first teaching
`parseWeaponData` to read either key destroys the value on every existing homebrew
weapon that gets edited.

**Under this plan the trap is not merely caveated — it is removed, because the
rename is not scheduled at all.** Leaf 19's caveat is directionally right but
still leaves a four-commit sequence in which every intermediate state has to be
independently safe. Not doing the migration is strictly safer than doing it
carefully. See [Ruling: leaf 19](#ruling-leaf-19--the-live-defect-and-a-much-smaller-fix-than-the-leaf-proposes)
and the [back-compat section](#persisted-data-and-back-compat), which records
"do not rename the storage key" as a standing constraint.

## Ruling: leaf 19 — the live defect, and a much smaller fix than the leaf proposes

Everything the leaf claims about the *defect* holds on `313b6dfe`. Re-verified:

- `enrichFromSrd` (`packages/shared/src/rules/attack-damage.ts:101-113`) copies
  `wp.versatileDice` only. It falls back to `srd?.weaponCategory` and
  `srd?.ranged`, but versatile dice comes from one place and one place only.
- `weaponPropertiesSchema` (`packages/shared/src/schemas/inventory.ts:33-46`)
  accepts **both** keys — `versatileDice` at `:41`, `twoHandedDice` at `:45` —
  so a `twoHandedDice`-bearing payload parses cleanly and is then dropped.
- Every writer emits `twoHandedDice`: the seed
  (`packages/server/src/seed/seed-srd-equipment.ts:249`, plus the trident override
  at `:62`), `equipmentWeaponDataSchema`
  (`packages/shared/src/schemas/srd.ts:290`), `homebrewWeaponDisplaySchema`
  (`packages/shared/src/schemas/homebrew.ts:333`), and the homebrew item form.
- `packages/server/src/services/combat-actions/resolve-attack.ts:77-79` is the
  only rules consumer and is skipped whenever the field is undefined.

**Two user-visible symptoms, not one.** The leaf names the roll (a two-handed
longsword rolls `1d8` instead of `1d10`). The second is on the character sheet:
`packages/client/src/components/sheet/equipment-summary.tsx:114` renders
`` result.versatileDice ? ` (${result.versatileDice})` : "" `` — so a seeded
longsword shows **no versatile damage at all** in the equipment summary. Both come
from the same read.

**Why nothing caught it.** Every test that exercises versatile damage hand-builds
`versatileDice`: `packages/shared/src/rules/attack-damage.test.ts:275`, `:284`,
`:319`, `:429`; `packages/server/src/services/combat-actions/resolve-attack.test.ts:83`,
`:457`; `packages/server/src/routers/encounter-combat.test.ts:204`, `:276`. There
is no test anywhere that starts from a `twoHandedDice` payload and asserts a
versatile result. The repo *does* already assert the two names are one concept —
`packages/server/src/test/srd-weapon-sync.test.ts:80` maps the seeded
`weaponData.twoHandedDice` onto `versatileDice` so it can be compared against
`SRD_WEAPONS` — but only in the seed-vs-table direction, never at the runtime
read. So the leaf's "nothing anywhere translates between them" is too absolute:
what is missing is the *production* adapter.

### Where the consults split, and the call

- **Cursor: fix the read seam now (steps 1-2), then do step 3 as a strongly
  recommended P1** — every persisted-JSON parser accepts both keys and emits
  `versatileDice` — with step 4 (converging the writers) optional.
- **Codex: shrink leaf 19 to *one adapter fix* and do not schedule steps 3-4 at
  all.** Both representations are defensible; `twoHandedDice` is the
  authoring/storage spelling and `versatileDice` is the rules spelling, and
  translating at the rules adapter is a coherent model with much less risk than a
  persisted-key canonicalisation project.
- My own first draft agreed with cursor and went further, proposing to extend the
  existing `normalizeWeaponDataDamageType` read-seam normalizer
  (`packages/shared/src/rules/damage-types.ts:68-74`) so the fold happened at all
  five seams at once.

**Call: codex is right, and the deciding evidence is a measurement neither the
leaf nor my draft made — there is no consumer of versatile dice outside the
adapter.** Re-verified on `313b6dfe`: the only production reads of
`versatileDice` are
`packages/server/src/services/combat-actions/resolve-attack.ts:77-79` and
`packages/client/src/components/sheet/equipment-summary.tsx:114`, and both sit
downstream of `getWeaponDataFromItem` / `computeWeaponAttack`
(`equipment-summary.tsx:77,93`; `packages/client/src/components/vtt/drawer/tabs/actions-tab-weapons.tsx:82,96`).
No client surface reads versatile dice off the SRD equipment browse output. The
only other reader of `twoHandedDice` is the homebrew authoring form, which
round-trips its own storage spelling to itself. **So the one-line adapter fix is
complete, and every additional seam in leaf 19 step 3 is work with no reader
behind it.**

The distinction from the existing `normalizeWeaponDataDamageType` precedent
matters and is worth writing down, because it is the reason my draft was wrong:
that normalizer unifies a **legacy** spelling with a **canonical** one for the same
field. `twoHandedDice` is not legacy — it is the current, live spelling emitted by
every writer in the system. Unifying it is a migration; translating it is an
adapter. Take the adapter.

**Correction to step 1(b) and step 2, from codex: `?? srd?.versatileDice` does not
survive.** The leaf proposes resolving as
`wp.versatileDice ?? wp.twoHandedDice ?? srd?.versatileDice`. The third term is
wrong. Parsed item properties are authoritative for a customized weapon —
`enrichFromSrd` already takes `damageDice`, `damageType` and `properties` from
`wp` (`attack-damage.ts:102-107`) — and
`packages/shared/src/rules/attack-damage.test.ts:394-409`
("prefers explicit properties over SRD fallback") is an expressly supported case:
a custom weapon *named* "Longsword" carrying `damageDice: "2d6"`,
`damageType: "fire"` and no versatile property. Adding the SRD fallback would
attach the SRD longsword's `1d10` versatile die to a 2d6 fire weapon — an
incoherent hybrid, and one that existing test would not catch because it does not
assert `versatileDice` is absent. Manual-add items with `properties: {}` still get
the complete SRD row because the parse *fails* (`attack-damage.ts:126-130`), which
is the correct and already-working path. **Resolve as
`wp.versatileDice ?? wp.twoHandedDice`, full stop.**

### What survives of leaf 19

| Step | Call | Slice |
|---|---|---|
| 1-2 (pin the bug, fix the read) | **Keep — first in the cluster — minus the `srd?.versatileDice` term** | W1 |
| 3 (normalize every persisted read seam) | **Not scheduled.** No reader exists outside the adapter. Every one of the four seams would be changed for nobody, and each is a persisted-JSON schema. | — |
| 4 (converge the writers on `versatileDice`) | **Not scheduled.** This is the migration Trap 2 guards; not doing it is strictly safer than doing it carefully, and it unblocks nothing. Recorded as a standing constraint instead. | — |
| 5 (delete the relocation facade) | **Keep** — three test imports, zero production importers, trivial | W2 |
| 6 (narrow `WeaponData.damageType`) | **Keep as a rider** on W2; both producers are already closed | W2 |
| 7 (armor) | **Split: keep the naming half, drop the `unarmoredAc(hasShield)` half.** Codex is right that `calculateArmorClass` (`packages/shared/src/rules/armor-class.ts:71-89`) coherently owns the shield decision — it reads `hasShield` for the monk exception *and* for `SHIELD_AC_BONUS`, so pushing one read into `unarmoredAc` splits the rule across two functions. Naming the three-branch `dexBonus`/`maxDex` heuristic is a genuine free readability win. | A1 (optional) |
| 8 (single-source the homebrew property vocabulary) | **Keep as a rider** on W2 — real drift risk, and `item-form-data.ts:3` already shows the pattern for the neighbouring damage-type list | W2 |

## Ruling: leaf 23 — not a naming problem, a lying module doc

[`00-index.md`](./00-index.md#executive-summary) says shared's schema naming is disciplined. Re-measured on
`313b6dfe`: `grep -rho "export const [a-zA-Z0-9_]*InputSchema" packages/shared/src/schemas/*.ts | wc -l`
returns **124**, unchanged. Codex's verdict on this leaf was "drop"; cursor's was
"shrink hard". **Call: shrink hard, because one thing in it is genuinely wrong and
cheap to fix — the module doc.**

What holds up, re-verified:

- `packages/shared/src/schemas/weapon-mastery-inputs.ts:7-20` really does hold an
  entity under a literal `// Entity schema` banner, and `schemas/character.ts:13`
  imports its entity *from* an `-inputs` file.
- `packages/shared/src/schemas/invite.ts` is 20 lines and holds **no entity** —
  only `listOutputSchema` and `invitePreviewSchema` — yet `schemas/MODULE.md`'s
  "Entity-only files with no `-inputs.ts` partner" list names it.
- That same list names `auth.ts` and `spell.ts`, which between them declare **ten**
  `*InputSchema`s inline (`spell.ts:275`, `:292`, `:302`, `:311`, `:321`;
  `auth.ts:8`, `:25`, `:82`, `:94`, `:106`) — undocumented. `srd.ts`'s four
  (`:324`, `:332`, `:342`, `:350`) are documented three separate times and are
  correctly out of scope.

That is one navigational aid being wrong about four of its own files. **The fix is
mostly to correct the doc, not to move the code.** Leaf 23 itself offers
"document it" as an equally acceptable resolution for steps 2 and 3 — take that
option, explicitly, for both.

**Drop step 4** (the ten `listOutputSchema`/`searchOutputSchema` renames). The
leaf's own caveat rates it "readability, not defect prevention"; every consuming
router imports exactly one such symbol by deep specifier, none aliases, and there
is no barrel so the names can never collide. Re-measured: 8 `listOutputSchema` +
2 `searchOutputSchema` declarations, 20 consuming router lines. The price adds 24
golden fixture directories under `scripts/codemods/fixtures/trpc-shared-output/`
compared verbatim by `scripts/codemods/trpc-shared-schema-codemod.test.ts`.
Recorded as an opportunistic sweep with one condition: if it is ever done, the
codemod fix at `scripts/codemods/trpc-shared-output-candidates.ts:86,:91` must land
in the same commit or the names regrow.

## Corrections to the leaves, verified

Twelve load-bearing claims were checked. Six of them do not survive as written,
and four of those six change what gets scheduled.

**1. Leaf 19's `srd?.versatileDice` fallback is wrong (codex; verified).** See the
leaf-19 ruling above. It would mix a custom weapon's own dice with the SRD row's
versatile die for any item that happens to share an SRD name — a supported case
pinned at `packages/shared/src/rules/attack-damage.test.ts:394-409`. **Changes the
fix.**

**2. Leaf 26's area-template claim is false, twice over (codex and cursor,
independently; verified).** The leaf says the caller "hands `templateCells` an
unnamed structural literal that will silently stop matching when the real type
changes". It does not: `computeAndStoreTemplateCells`
(`packages/client/src/hooks/canvas-input/tool-handlers.ts:119-131`) passes a full
object literal, which TypeScript checks structurally against `TemplateParams` — a
new required field there is a compile error at that call site today. Separately,
the interface the leaf names was renamed to `ComputeTemplateCellsInput` when leaf
11 landed (`:109`, commit `a716407d`), and its `origin`/`direction` are the
*operation's* inputs, not the same abstraction as `originCell` + `directionAngle`.
And the client already declares its own module-private `GridCell`
(`packages/client/src/stores/map-canvas-store.ts:73`, ~20 references, re-exported
to `components/campaign/maps/measurement-overlay.tsx:5`), so importing shared's
would put two identically-named types in one package. **Step 1 is dropped;** the
residual one-line tidy is to type `ComputeTemplateCellsInput.origin`/`direction`
with the client's *own* `GridCell`, which needs no shared export at all.

**3. Leaf 26's action-economy claim is false (codex; verified).**
`ActionEconomyState` (`packages/shared/src/rules/combat.ts:31-35`) is three
booleans. It does **not** encode `action → actionUsed`. `ACTION_ECONOMY_CONFIG`
(`packages/client/src/components/campaign/combat/action-economy-indicators.tsx:8-22`)
supplies that runtime relation *plus* a label and a Lucide icon per row, and is
consumed as `participant[field]` at `:35`. "Derive it from the interface" would
mean inventing a **new** exported runtime map in shared to serve one client
component — the opposite of what this leaf is for. **That half of step 3 is
dropped;** the `FRESH_ACTION_ECONOMY` wire-in at
`packages/server/src/services/combat-actions/turn-transaction.ts:76-80` is a
genuine literal duplicate of an existing exported const and survives.

**4. Leaf 20's reason for keeping `skillModifier`'s `skillName: string` is false
(codex; verified).** The leaf cites `packages/client/src/pages/sheet-helpers.ts:24-32`
and `packages/client/src/components/vtt/drawer/monster-stat-block-profile.tsx:94-101`
as boundaries where skill names arrive as free strings. Neither calls
`skillModifier`: the first compares `p.name === "Perception"` on DB proficiency
rows and calls `passivePerception`; the second remaps monster keys onto
`SKILL_NAMES`. The three real call sites all pass canonical values —
`packages/client/src/components/sheet/skills-list.tsx:91` and
`packages/client/src/components/vtt/drawer/tabs/stats-tab-rolls.tsx:237` both map
over `SKILL_NAMES`, and `character-rules.ts:149` passes the `"Perception"`
literal. **The conclusion still stands but on a different reason** (see R2): keep
`string` because the `?? 0` return is the same unknown-id contract the three
sibling rules lookups use, and narrowing a `packages/shared` public export for
three call sites is a boundary change, not a vocabulary tightening. Narrowing is
now an *available* follow-on with the evidence recorded, not a blocked one.

**5. Leaf 20's cantrip-table provenance request cannot be honoured as written
(codex; verified).** `FULL_CASTER_CANTRIPS`/`HALF_CASTER_CANTRIPS`/`THIRD_CASTER_CANTRIPS`
(`packages/shared/src/rules/spellcasting.ts:252`, `:275`, `:298`) are keyed on
`CasterType`, which is a *spell-slot* classification. The file says so itself
immediately below: "The 2024 SRD class-specific cantrip counts differ from the
caster-type table in `getCantripsKnown`, so creation uses this dedicated per-class
table" (`:344-348`). Warlock is deliberately `casterType: "none"`. So attributing
an SRD 5.2.1 section/table to these three tables would be **fictitious
provenance** — exactly what the guide is trying to prevent. R1 therefore writes
the provenance the guide's step 1 actually asks for in this case: *name the
non-SRD decision*, recording these as a Musi caster-type fallback used only by
`getCantripsKnown`, whose one production caller is the unknown-class level-1 path
(`:367-375`). The half-caster level-10 case is still pinned, but as
characterisation of that policy, not as an SRD assertion.

**6. Leaf 20's CR mirror already has a guard (codex; verified).**
`packages/shared/src/rules/xp.property.test.ts:73-80` round-trips every
`VALID_CR_VALUES` member through `formatCr` and `parseCr`. So step 2 is
readability with an existing regression net, not a drift risk. Kept as a free
rider on R1, correctly ranked.

**7. Leaf 22's mapper fallback is not an endpoint safety proof (codex; verified) —
and it strengthens the case for *not* doing the discriminated unions.**
`fromJsonValidated(..., {})` at `packages/server/src/utils/notification-helpers.ts:14`
protects the *nested* parse, but `notification.markRead` validates the whole
entity with `.output(notificationSchema)`
(`packages/server/src/routers/notification.ts:54-56`), and `character.get`/`create`
validate `.output(characterDetailSchema)`
(`packages/server/src/routers/character.ts:42-49`). After an outer discriminator,
a legacy `choiceType: "asi"` row degraded to `{}` would still fail *output*
validation. Neither leaf 22's step 3 nor its step 5 accounts for this. Both are
dropped, and the [back-compat section](#persisted-data-and-back-compat) records
why.

**8. Leaf 18's "bare string everywhere" is too strong (codex; verified).** The
spell side already has a closed `as const` array and a derived `SpellClassId`
(`packages/shared/src/schemas/spell.ts:41-52`). Only the prefixed side is open.
The leaf's "every production caller reads a persisted row" is also false — character
creation passes wizard/request state
(`packages/server/src/services/character-create-spells.ts:128`,
`packages/client/src/components/character-create/wizard-state.ts:126`) and level-up
passes a requested `newClassId` (`packages/server/src/services/level-up/core.ts:83-90`).
Neither changes the plan; both change the commit message.

**9. Leaf 23's weapon-mastery re-point count is stale (codex; verified).** The leaf
says seven files. Re-measured: **eight** consumers of
`characterWeaponMasterySchema`/`CharacterWeaponMastery`/`weaponMasteryPropertySchema`
outside their declaration, including `packages/server/src/utils/character-mapping.ts`,
which the leaf omits.

**10. Leaf 19's "nothing anywhere translates between them" is too absolute
(codex; verified).** `packages/server/src/test/srd-weapon-sync.test.ts:80` maps
seeded `weaponData.twoHandedDice` onto `versatileDice`. What is missing is the
*production* adapter, and that is the finding.

**Claims that hold, re-measured on `313b6dfe`:** 124 paired `*InputSchema`/`*Input`
exports; 8 `listOutputSchema` + 2 `searchOutputSchema` declarations across 20
router lines; four `MAX_LEVEL` and three `MIN_LEVEL` declarations in
`packages/shared` (`schemas/character.ts:19-20`, `schemas/srd.ts:21-22`,
`schemas/homebrew.ts:84`, `rules/spellcasting.ts:74-75`); three `MIN_HP_GAIN`
declarations across three packages; three `const D20 = 20` plus one
`NATURAL_CRIT = 20` alongside `MAX_D20_ROLL`; zero `DiceGroup`/`ParsedNotation`
references outside `packages/shared/src/dice/`; `ClassPreparedEntry` with no
reference outside its own declaration file; `getValidTransitions`,
`FRESH_ACTION_ECONOMY`, `hasActionsRemaining`, `getCurrentParticipant`,
`snapToGrid`, `pixelToHex` and `hexRound` each referenced only by their colocated
test; `isSubclassLevel` with zero production callers (the
`level-up-test-helper.ts:58` hit is an unrelated local variable);
`MIN_FREEHAND_POINTS = DEFAULT_STROKE_WIDTH + DEFAULT_STROKE_WIDTH` with the
contradictory double JSDoc (`packages/shared/src/map/drawing.ts:21,24,47-48`); the
byte-identical ASI shape in `schemas/character.ts:219-233` and
`schemas/character-inputs.ts:228-232`, same `eslint-disable` comment included.

**One cross-leaf fact no leaf records.** `packages/server/src/services/level-up/core.ts:33`
throws `BAD_REQUEST` when `character.level >= MAX_LEVEL` before any level-up
proceeds, and character creation starts at 1. That is the guarantee that makes
leaf 23 step 6 safe — `Character.level` cannot leave 1-20 through the application
— and slice **S3**'s done criteria cite it rather than assuming it.

## Leaf disposition

| Leaf | Call | Reason |
|---|---|---|
| **18** | **Keep, shrunk** → I1, I2, I3 | Two namespaces (a primary key and an eight-value spell-list classification), correctly modelled and lacking a declared adapter. Steps 1-4 stand, with `ClassId` renamed `SrdClassId` and one authoritative map rather than two. Step 5 is re-scoped from "decide per site" to "preserve per site" — six behaviour decisions across two packages is not what this leaf is for, and none is needed to delete the fallback. |
| **19** | **Keep — first in the cluster — and shrunk to one adapter fix** → W1, W2 (+ A1) | The pack's one live rules defect, with two user-visible symptoms and no test that could catch it. **Steps 3-4 are not scheduled**: there is no consumer of versatile dice outside the adapter, so the persisted-key canonicalisation has no reader behind it and is the exact migration Trap 2 guards. Step 1(b)'s SRD fallback is dropped as incorrect. Step 7 splits — naming half kept, `unarmoredAc(hasShield)` half dropped. |
| **20** | **Shrink; the headline is refuted and two sub-claims are false** → R1, R2, R3 | "Tables to formulas" is wrong twice over: the guide asks for the table form, and the conversion silently changes `proficiencyBonus(21)` from 2 to 6. The cantrip tables cannot receive SRD provenance (correction 5) and the CR fold already has a property-test guard (correction 6). What survives is honest provenance, three unpinned out-of-range answers, one dead export, a closed skill vocabulary, and two fake derivations in `map/drawing.ts`. |
| **21** | **Keep, split three ways** → K1, K2, K3 | Values are already identical everywhere, so steps 1-3 are pure re-pointing with no behaviour to move. `MIN_HP_GAIN` is the one with genuine cross-layer risk: three declarations in three packages of a rules constant `shared` keeps private. Step 5 (ASI leaf module) lands as its own slice; codex is right that its edge against leaf 22 is edit-order, not semantics. |
| **22** | **Cut to two landed slices; one step merged away, two dropped, one split out and closed-declined** → U1, U2 (+ S1; U3 declined) | Step 1 landed as U1 and strictly widens what the read path preserves. Step 2 **merged into S1**. Steps 3 and 5's discriminated unions were **dropped** because correction 7 shows the mapper fallback does not protect the whole-entity tRPC output; step 5's read-path degradation landed alone as U2. Step 4 split out as U3, then all three pre-merge panelists endorsed declining it: the coincident socket shapes are independent wire contracts, and aliasing their schema identities would weaken two existing mis-wiring gates for about 8 lines saved. |
| **23** | **Shrink hard, re-framed** → S1, S2, S3 | The naming is already disciplined (124 pairs). The finding is that `schemas/MODULE.md` is wrong about four of its own files. Keep step 1 (entity extract + doc fix, eight consumers not seven), resolve steps 2-3 by **documenting** rather than extracting, keep step 5, keep step 6 with a named precondition. **Step 4 dropped.** |
| **25** | **Keep in full** → D1, D2 | A modelling error that is cheap to fix: zero references to `DiceGroup`/`ParsedNotation` outside the module, and the union matches the grammar. Both consults agreed without reservation. The result types must stay undiscriminated, and the `1d20+5` fixture must be rewritten rather than deleted. |
| **26** | **Cut to a third** → E1, E2 | Two of its three substantive claims are false (corrections 2 and 3), and `knip.config.ts:21-24` exempts this tree by design so "unused export" is not automatically a finding. What survives: one export with no reference at all, one genuine literal duplicate, and the initiative sort. Step 6 shrinks to **one line in `schemas/MODULE.md`**, folded into S1. |

## Slices

Twenty-two slices, all adjudicated. Twenty-one landed; the only non-landed
slice, U3, is closed-declined rather than deferred. A1 and W2's optional third
commit were taken. The dependency record below is historical; it has no open
scheduling edge.
Read `docs/guides/change-rules-logic.md` before W1, W2, A1, I2, K2, R1, R2 and
E2; `docs/guides/add-module-doc.md` before S1; and
`docs/guides/add-socket-broadcast.md` before U3.

**Twenty-one of the twenty-two landed** — W1 in slice C (merge `028a21d5`);
W2, A1, D1, D2, K1, K2 and K3 in slice D (merge `7a4b10ac`); I1, I2, I3, R1,
R2 and R3 in merge `ec4d732c4`; and S1, S2, S3, U1, U2, E1 and E2 in merge
`75bad57dc`. That closes leaves 18, 19, 20, 21, 22, 23, 25 and 26. **U3 is
closed-declined with all three pre-merge panelists concurring; it is not a
pickup surface.** The `State` column below is the authority.

| # | State | Scope | Done criteria | Verification |
|---|---|---|---|---|
| **W1** | **Landed** `028a21d5` | **Versatile damage: prove it, then fix the adapter (XS, leaf 19 steps 1-2, corrected). Land this first — it is the only live defect in the cluster.** Write the failing test first in `packages/shared/src/rules/attack-damage.test.ts`: an inventory weapon item whose `properties` carry `twoHandedDice: "1d10"` and no `versatileDice` yields `versatileDice: "1d10"` from `getWeaponDataFromItem`. Then resolve versatile dice in `enrichFromSrd` (`packages/shared/src/rules/attack-damage.ts:101-113`) as `wp.versatileDice ?? wp.twoHandedDice`. **Do not add `?? srd?.versatileDice`** — see correction 1; it would attach the SRD longsword's `1d10` to a custom 2d6 weapon that merely shares the name (`attack-damage.test.ts:394-409`). Repoint or add a resolver regression in `packages/server/src/services/combat-actions/resolve-attack.test.ts` whose item carries `twoHandedDice`, passes `versatile: true`, and asserts `damageDice === "1d10"` plus the deterministic damage total; the existing cases at `:83` and `:457` bypass the broken seam by hand-building `versatileDice`. In the same commit, write the two-representation contract down as a comment on `enrichFromSrd`: `twoHandedDice` is the authoring/storage spelling, `versatileDice` is the rules spelling, this function is the only translator, and neither key may be removed from a persisted schema. **No schema change, no writer change, no migration.** | The shared test fails before the `??` and passes after; a server versatile regression exists whose payload carries `twoHandedDice` and no `versatileDice`; `git grep -n "twoHandedDice" packages/shared/src/schemas/` still returns `inventory.ts`, `srd.ts` and `homebrew.ts` unchanged; `enrichFromSrd` carries the contract comment | `bun run test -- packages/shared/src/rules/attack-damage.test.ts packages/server/src/services/combat-actions/resolve-attack.test.ts` |
| **W2** | **Landed** `7a4b10ac` | **Weapon catalog riders (S, leaf 19 steps 5, 6, 8).** Commit 1: retarget the three shared test imports (`attack-damage.test.ts:15`, `attack-damage.property.test.ts:14`, `weapon-mastery.test.ts:3`) at `./srd-weapons.js` and delete the relocation facade at `packages/shared/src/rules/attack-damage.ts:15-22`. Commit 2: narrow `WeaponData.damageType` (`packages/shared/src/rules/srd-weapons.ts:22-29`) from `string` to `DamageTypeName`; both producers are already closed — the table literals, and `wp.damageType` via `damageTypeNameSchema` (`schemas/inventory.ts:37`) with the legacy title-case canonicalized at `attack-damage.ts:123`. Commit 3 (optional): derive the homebrew weapon-property option list at `packages/client/src/components/homebrew/item/item-weapon-fields.tsx:8-20` from the shared `WEAPON_PROPERTIES` (`packages/shared/src/rules/srd-weapons.ts:5-16`) with `"special"` appended explicitly, following the `DAMAGE_TYPES` pattern at `item-form-data.ts:3`. **Do not narrow `WeaponData.properties` to `WeaponProperty[]`** — `enrichFromSrd` populates it from `z.array(z.string()).optional()`, i.e. arbitrary persisted and DM-authored strings; only a table-local `satisfies` is sound. **Do not delete the tombstone at `packages/shared/src/rules/character-rules.ts:157-165`** — it documents why the armor symbols are deliberately not re-exported (runtime cycle caught by `lint:import-cycles`). **Do not add `"special"` to the shared list.** | `packages/shared/src/rules/attack-damage.ts` has no re-export block; `WeaponData.damageType` is `DamageTypeName`; `item-weapon-fields.tsx` declares no literal weapon-property list; `character-rules.ts:157-165` is byte-unchanged | `bun run test -- packages/shared/src/rules/attack-damage.test.ts packages/shared/src/rules/srd-weapons.test.ts packages/shared/src/rules/weapon-mastery.test.ts packages/client/src/components/homebrew/item/item-form-data.test.ts` then `bun run typecheck` and `bun run lint:import-cycles` |
| **A1** | **Landed** `7a4b10ac` | **Optional: name the armor-category heuristic (XS, leaf 19 step 7, first half only).** Extract `packages/shared/src/rules/armor-class.ts:103-105` into a named, commented helper stating the "no dex bonus ⇒ heavy, capped dex ⇒ medium, otherwise light" inference and why the persisted `armorPropertiesSchema` (`schemas/inventory.ts:51-57`) carries no category. **Do not give `unarmoredAc` a `hasShield` parameter** — `calculateArmorClass` (`:71-89`) reads `hasShield` for the monk exception *and* for `SHIELD_AC_BONUS`, so moving one read out splits the rule across two functions (correction to leaf 19 step 7). The PHB comment at `:78-79` stays where it is, verbatim. **No AC number may change.** | Every existing `armor-class.test.ts` case passes unchanged; the heuristic is one named function with a comment; `unarmoredAc` still takes two parameters; the PHB comment is byte-identical and in the same place | `bun run test -- packages/shared/src/rules/armor-class.test.ts` then `bun run lint` |
| **D1** | **Landed** `7a4b10ac` | **Dice result types from Zod, and one dead fallback (XS, leaf 25 steps 1-2).** Replace the hand-authored `DiceGroupResult`/`RollResult` at `packages/shared/src/dice/types.ts:29-43` with `z.infer` aliases over `diceGroupResultSchema`/`rollResultSchema` (`packages/shared/src/schemas/dice-inputs.ts:29-44`), per `packages/shared/src/schemas/MODULE.md:142`. `dice-inputs.ts` imports only `zod` and `../constants.js`, so this adds no cycle. Decide explicitly whether `DiceGroupResultParsed`/`RollResultParsed` become deprecated re-exports or are renamed away — both have live client consumers (`packages/client/src/components/campaign/chat/dice-roll-result.tsx:1` and its test) — and say which in the commit message; do not leave two live names. Then replace `rollDice({ ...parsed, notation: parsed.notation ?? notation }, rng)` at `packages/shared/src/dice/dice-roller.ts:55` with `rollDice(parsed, rng)`. **Keep the conditional spread at `:43`** and **keep `ParsedNotation.notation` optional** — all 21 direct `rollDice` fixtures omit it. | `types.ts` declares no hand-authored result interface; exactly one live name exists per result type; `dice-roller.ts:55` has no `??`; `dice-roller.ts:43` is unchanged; no runtime diff | `bun run test -- packages/shared/src/dice/dice-roller.test.ts packages/shared/src/dice/dice-roller.property.test.ts packages/shared/src/schemas/dice-inputs.test.ts packages/client/src/components/campaign/chat/dice-roll-result.test.tsx` then `bun run typecheck` |
| **D2** | **Landed** `7a4b10ac` | **Dice terms as a discriminated union (M, leaf 25 steps 3-5).** Introduce `type DiceTerm = { kind: "dice"; count; sides; keep; sign } \| { kind: "flat"; value; sign }` in `packages/shared/src/dice/types.ts`, have `parseDiceTerm` (`dice-notation.ts:123-142`) and `parseTerm` (`:144-160`) emit the matching variant instead of sentinel-filled records, and convert the roll loop (`dice-roller.ts:12-39`) to an exhaustive switch — dice arm keeps the roll/keep/sum logic, flat arm computes `value * sign` directly. **Both arms still push a `DiceGroupResult`-shaped entry; the flat arm emits `{ rolls: [], subtotal }`.** Rewrite `dice-roller.test.ts:20-23` as **two terms**, not a deletion — it is the suite's `1d20+5` assertion (see the leaf-25 ruling). Do **not** touch the keep-highest/keep-lowest sorting; it is SRD-facing and property-tested. Do **not** add a discriminator to `DiceGroupResult`/`RollResult` or drop `rolls` for flat terms — they are persisted into `ChatMessage.metadata`. | `packages/shared/src/dice/types.ts` admits no `sides: 0` state; the roll loop switches on `kind`; `rollResultSchema` and `diceGroupResultSchema` are byte-unchanged; the four dice test files assert the same totals; a `1d20+5` case still exists | `bun run test -- packages/shared/src/dice/dice-notation.test.ts packages/shared/src/dice/dice-notation.property.test.ts packages/shared/src/dice/dice-roller.test.ts packages/shared/src/dice/dice-roller.property.test.ts` then `bun run typecheck` |
| **I1** | **Landed** `ec4d732c4` | **Name the two class-identity namespaces (S, leaf 18 steps 1-2).** In `packages/shared`, declare `SrdClassId` (the twelve prefixed rules ids — **not** `ClassId`, see the ruling) and keep the existing `SPELL_CLASS_IDS`-derived `SpellClassId`, both from `as const` arrays. Declare **one** authoritative map, `srdIndexToClassId: Record<SpellClassId, SrdClassId>` (total, 8 → 8), and **derive** the partial reverse from it rather than hand-writing a second table. **The test must not assert a bijection**: assert totality in the SRD-index → prefixed direction and round-trip identity on the eight spellcasters only (barbarian, fighter, monk and rogue have no spell-list tag). Also tighten `listSpellsInputSchema.classId` (`packages/shared/src/schemas/spell.ts:275-286`) from `idField` to the closed spell-tag vocabulary it queries. The commit message must not claim the union is exhaustive over runtime class ids — `Class.id` is a free-form `String @id` (`packages/server/prisma/schema.prisma:468-469`) — and must not repeat leaf 18's "every production caller reads a persisted row" (correction 8). | `SrdClassId` has 12 members, `SpellClassId` 8; exactly one hand-written correspondence table exists; the mapping test asserts totality one way and round-trip on eight, and nothing else; `listSpellsInputSchema` rejects an unknown class tag | `bun run test -- packages/shared/src/schemas/spell.test.ts packages/shared/src/rules/spellcasting.test.ts` plus the new mapping test, then `bun run typecheck` |
| **I2** | **Landed** `ec4d732c4` | **Retype the tables and delete the dual-key fallback (M, leaf 18 steps 3-4).** Retype `MULTICLASS_PREREQUISITES` (12, `packages/shared/src/rules/multiclass-rules.ts:29-48`), `PREPARED_SPELLS_BY_CLASS` (8, `packages/shared/src/rules/spellcasting.ts:178-187`), `LEVEL_1_SPELL_SELECTION_BY_CLASS` (8, `:350-359`) and `MASTERY_SLOTS` (6, `packages/shared/src/rules/weapon-mastery.ts:92-99`) as `Record<SrdClassId, …>` or `Partial<Record<SrdClassId, …>>` where intentionally incomplete. **Keep every public signature on `string`**; add `isSrdClassId(value: string): value is SrdClassId` beside the array and narrow **inside** each lookup, preserving the existing unknown-id fallbacks (`?? 0`, `return []`, `?? null`, the caster-type formula) exactly. Then delete the dual-key fallback at `spellcasting.ts:196-197`: all four live callers pass the prefixed form. `spellcasting.test.ts:283-296` deliberately pins the unprefixed branch and will go red — delete or rewrite it in the same commit and state in the message that no production caller passes an unprefixed id. **Touch no numeric value**, and preserve the `eslint-disable`/`enable no-magic-numbers` fences (`spellcasting.ts:63`, `:176` and neighbours) verbatim. | The four tables are keyed on `SrdClassId`; every public lookup still takes `string`; ``grep -n 'PREPARED_SPELLS_BY_CLASS\[`class-' packages/shared/src/rules/spellcasting.ts`` returns 0, down from 1; no SRD number changed; `lint:suppressions:ledger` shows no new suppression | `bun run test -- packages/shared/src/rules/spellcasting.test.ts packages/shared/src/rules/weapon-mastery.test.ts packages/shared/src/rules/multiclass-rules.test.ts` then `bun run typecheck` and `bun run lint` |
| **I3** | **Landed** `ec4d732c4` | **Route the six conversions, behaviour-preserving (S, leaf 18 step 5, re-scoped).** Replace the five `replace(/^class-/, "")` strips (`packages/client/src/components/sheet/add-spell-dialog.tsx:135`, `packages/client/src/components/character-create/steps/spells-review-card.tsx:24`, `packages/client/src/components/character-create/steps/spell-selection-step.tsx:15`, `packages/server/src/services/character-create-spells.ts:148`, `packages/server/src/routers/character-spell.ts:87`) and the `` `class-${classId}` `` comparison at `packages/server/src/services/spell-casting/combat-eligibility.ts:30` with calls through I1's mapping. **Preserve today's behaviour at every site**: where the mapping returns `undefined` for a non-spellcaster id, reproduce exactly what the bare-string strip produced. Pin each site with a test *before* the change. Delete the compensating comment at `add-spell-dialog.tsx:134`. Do **not** change any site's answer for a non-spellcaster class id in this pack — record that as a follow-on decision. | `grep -rn 'replace(/\^class-/' packages/client/src packages/server/src` returns 0, down from 5; ``grep -rn 'class-\${' packages/server/src packages/client/src \| grep -v test`` returns 0, down from 1; every touched site has a test that would have failed had behaviour changed | `bun run test -- packages/client/src/components/sheet/add-spell-dialog.test.tsx packages/server/src/routers/character-spell.test.ts packages/server/src/services/character-create-spells.test.ts packages/client/src/components/character-create/steps/spell-selection-step.test.tsx packages/client/src/components/character-create/steps/review-step.test.tsx` then `bun run typecheck` (note: `spells-review-card.tsx` has no colocated test; `review-step.test.tsx` renders it via `review-step.tsx:323`) |
| **K1** | **Landed** `7a4b10ac` | **One home for the level bounds and `MIN_HP_GAIN` (S, leaf 21 steps 1-3).** Declare `MIN_LEVEL`/`MAX_LEVEL` in `packages/shared/src/constants.ts` beside `MAX_SPELL_LEVEL` and `MAX_HIT_DICE`; delete the four private redeclarations (`schemas/character.ts:19-20`, `schemas/srd.ts:21-22`, `schemas/homebrew.ts:84`, `rules/spellcasting.ts:74-75`) and repoint the two in-package consumers plus the five out-of-package `MAX_LEVEL` importers **in the same commit** — no re-export shim in `schemas/character.ts`, which would contradict ADR-0005 and `packages/shared/src/schemas/MODULE.md:14-16`. Do **not** point the private declarations at `schemas/character.js`: `character.ts:12` value-imports from `./srd.js`, so the reverse is a runtime import cycle. Second commit: export `MIN_HP_GAIN` from `packages/shared/src/rules/character-rules.ts:197` and delete the copies at `packages/server/src/services/rest-service.ts:42` and `packages/client/src/components/sheet/level-up-helpers.tsx:33`. Third commit: repoint `packages/client/src/components/homebrew/spell/spell-form-data.ts:44,53,54` and `packages/client/src/components/homebrew/class/class-feature-list.tsx:15-16` at `@musi/shared/constants` (**extensionless** — `constants` is the one bare non-wildcard export key in `packages/shared/package.json`). | `grep -rn "^const M\(IN\|AX\)_LEVEL" packages/shared/src` returns 0, down from 5; `grep -rn "MIN_HP_GAIN = 1" packages/` returns 1, down from 3; `rg -n 'from "' packages/shared/src/constants.ts` still returns exactly one line (`import { z } from "zod";`) — any second match invalidates the leaf-module assumption this slice rests on | `bun run typecheck` then `bun run test -- packages/shared/src/schemas/character.test.ts packages/shared/src/rules/spellcasting.test.ts packages/server/src/services/rest-service.test.ts packages/client/src/components/sheet/level-up-helpers.test.tsx packages/client/src/components/homebrew/spell/spell-form-data.test.ts` and `bun run lint:import-cycles` |
| **K2** | **Landed** `7a4b10ac` | **One home for the d20 face value (XS, leaf 21 step 4).** Introduce a single shared constant (e.g. `D20_SIDES` in `packages/shared/src/constants.ts`, next to `MAX_D20_ROLL`) and have `packages/shared/src/rules/d20-roll.ts:13`, `packages/shared/src/rules/concentration-save.ts:7`, `packages/shared/src/rules/attack-roll.ts:10` and `packages/server/src/services/combat-actions/initiative.ts:7` use it. **Keep `MAX_D20_ROLL` exported** — it is a Zod upper bound at five call sites and must not churn — and **keep `NATURAL_CRIT` as a named default** even though its value now comes from the shared constant. Do **not** route `resolveConcentrationSave` through `resolveD20Roll`: its input has no `rollMode` and its result no `secondRoll`/`rollMode`, and the result is persisted verbatim into `combatLog` (`packages/server/src/utils/concentration-helpers.ts:134`). Do **not** merge the three `HALF_DIVISOR = 2` declarations — a numeric coincidence across three unrelated rules, one of them inside a named-geometry lint fence. | `grep -rn "const D20 = 20" packages/` returns 0, down from 3; `MAX_D20_ROLL` still exported with its five schema call sites unchanged; `NATURAL_CRIT` still exists as a name | `bun run test -- packages/shared/src/rules/d20-roll.test.ts packages/shared/src/rules/attack-roll.test.ts packages/shared/src/rules/concentration-save.test.ts packages/server/src/services/combat-actions/combat-actions-roll-initiative.test.ts` then `bun run typecheck` (note: `combat-actions/initiative.ts` has no colocated test; `combat-actions-roll-initiative.test.ts` is its cover) |
| **K3** | **Landed** `7a4b10ac` | **One ASI shape (S, leaf 21 step 5).** Move the `{ ability, amount }` object into a new `packages/shared/src/schemas/asi.ts` that both `schemas/character.ts` and `schemas/character-inputs.ts` import; delete both copies and the five-line cycle comment at `character.ts:221-225`. It **must** be a new module, not `constants.ts`: the shape needs `abilityAbbreviationSchema` from `./srd.js`, and `srd.ts:3` already imports `idField` from `../constants.js`. The `eslint-disable-next-line no-magic-numbers` comment must survive on the single copy, not be dropped. Add a test that a persisted `asiChoiceData` payload and a validated `asiIncreaseSchema` input parse the same values. | `grep -rn "z.literal(1), z.literal(2)" packages/shared/src` returns 1, down from 2; `character.ts:221-225`'s cycle comment is gone; one `eslint-disable-next-line no-magic-numbers` remains for the ASI amount | `bun run test -- packages/shared/src/schemas/character.test.ts packages/shared/src/schemas/character-inputs.test.ts` plus the new `asi.test.ts`, then `bun run lint:import-cycles` and `bun run typecheck` |
| **U1** | **Landed** `75bad57dc` | **Notification data as one order-independent object (XS, leaf 22 step 1).** Replace the union at `packages/shared/src/schemas/campaign.ts:43-47` with a single all-optional object and delete the ordering comment at `:37-42`. **Not parse-identical, and pin the difference first**: a `{ messageId }`-only row currently falls through to the `z.object({})` tail and parses to `{}`, whereas the all-optional object preserves `messageId`; and a row with a wrong-typed `campaignId` currently strips it to `{}` at the schema level, whereas the typed object rejects it and lands on `{}` only via the helper fallback. Add parse tests for `{ messageId }` alone, `{ campaignId, messageId }`, and a wrong-typed field **before** the swap, and assert through `notificationSchema` (the whole entity), not only the data schema — `notification.markRead` validates `.output(notificationSchema)` (`packages/server/src/routers/notification.ts:54-56`). **Keep `fromJsonValidated(..., {})` at `packages/server/src/utils/notification-helpers.ts:14` exactly as is.** | `packages/shared/src/schemas/campaign.ts` contains no notification `z.union` and no ordering comment; the three parse cases are pinned in `campaign.test.ts`, at least one of them through `notificationSchema`; `notification-helpers.ts:14` is byte-unchanged | `bun run test -- packages/shared/src/schemas/campaign.test.ts packages/server/src/routers/notification.test.ts packages/server/src/routers/notification-mutations.test.ts` |
| **U2** | **Landed** `75bad57dc` | **Level-choice read path degrades instead of throwing (S, leaf 22 step 5, first sub-step only).** `packages/server/src/utils/character-mapping.ts:106` calls `fromJsonValidated(lc.choiceData, choiceDataSchema)` with **no fallback**, and `packages/server/src/utils/prisma-json.ts:70-78` throws when none is supplied — so a non-object `choiceData` row fails the whole character load. Give that call an explicit degradation (a fallback value, or a quarantine path that keeps the rest of the character loading and surfaces the unparseable row), with tests that a row of an unknown object shape **and** a non-object row both survive the mapper **and** still satisfy `characterDetailSchema`, which `character.get` validates as `.output(...)` (`packages/server/src/routers/character.ts:42-49`) — a mapper-only test is not the proof (correction 7). **Do not touch `choiceDataSchema`.** Its `z.record(z.string(), z.unknown())` tail at `character.ts:272` is load-bearing precisely because this read path has no fallback. | `character-mapping.ts:106` passes a third argument or routes through a quarantine helper; two mapper tests (unknown object shape, non-object payload) pass and at least one asserts through `characterDetailSchema`; `choiceDataSchema` is byte-unchanged | `bun run test -- packages/server/src/utils/character-mapping.test.ts packages/server/src/utils/prisma-json.test.ts packages/server/src/routers/character.test.ts` |
| **U3** | **Closed-declined** | **No base-plus-extend refactor.** The four `campaignId`-only payloads — `campaign:join`, `campaign:leave`, `campaign:updated` and `presence:heartbeat` — are independent wire contracts in different directions that merely coincide in shape. Deriving them would contradict this plan's rule against making two representations identical merely because they are related. Because none has anything to extend, “derive” could only mean aliasing them to one Zod object identity. That would defeat `packages/server/src/socket/broadcast-registry.test.ts:112`'s `expect(entry.schema).toBe(campaignUpdatedSchema)` identity assertion and make a mis-wired event invisible to the typechecker. The realistic saving is about 8 lines of the current 188, not the 20–30 the proposed slice estimated. **All three pre-merge panelists endorsed the skip.** | Closed with the four exported schemas and inferred aliases intentionally independent; this is a decision, not remaining work | No command: no code change |
| **R1** | **Landed** `ec4d732c4` | **Rules-table provenance, edges, one deletion, one table fold (S, leaf 20 steps 1-3, corrected).** Commit 1: delete `isSubclassLevel` (`packages/shared/src/rules/character-rules.ts:189-191`) with its doc comment, the `describe` block at `character-rules.test.ts:244-256`, and the import at `:13`. Zero production callers; the `level-up-test-helper.ts:58` hit is an unrelated local variable. Commit 2: fold `formatCr` (`packages/shared/src/rules/xp.ts:68-70`) and `parseCr` (`:80-82`) onto one `[value, label]` pair list that both directions read; **keep `parseCr`'s `CR_TO_XP.has(num)` membership check and its `""`/`NaN` rejections exactly**. Rank it as readability — `packages/shared/src/rules/xp.property.test.ts:73-80` already round-trips every valid CR (correction 6). Commit 3, comments and tests only, no production change: add the provenance `docs/guides/change-rules-logic.md:21-23` requires above `PROFICIENCY_BONUS_TABLE` (`character-rules.ts:13`) — that one **is** an SRD table — and, above the three cantrip tables (`spellcasting.ts:252`, `:275`, `:298`), **name the non-SRD decision instead of inventing a citation**: they are keyed on `CasterType`, the file itself records at `:344-348` that the 2024 SRD class-specific counts differ, and `getCantripsKnown`'s one production caller is the unknown-class level-1 fallback (`:367-375`) (correction 5). Add the half-caster level-10 → 3 case as characterisation of that policy. **Pin the out-of-range answers nothing covers today — `proficiencyBonus(0)`, `(21)` and `(5.5)` all return `2`, and `getCantripsKnown` returns `0` for a non-integer level** — with a comment saying these pin *current behaviour*, not an adjudicated ruling about invalid levels. Assert through `proficiencyBonus`/`getCantripsKnown` only; do **not** export the tables and do **not** assert a row against `2 + Math.floor((level - 1) / 4)`. **Do not convert any table to a formula** — see [Trap 1](#the-two-traps-the-index-warns-about). | `grep -rn "isSubclassLevel" packages/shared/src` returns 0, down from 6 lines; `xp.ts` states each fractional CR once; `character-rules.test.ts` asserts `proficiencyBonus(21) === 2`; `spellcasting.test.ts` asserts a non-integer `classLevel` yields `0` cantrips; the cantrip tables carry a named non-SRD decision, not an SRD citation; commit 3 has no production diff | `bun run test -- packages/shared/src/rules/character-rules.test.ts packages/shared/src/rules/spellcasting.test.ts packages/shared/src/rules/xp.test.ts packages/shared/src/rules/xp.property.test.ts` |
| **R2** | **Landed** `ec4d732c4` | **Close the skill vocabulary (S, leaf 20 step 4).** Write `export const SKILL_ABILITY_MAP = { … } as const satisfies Record<string, AbilityAbbreviation>;` (`packages/shared/src/rules/character-rules.ts:36`) and *then* derive `export type SkillName = keyof typeof SKILL_ABILITY_MAP;`. The constraint must be `Record<string, …>`, **not** `Record<SkillName, …>` — the latter is circular and TS rejects it. `SKILL_NAMES` (`:57`) becomes `Object.keys(SKILL_ABILITY_MAP) as SkillName[]` with a `// type-assertion-boundary: interop - …` marker, or an explicit `readonly SkillName[]` literal with no cast. Replace the `"Perception"` literal at `:149` with a named `SkillName` constant. Delete the now-unreachable `?? "—"` / `?? "-"` fallbacks at `packages/client/src/components/sheet/skills-list.tsx:98` and `packages/client/src/components/vtt/drawer/tabs/stats-tab-rolls.tsx:244`. **Keep `skillModifier`'s `skillName: string` and its `return 0`** — but for the right reason: leaf 20's stated reason is false (correction 4; neither cited boundary calls `skillModifier`, and all three real callers pass canonical values). Keep it because `?? 0` is the same unknown-id contract the three sibling rules lookups use, and narrowing a `packages/shared` public export for three call sites is a boundary change, not a vocabulary tightening. Add `isSkillName` beside the map and rewrite `:119-120` as `if (!isSkillName(skillName)) return 0;`. Record in the commit message that narrowing to `SkillName` is now *available* and deliberately not taken. | `SkillName` exists with 18 members; `skillModifier` still takes `skillName: string`; the unknown-skill return is still `0`; the two client fallbacks are gone; at most one new `type-assertion-boundary: interop` marker, correctly categorised | `bun run test -- packages/shared/src/rules/character-rules.test.ts packages/client/src/components/sheet/skills-list.test.tsx` then `bun run typecheck` and `bun run lint` |
| **R3** | **Landed** `ec4d732c4` | **Un-fake the drawing constants (XS, leaf 20 step 5).** In `packages/shared/src/map/drawing.ts` write `export const DEFAULT_STROKE_WIDTH = 2;` (`:21`) and `export const MIN_FREEHAND_POINTS = 4;` (`:24`) as plain literals — **no `eslint-disable` wrapper**. `noMagicNumbersRuleOptions` (`eslint-config/rule-groups.js:32-37`) exempts literals initialising a `const` declarator, which is why `MAX_DRAWING_SHAPES = 500` and `MAX_STROKE_WIDTH = 20` sit unsuppressed in the same file; do **not** copy `grid-utils.ts`'s disable block, which exists for fraction *expressions*. Replace the two contradicting JSDoc lines at `:47-48` with one that states the real rule ("at least 2 points ⇒ 4 numbers"). | Neither constant is defined in terms of the other; the file gains no `eslint-disable`; `drawing.ts:47-48` carries one accurate JSDoc line; the numeric values are unchanged | `bun run test -- packages/shared/src/map/drawing.test.ts packages/client/src/hooks/canvas-input/use-canvas-input-drawing-template.test.ts` then `bun run lint` |
| **S1** | **Landed** `75bad57dc` | **Make `schemas/MODULE.md` true, and move the two misplaced entities (M, leaf 23 steps 1-3 + leaf 22 step 2 + leaf 26 step 6).** Commit 1: create `packages/shared/src/schemas/weapon-mastery.ts` holding `weaponMasteryPropertySchema`, `characterWeaponMasterySchema` and `CharacterWeaponMastery`; repoint the **eight** consumers — `schemas/character.ts`, `schemas/weapon-mastery-inputs.test.ts`, `packages/server/src/services/weapon-mastery-service.ts`, `packages/server/src/utils/character-mapping.ts` (the one leaf 23 omits, correction 9), `packages/client/src/components/sheet/equipment-summary.tsx`, `weapon-mastery-dialog.tsx` and its test, and `packages/client/src/test/fixtures-character.ts`. **Leave `listOutputSchema`/`setOutputSchema` in `weapon-mastery-inputs.ts:45-51`** — `MODULE.md` assigns request-side outputs to `-inputs.ts` files. Commit 2: move the notification entity (`notificationTypeSchema`, the data schemas, `notificationSchema`/`Notification`) out of `campaign.ts` into a new `packages/shared/src/schemas/notification.ts` and repoint the 14 importers; move `campaign.test.ts:32-51`'s enum assertions to a new `notification.test.ts`. Commit 3, doc only: correct the `weapon-mastery-inputs.ts` bullet; remove `invite.ts` from the "Entity-only files" list (it holds no entity); **record `spell.ts` and `auth.ts` as intentional inputs-holding entity files** the way `srd.ts` already is — do not extract `spell-inputs.ts` or `auth-inputs.ts`, and do **not** extract `srd-inputs.ts`; update the quick-map row for campaign/notification; and add the one line leaf 26 step 6 asks for, recording that `homebrew.ts:270-271`, `:299-300` and `magic-item.ts:69-70` are deliberately bare `z.string()` rather than `dateTimeField`. **Do not derive `MAX_MASTERY_SLOTS` from the rules table** — it is a request-validation bound and `MASTERY_SLOTS` is module-private. **Do not move `successResponseSchema`** (`MODULE.md:70-73`: cross-domain). | `packages/shared/src/schemas/weapon-mastery.ts` and `notification.ts` exist; `grep -n "invite.ts" packages/shared/src/schemas/MODULE.md` no longer places it under entity-only files; `spell.ts` and `auth.ts` each have a bullet naming their inline inputs; `campaign.ts` declares no notification symbol; `MODULE-INDEX.md` regenerated | `bun run test -- packages/shared/src/schemas/campaign.test.ts packages/shared/src/schemas/weapon-mastery-inputs.test.ts packages/server/src/routers/notification.test.ts packages/server/src/socket/broadcast-registry.test.ts packages/client/src/components/notifications/notification-item.test.tsx packages/client/src/components/sheet/weapon-mastery-dialog.test.tsx` then `bun run typecheck` and `bun run module:index:check` |
| **S2** | **Landed** `75bad57dc` | **`srdConditionSchema` → `conditionNameSchema` (XS, leaf 23 step 5).** Rename at `packages/shared/src/rules/conditions.ts:38` and its importers, restoring the `<thing>NameSchema` convention `damageTypeNameSchema` already follows. Keep its doc comment (the lowercase-canonical / display-capitalization warning) **verbatim**. Leave `packages/shared/src/schemas/srd-reference.ts:7 conditionSchema` — the SRD *row* — alone. **Do not collapse the two lookup mechanisms in `conditions.ts`** ([`00-index.md`](./00-index.md#constraints-on-future-proposals)): `isValidCondition` is a type predicate and needs the `.some()` form; `Map.has()` does not narrow. | `grep -rn "srdConditionSchema" packages/ e2e/` returns 0; `conditionSchema` in `srd-reference.ts` untouched; both lookup mechanisms in `conditions.ts` untouched; the doc comment is byte-identical | `bun run test -- packages/shared/src/rules/conditions.test.ts` then `bun run typecheck` |
| **S3** | **Landed** `75bad57dc` | **Derive `characterSummarySchema` (XS, leaf 23 step 6).** Replace `packages/shared/src/schemas/character.ts:317-333` with a `characterSchema.pick({…}).extend({ classes: … })` derivation over the nine copied fields. **This tightens a live tRPC output contract**: the hand-copied summary drops `characterSchema:98`'s `.min(MIN_LEVEL).max(MAX_LEVEL)` and `characterClassSchema:120`'s class-level bound, so a legacy row outside 1-20 would start failing serialization on `character.list` (`packages/server/src/routers/character.ts:67-75`). Write the level-25 rejection test first and land it as a deliberate tightening. **Precondition to state in the commit message:** `packages/server/src/services/level-up/core.ts:33` throws before any level-up when `character.level >= MAX_LEVEL`, and character creation starts at 1, so no application path can produce an out-of-range row. | `characterSummarySchema` re-declares no field name that `characterSchema` already declares; a level-25 row fails `listOutputSchema` under test; the commit message cites `core.ts:33` | `bun run test -- packages/shared/src/schemas/character.test.ts packages/server/src/routers/character.test.ts` then `bun run typecheck` |
| **E1** | **Landed** `75bad57dc` | **The two genuinely dead things in shared (XS, leaf 26 steps 2-3, cut down).** Commit 1: delete `ClassPreparedEntry` (`packages/shared/src/rules/spellcasting.ts:238`) and inline `PreparedSpellLimitInput[]` at `:240` — it has no reference outside its own file. Commit 2: rewrite `packages/server/src/services/combat-actions/turn-transaction.ts:76-80` as `{ ...FRESH_ACTION_ECONOMY, conditions: tickedConditions }`; it currently hand-writes the exact three-field reset that `packages/shared/src/rules/combat.ts:38-42` already exports. **Do not do leaf 26 step 1** (exporting `GridCell`/`TemplateParams`): the caller's object literal is already structurally checked against `TemplateParams`, the interface was renamed to `ComputeTemplateCellsInput`, and the client already has its own `GridCell` (correction 2). **Do not derive `ACTION_ECONOMY_CONFIG`'s `field` from shared** (correction 3): `ActionEconomyState` does not encode `action → actionUsed`, so this would mean inventing a new shared export to serve one client component. **`ACTION_ECONOMY_TYPES` is not deletable** — `ActionEconomyType` derives from it and is used by several client components. **Do not un-export or delete the five area-template shape functions** — `templateCells` dispatches to all five and `area-template-MODULE.md:65-68` names `area-template.test.ts` the single regression guard. | `grep -rn "ClassPreparedEntry" packages/` returns 0; `turn-transaction.ts` names `FRESH_ACTION_ECONOMY`; `packages/shared/src/map/area-template.ts` is byte-unchanged; `action-economy-indicators.tsx` is byte-unchanged | `bun run test -- packages/shared/src/rules/spellcasting.test.ts packages/server/src/services/combat-actions/combat-actions-advance-turn.test.ts` then `bun run typecheck` (note: `turn-transaction.ts` has no colocated test; `combat-actions-advance-turn.test.ts` is its cover) |
| **E2** | **Landed** `75bad57dc` | **`sortByInitiative` stops emulating a guarantee the runtime gives (S, leaf 26 steps 4-5).** Write the tie-order tests first — `packages/shared/src/rules/initiative.test.ts`'s existing tie cases are the gate — then sort a copy directly (`[...participants].sort(cmp)`) and `.map((p, sortOrder) => ({ ...p, sortOrder }))`, removing the `originalIndex` intermediate (`initiative.ts:23`), the `:40` fallback comparator, and both Stryker suppressions at `:33` and `:39`. **Check whether the `as unknown as` at `:46` actually goes away before claiming it** — the return type is declared explicitly, so what must pass is assignability of the generic spread; if TS still refuses, keep an assertion with an honest `// type-assertion-boundary: framework - <reason>` marker. Removing the suppressions shrinks `suppression-ledger.json`: regenerate with `bun scripts/suppression-ledger.ts --update` and commit it in the same diff, or the `suppression-ledger` verify slot fails. Treat this as a rules change (`docs/guides/change-rules-logic.md`) — it changes encounter turn order if it is wrong. | `initiative.ts` contains no `originalIndex` and no `Stryker disable`; every existing `initiative.test.ts` tie case passes unchanged; `suppression-ledger.json` regenerated in the same commit; the `:46` assertion is either gone or carries an accurate marker | `bun run test -- packages/shared/src/rules/initiative.test.ts` then `bun run typecheck`, `bun run lint:suppressions:ledger`, and spot-check with `bun run test:mutation -- --mutate packages/shared/src/rules/initiative.ts` before concluding no suppression is needed |

### Final delivery outcomes

The slice rows retain their original scope and acceptance criteria as the
scheduling record. Merge `75bad57dc` produced these review-relevant outcomes:

- **S1 needed three rounds to make `schemas/MODULE.md` true.** The first pass
  fixed the cited claims, post-implementation review found one more false
  statement, and the pre-merge panel found three more: schema files do own
  runtime constants; nine schema files lack colocated tests; and
  `weapon-mastery-inputs.ts` no longer belonged under files with no same-named
  partner after S1 created that partner. The final pass verified the whole
  document claim-by-claim. `MODULE-INDEX.md` needed no regeneration because no
  H1 or Concepts entry changed; `module:index:check` passed.
- **U1 and U2 deliberately changed behavior, red-first.** U1 now preserves a
  `{ messageId }`-only notification payload that the union erased, rejects a
  wrong-typed `campaignId` the union accepted, and salvages every independently
  valid known key at the read adapter. U2 degrades a non-object
  `LevelChoice.choiceData` row to `{}` instead of failing the whole character
  load; unknown objects still pass through unchanged.
- **S3 deliberately tightens `character.list`.** Derivation restored the
  character- and class-level `.min`/`.max` bounds. Prisma has no CHECK
  constraint, so a hand-written out-of-range row now fails serialization. The
  application writers remain within 1–20.
- **E1's whole-tree straggler sweep was clean**, and all three panelists
  independently confirmed it. The similar three-field object in
  `encounter-query.ts` remains because it is privacy redaction, not a turn-start
  reset.
- **E2 removed the original-index emulation, double assertion and two Stryker
  suppressions; mutation testing scored 100% (34 killed, 0 survived).** Review
  caught the rules obligation the implementation initially missed: SRD 5.2.1
  p.13 gives tie choice to the GM and players, while Musi uses modifier then
  caller order. The rule site, both unordered Prisma callers and policy-named
  tests now say so. Leaf 53 owns the unresolved product decision; E2 is closed.

### Post-landing class-semantics follow-on (not a slice)

I3's instruction to preserve, then separately decide, non-spellcaster semantics
was correct but not specific enough to act on. Re-verified against `ec4d732c4`
(`main` at this bookkeeping pass): a class id outside `SrdClassId` with
`classCasterType: "full"` exposes one concrete contradiction in character
creation. `getLevel1SpellSelection` falls back to three required cantrips
(`packages/shared/src/rules/spellcasting.ts:374-381`), so the Spell step remains
applicable (`packages/client/src/components/character-create/wizard-state.ts:125-133`);
the same id has no `SpellClassId`, so both spell-list queries are disabled and
the option lists are empty
(`packages/client/src/components/character-create/steps/spell-selection-step.tsx:114-136`);
then `canAdvanceSpells` requires exactly those three choices
(`wizard-validation.ts:46-51`). The user cannot satisfy the step.

**This is a latent extension-contract decision, not a new leaf today.**
`seedClasses` is the only live writer of `Class` rows, `SeedClass.id` is now
`SrdClassId`, no migration inserts a class, and `CharacterClass.classId` is an
FK. Only hand-written SQL can produce the contradictory row in a real
deployment. If a non-SRD `Class` writer or class-import feature is proposed,
that work must first choose one coherent contract: either supply a spell-list
identity and catalog for caster classes, or treat a class with no spell-list tag
as requiring no creation-time spell choices. Pin `visibleStepIndices`,
`SpellSelectionStep` and `computeCanAdvance` together for that choice. Do not
change the fallback speculatively while no producer exists.

### Dependency edges

The index recorded one edge in this cluster, `21 step 5 ↔ 22 step 5`; **under
this plan it disappeared**, and the index row was deleted when this plan's
reconciliation was applied. **No edge constrains open work because there is no
open work.** The historical edges are kept below as the record of why the
delivery was sequenced as it was.

- **`21 step 5 ↔ 22 step 5` is gone.** Codex is right that it was never semantic:
  leaf 22 could wrap `asiChoiceDataSchema` before or after the extraction. And
  this plan does not schedule the outer level-choice discriminator at all, so U2
  never touches `character.ts` — it edits `packages/server/src/utils/character-mapping.ts`.
  The ASI duplication is real (verified byte-for-byte, `schemas/character.ts:219-233`
  vs `schemas/character-inputs.ts:228-232`, same `eslint-disable` comment) and K3
  fixes it; nothing waits on it.
- **`I1 → I2 → I3` (hard).** I2 consumes I1's types; I3 consumes I1's mapping.
- **`W1 → W2` (soft).** W2's second commit narrows `WeaponData.damageType` in the
  same file W1 edits. Either order works; sequential avoids a rebase.
- **`K1 ↔ I2`, `K1 ↔ R1`, `R1 ↔ R2` (soft, file-level).** K1 deletes
  `MIN_LEVEL`/`MAX_LEVEL` from `rules/spellcasting.ts:74-75`; I2 retypes two tables
  in that file; R1 annotates the cantrip tables in it. K1, R1 and R2 all touch
  `rules/character-rules.ts`. Nothing is semantically blocked; do not run them
  concurrently.
- **`D1 → D2` (soft).** D2 is easier once the result types are single-sourced.
- **`S1 → S2`, `S1 → S3` (soft, file-level; satisfied).** S1 rewrote
  `schemas/MODULE.md` and neighbours in `character.ts`; all three landed in
  `75bad57dc`.
- **Leaf 22 step 2 is absorbed by S1**, so the "22 ↔ 23 layout overlap" both
  leaves note is gone: the move and the doc correction are one slice.
- **Everything else was parallel.** W1, A1, D1, K2, K3, U1, U2, R3, E1 and E2
  had no edges. U3 was independently declined.

### Index reconciliation (applied 2026-07-26)

**Done.** This list was written to be applied by whichever slice landed first;
in practice it slipped two slices and was applied as a separate bookkeeping pass
after slice D, alongside the slice-D landing record. It is kept here as the
record of what was changed and why, not as outstanding work — do not re-apply
it. One item changed shape on application: item 3's "add W1 as the new item 1"
was written as advice to a future implementer, and W1 had already landed by
then, so it is recorded in the past tense.

1. `00-index.md`, "How to use this pack": delete the shared dependency line
   (`21 step 5↔22 step 5` — dissolved) and point at this file.
2. `00-index.md`, [Leaves](./00-index.md#leaves): point the rows for 18, 19, 20,
   21, 22, 23, 25 and 26 at this plan and re-size them — 18 L→M, **19 L→S but
   re-ranked first in the cluster** (it is now one adapter fix plus riders), 20
   M→S, 22 M→S, 23 M→S, 26 M→XS.
3. `00-index.md`, "Suggested first slice": add **W1** as the new item 1. It is the
   only live user-visible defect in the whole pack and it is now an XS commit.
4. Each of the eight leaves: add a Status pointer to this plan and record which of
   its steps are dropped (19.1(b)'s SRD fallback, 19.3, 19.4, 19.7's
   `unarmoredAc(hasShield)` half, 20's formula conversion — permanently, 22.3,
   22.5's writer and union sub-steps, 23.4, 26.1, 26.3's action-economy half) and
   which are merged (22.2 → S1, 26.6 → one doc line in S1).
5. `00-index.md`, [Constraints on future proposals](./00-index.md#constraints-on-future-proposals):
   add three rows — "convert `PROFICIENCY_BONUS_TABLE` or the cantrip tables to a
   clamp-then-formula" (changes `proficiencyBonus(21)` from 2 to 6; the tables are
   the out-of-range guard); "rename `twoHandedDice` to `versatileDice` in any
   writer or persisted schema" (they are the storage and rules spellings of one
   concept with one declared adapter; Zod strips unknown keys and
   `buildWeaponData` rebuilds the payload); and "derive
   `ACTION_ECONOMY_CONFIG`'s `field` from `ActionEconomyState`" (the interface is
   three booleans and encodes no type→field relation).

## Persisted data and back-compat

**This is the section that overrides elegance.** Every schema below parses a
Prisma `Json` column. Zod strips unknown keys by default, so removing a key from
one of these is not a migration — it is a silent erasure at read time, and any
form that rebuilds its payload writes the erasure back to the database.

| Column | Read schema | Rule |
|---|---|---|
| `InventoryItem.properties` | `weaponPropertiesSchema` (`packages/shared/src/schemas/inventory.ts:33-46`) | **`twoHandedDice` is the storage spelling. Never remove it, and do not add a competing writer.** `enrichFromSrd` is the single declared adapter. |
| `Equipment.weaponData` | `equipmentWeaponDataSchema` (`packages/shared/src/schemas/srd.ts:281-291`) | Same. Removing the key blanks versatile dice on the whole SRD equipment browse until a re-seed. |
| `HomebrewEntry.data` | `homebrewWeaponDisplaySchema` (`packages/shared/src/schemas/homebrew.ts:323-334`) | Same. Homebrew persists Zod's *stripped* parse result, so an unmodelled key is gone on the next write. |
| `HomebrewEntry.data` (authoring) | *no schema* — `parseWeaponData`/`buildWeaponData` (`packages/client/src/components/homebrew/item/item-form-data.ts:126-138`, `:182-191`) | **This is Trap 2 and the reason leaf 19 steps 3-4 are not scheduled.** `buildWeaponData` rebuilds the whole payload from the form's own model; any key the form stops modelling is deleted on the next save. Nothing in this plan touches it. |
| `CharacterLevelChoice.choiceData` | `choiceDataSchema` (`packages/shared/src/schemas/character.ts`) | The `z.record(z.string(), z.unknown())` tail remains **load-bearing** for unknown object shapes. U2 added an explicit `{}` fallback for non-object rows, so one bad payload no longer fails the whole character load. The discriminated union remains dropped because a nested `{}` fallback still fails `.output(characterDetailSchema)` under a strict outer discriminator. |
| `Notification.data` | `notificationDataSchema` (`packages/shared/src/schemas/notification.ts:48-51`) | U1's schema is strict per known key and the read adapter at `packages/server/src/utils/notification-helpers.ts:19-26` salvages each independently valid key from a malformed object. This is strictly more preserving than the old union. It is still *not* an endpoint safety proof for a strict outer discriminator: `notification.markRead` validates `.output(notificationSchema)`, so a row the discriminator rejects whole would fail the endpoint. |
| `Spell.classes` | `SPELL_CLASS_IDS` (`packages/shared/src/schemas/spell.ts:41-50`) | **Do not normalise.** `packages/server/src/utils/spell-mapping.ts` parses these tags with no fallback, so a partial backfill breaks spell reads. The declared mapping (I1) buys the safety without touching the column. |
| `ChatMessage.metadata` | `rollResultSchema` (`packages/shared/src/schemas/dice-inputs.ts:37-42`) | The dice **result** types are persisted and read back on the client. D2 may not add a discriminator or drop `rolls`; a flat term keeps emitting `{ rolls: [], subtotal }`. |
| `CombatLog.rolls` (concentration) | `ConcentrationSaveResult` (`packages/shared/src/rules/concentration-save.ts:28-38`) | Persisted verbatim via `packages/server/src/utils/concentration-helpers.ts:134`. K2 must not route it through `resolveD20Roll` — that adds one input and two result fields to a persisted shape. |

Two further live contract surfaces that are not Json:

- **S3 tightens a tRPC output.** `characterSummarySchema` feeds `listOutputSchema`
  on `character.list`. Adopting `MIN_LEVEL`/`MAX_LEVEL` means a legacy row outside
  1-20 starts failing serialization. Prisma has no corresponding check; the
  guarantee that makes this safe is
  `packages/server/src/services/level-up/core.ts:33`, and the slice must cite it.
- **Whole-entity `.output(...)` schemas are the real back-compat boundary, not the
  mappers.** Both `character.get`/`create` and `notification.markRead` validate the
  complete entity after mapping. Any future proposal that justifies a schema
  tightening by pointing at a mapper fallback is wrong; it has to be proved
  through the endpoint output.

**No Prisma migration is called for anywhere in this plan**, and none is needed:
there is no migration for a Json payload key, so the adapter in W1 is permanent by
design, not transitional. If a backfill is ever attempted, follow
`docs/guides/add-prisma-migration.md`.

## Operational risks

- **W1 is the only slice with a user-visible bug behind it, and it is the easiest
  to over-build.** The temptation is to fix the schemas, the seed and the form in
  the same pass. Do not: W1 is a test, a `??`, and a comment, and it should be
  reviewable in a minute. Both consults independently warned that the rest of leaf
  19 is a migration wearing a bug fix's clothes.
- **W1's fix must not gain the third `??` term.** `?? srd?.versatileDice` looks
  free and is not (correction 1). If someone adds it, the existing
  `attack-damage.test.ts:394-409` case will still pass, because it does not assert
  `versatileDice` is absent. Consider adding that assertion in W1 so the wrong fix
  goes red.
- **W2's `damageType` narrowing is safe only because of an existing read seam** —
  the legacy title-case value is canonicalized at `attack-damage.ts:123` before the
  strict parse. Do not remove or reorder that call.
- **I2 goes red on a test that is deliberately pinning the fallback.**
  `spellcasting.test.ts:283-296` asserts `getMaxPreparedSpells({ classId: "wizard", … })`
  is `9`. That characterises the dual-key branch, not any production caller. Delete
  or rewrite it in the same commit and say so — do not "fix" it by keeping the
  fallback.
- **I2 must not touch a single SRD number**, and the
  `eslint-disable`/`enable no-magic-numbers` fences (`spellcasting.ts:63`, `:176`
  and neighbours, `sorcery-points.ts:13`) must survive verbatim.
- **K1's whole design rests on `constants.ts` being a leaf module.** Confirm
  `rg -n 'from "' packages/shared/src/constants.ts` returns exactly one line
  before landing. `code:intel dependents` cannot answer this — it reports what
  imports `constants.ts`, not what `constants.ts` imports
  (`docs/guides/code-intel.md`). The private redeclarations exist precisely where
  the obvious import would cycle (`srd.ts` ← `character.ts`), so **check the
  reverse direction before adding any import this plan did not enumerate**.
- **K1's client specifier is extensionless.** `@musi/shared/constants`, not
  `@musi/shared/constants.js` — `constants` is the one bare non-wildcard export
  key. Bun's resolver accepts the wrong form; a client typecheck does not, so
  verify there.
- **Do not unify `BYTES_PER_MB` with `MAP_IMAGE_BYTES_PER_MB`** while working in
  K1/K2. The values differ on purpose (decimal 10^6 vs binary 2^20), the comment
  says so, a prior closed pack already adjudicated it, and
  `packages/server/src/services/upload-service.test.ts:65-69` pins the result.
- **R1's third commit is comments and tests only.** If it produces a production
  diff, something has gone wrong — most likely someone converted a table to a
  formula. And it must not invent SRD citations for the cantrip tables
  (correction 5); naming a non-SRD decision is what the guide asks for there.
- **E2 changes encounter turn order if it is wrong.** It relies on documented
  ES2019 engine sort stability, which is why it is low- rather than zero-risk. The
  suppression-ledger regeneration is not optional: the `suppression-ledger` slot
  runs in pre-commit and `verify:changed` and locks in drained identities as well
  as new ones. This is **not** a lint-ratchet concern;
  `lint-ratchet.baseline.json` is untouched.
- **E2 also proved that “read the rules guide” is not an acceptance criterion.**
  The slice named the guide and still initially failed to classify its
  tie-breaks as Musi policy or give the tests policy-bearing names; a reviewer
  had to catch it. The index now makes that explicit provenance check standing
  work for every rules-facing slice in this pack.
- **A “make the doc true” slice owns the whole document.** S1 needed three
  rounds: implementation fixed the cited claims, post-implementation review
  found another false claim, and the pre-merge panel found three more. The final
  repair swept `schemas/MODULE.md` claim-by-claim and file-by-file. Checking only
  the triggering lines is not completion.
- **The whole-tree straggler criterion held.** E1's semantic duplicate sweep was
  clean, and all three panelists independently confirmed it. The criterion stays
  because it caught misses on the three preceding deliveries and imposed no
  false work here.
- **`knip` will not confirm E1.** `knip.config.ts:21-24` exempts
  `packages/shared/src/{schemas,rules,map}/**` from `exports` and `types` issues,
  so the `knip-unused-exports` verify slot neither prompts this cleanup nor proves
  it landed. The done criteria are greps, deliberately.
- **Several slices open `packages/shared/src/rules/character-rules.ts` and
  `spellcasting.ts`.** K1, I2, R1, R2 and W2 all do. Serialise them; the files are
  small and the diffs overlap.

## Rejected alternatives — why

| Rejected | Why |
|---|---|
| **Unifying `twoHandedDice` and `versatileDice` across the seed, three schemas, the Prisma comment and the homebrew form (leaf 19 steps 3-4)** | The decisive measurement: **there is no consumer of versatile dice outside the adapter.** Every production read goes through `getWeaponDataFromItem`/`computeWeaponAttack` (`resolve-attack.ts:77-79`, `equipment-summary.tsx:77,93,114`, `actions-tab-weapons.tsx:82,96`); the only other reader of `twoHandedDice` is the homebrew form round-tripping its own storage spelling. So the migration has no reader behind it, while every step of it is a persisted-JSON change where Zod strips unknown keys and `buildWeaponData` rebuilds the payload. Codex called this; cursor and my own first draft both over-built it. Two representations plus one declared adapter is a legitimate model. |
| **Extending `normalizeWeaponDataDamageType` to fold `twoHandedDice` at all five read seams (my own first draft)** | Cheaper than leaf 19 step 3 but still solving a problem nobody has. And the precedent does not transfer: that normalizer unifies a **legacy** title-case spelling with the canonical one for the same field, whereas `twoHandedDice` is the current, live spelling emitted by every writer. Unifying it is a migration; translating it is an adapter. |
| **`wp.versatileDice ?? wp.twoHandedDice ?? srd?.versatileDice` (leaf 19 steps 1(b) and 2)** | The third term attaches the SRD longsword's `1d10` versatile die to a custom weapon that merely shares the name. `packages/shared/src/rules/attack-damage.test.ts:394-409` pins a custom "Longsword" with `damageDice: "2d6"`, `damageType: "fire"` and no versatile property as an expressly supported case; the SRD fallback would make it an incoherent hybrid, and that test would not catch it. Items with unparseable properties still take the whole SRD row, which is the correct existing path. |
| **Giving `unarmoredAc` a `hasShield` parameter (leaf 19 step 7's second half)** | `calculateArmorClass` (`packages/shared/src/rules/armor-class.ts:71-89`) reads `hasShield` twice — once for the monk Unarmored Defense exception, once to add `SHIELD_AC_BONUS`. Moving one read into `unarmoredAc` splits one rule across two functions while the other read stays put. Both consults declined to schedule the armor half of leaf 19 at all; the naming half survives as A1. |
| **Building one authoritative SRD equipment catalog** | Forbidden by [`00-index.md`](./00-index.md#constraints-on-future-proposals) with reasons, and neither consult overturned it. A drift guard already exists (`packages/server/src/test/srd-weapon-sync.test.ts`), and both forms of consolidation contradict documented decisions. |
| **Converting `PROFICIENCY_BONUS_TABLE` or the cantrip tables to a clamp-then-formula** | This is Trap 1. The tables *are* the out-of-range guard: `proficiencyBonus(21)` is 2 today and 6 under the formula; `proficiencyBonus(5.5)` is 2 today and 3. `getCantripsKnown` has the same hole because its clamp does not integer-round. A faithful conversion would read "if `!Number.isInteger(level) \|\| level < 1 \|\| level > 20` return the default, else formula" — longer and less reviewable than the table, and `docs/guides/change-rules-logic.md:21-23` asks for the table anyway. |
| **Attributing an SRD 5.2.1 table to `FULL_/HALF_/THIRD_CASTER_CANTRIPS` (leaf 20 step 3)** | They are keyed on `CasterType`, a spell-slot classification, and `spellcasting.ts:344-348` records that the 2024 SRD class-specific cantrip counts differ — which is why character creation uses a separate per-class table. Warlock is deliberately `casterType: "none"`. An SRD citation here would be fictitious provenance, the exact failure the guide exists to prevent. Name the non-SRD decision instead. |
| **Narrowing `skillModifier`'s `skillName` to `SkillName`** | Codex is right that leaf 20's stated reason is false — neither cited boundary calls `skillModifier`, and all three real callers pass canonical values, so the narrowing is *feasible*. It is still declined here: `?? 0` for an unknown id is the same contract the three sibling rules lookups use (`?? 0`, `return []`, `?? null`), and narrowing a `packages/shared` public export is a boundary change rather than the vocabulary tightening R2 is doing. Recorded as available follow-on work with the evidence. |
| **Collapsing the two class-identity conventions into one union and normalising `Spell.classes`** | Different owners: one is a Prisma primary key, the other is an SRD-derived spell-list tag persisted inside a Json column and consumed by the seed. `packages/server/src/utils/spell-mapping.ts` parses those tags with no fallback, so a partial backfill breaks spell reads. Both consults agreed. |
| **Naming the prefixed type `ClassId` (leaf 18 step 1 as written)** | `Class.id` is a free-form `String @id` (`packages/server/prisma/schema.prisma:468-469`) and `CharacterClass.classId` is an FK to it; the union is a closed *SRD vocabulary*, not the type of the column. A type called `ClassId` invites the next reader to narrow a public signature to it, which is exactly what the leaf spends a paragraph forbidding. |
| **Two hand-written class-id maps (leaf 18 step 2 as written)** | Two hand-maintained tables of the same correspondence is the drift the leaf exists to remove. Write the total `Record<SpellClassId, SrdClassId>` and derive the partial reverse. |
| **Narrowing the public lookup signatures to the class-id union (leaf 18's explicitly-excluded option)** | Every caller holds a `string` read off `CharacterClass.classId`, a `z.string()` payload, or wizard/request state. Narrowing requires a parse boundary at all ten call sites plus a decision about what to do when the parse fails. The unknown-id fallbacks are the contract for ids these tables do not cover. |
| **Deciding, per site, what a non-spellcaster class id means (leaf 18 step 5 as written)** | Six behaviour decisions across `server` and `client` — two feeding a tRPC query argument, two gating a validation branch — bought for a compile-time gain in `shared`. I3 routes the sites through the mapping while preserving today's answers exactly. |
| **A discriminated `notificationSchema` (leaf 22 step 3)** | Its stated safety net — the `{}` mapper fallback at `notification-helpers.ts:14` — does not protect the endpoint: `notification.markRead` validates `.output(notificationSchema)` (`packages/server/src/routers/notification.ts:54-56`), so a legacy row degraded to `{}` under a strict outer discriminator still fails output validation. It also needs a decision about what three notification types carry and a tightening of `notification-service.ts:23`'s blanket-optional `data`, for a payload with two production creators and no consumer fighting the current type. |
| **A discriminated `choiceDataSchema` (leaf 22 step 5's third sub-step)** | Same defect in the mitigation: `character.get`/`create` validate `.output(characterDetailSchema)` (`packages/server/src/routers/character.ts:42-49`), so a nested `{}` fallback under a `choiceType`-discriminated union would still fail whole-entity output validation for a legacy `asi` row. `ChoiceData` is also referenced in exactly one file outside its definition, so nothing is fighting the un-narrowable type, and the history of that column has not been inventoried. U2 fixes the read path — worth landing alone — and the union is not scheduled. |
| **Domain-qualifying the ten `listOutputSchema`/`searchOutputSchema` exports (leaf 23 step 4)** | The leaf's own caveat rates it "readability, not defect prevention". Every consuming router imports exactly one by deep specifier, none aliases, there is no barrel, and no collision site exists. The price is 10 shared modules, 20 router lines, the codemod's name derivation, and 24 golden fixture directories compared verbatim by `scripts/codemods/trpc-shared-schema-codemod.test.ts`. If it is ever done, the codemod fix must land in the same commit or the names regrow. |
| **Extracting `spell-inputs.ts` and `auth-inputs.ts` (leaf 23 steps 2-3, first option)** | The leaf offers "document it as an exception, the way `srd.ts` already is" as an equally acceptable and much cheaper resolution, and the index establishes that shared's naming is already disciplined (124 pairs). The defect is that `schemas/MODULE.md` lists these files as entity-only while they hold ten inline inputs — a doc bug, fixed as one. Extracting `srd-inputs.ts` is separately forbidden: `MODULE.md:86-89`, `:95` and `:110` assign the SRD router contract to `srd.ts` three times over. |
| **Deriving `MAX_MASTERY_SLOTS` from `MASTERY_SLOTS`** | `weapon-mastery-inputs.ts:26` is a request-validation bound; `MASTERY_SLOTS` is module-private rules data. `Math.max(...Object.values(MASTERY_SLOTS))` couples input validation to the rules table, so a future class with more slots silently loosens the API bound. |
| **Exporting `GridCell`/`TemplateParams` and adopting them in the client (leaf 26 step 1)** | Both consults refuted it from different angles and both are right. The caller passes a full object literal to `templateCells({…})` (`packages/client/src/hooks/canvas-input/tool-handlers.ts:119-131`), which TypeScript already checks structurally — the leaf's "will silently stop matching" claim is false. The interface it names was renamed to `ComputeTemplateCellsInput` by leaf 11, and its `origin`/`direction` are the operation's inputs, not `originCell` + `directionAngle`. The client also already declares its own `GridCell` (`packages/client/src/stores/map-canvas-store.ts:73`, ~20 references), so the adoption would put two identically-named types in one package. The residual tidy — typing `ComputeTemplateCellsInput` with the *client's* `GridCell` — needs no shared export. |
| **Deriving `ACTION_ECONOMY_CONFIG`'s `field` from `ActionEconomyState` (leaf 26 step 3's second target)** | `ActionEconomyState` (`packages/shared/src/rules/combat.ts:31-35`) is three booleans and encodes no `action → actionUsed` relation. The client config supplies that relation plus a label and an icon per row. "Derive it from shared" would mean adding a **new** exported runtime map to `packages/shared` to serve one client component — the opposite of a leaf about trimming shared's surface. |
| **Exporting `AreaInput`, `LineInput` or `MapBounds` (leaf 26 step 1's neighbours)** | They appear in no signature any external caller uses; `MapBounds` appears in no exported signature at all. Exporting widens the public surface for callers that do not exist. The five shape functions stay exported because `area-template.test.ts` is their access path and `area-template-MODULE.md:65-68` names it the single regression guard. |
| **Deleting `magic-item.ts` / `homebrew.ts`'s `.toISOString()` calls as part of leaf 26 step 6** | It does not follow, and the leaf says so. Every mapper's declared return type is the schema's `z.infer` *output* type, so `createdAt` is `string` whichever validator the schema uses — `campaign.ts:67-68` uses `dateTimeField` and `routers/campaign.ts:92`,`:111` still convert by hand. Deleting them requires re-typing three mappers to `z.input<…>`, making them diverge from every other server mapper. |
| **Swapping `homebrew.ts`/`magic-item.ts`'s bare `z.string()` for `dateTimeField` (leaf 26 step 6, first option)** | Type-neutral downstream and deletes nothing — the leaf's own analysis. The cheaper half of the same decision is one line in `schemas/MODULE.md`, carried by S1. Note `schemas/note-inputs.ts:77` is **not** a bypass and must not be swept in: it is a keyset-pagination cursor inside a `.strict()` input schema where `z.iso.datetime()` is stricter and correct. |
| **Adding a `kind` discriminator to `DiceGroupResult`/`RollResult`, or dropping `rolls` for flat terms** | They are wire *and persisted* shapes: `rollResultSchema` validates roll metadata read back from `ChatMessage.metadata` and parsed on the client. Both consults flagged this independently and the leaf caveats it. |
| **Narrowing `ParsedNotation.notation` to required while deleting the `:55` fallback** | It would force `notation` onto all 21 direct `rollDice` fixtures for no behavioural gain, and remove a caller's ability to roll pre-built groups with no source notation. `./dice/*.js` is a declared subpath export, so the optionality is part of the public `rollDice` contract. Delete only the `:55` fallback; keep the `:43` spread. |
| **Deleting `dice-roller.test.ts:20-23` as an "impossible fixture"** | It is the suite's `1d20+5` assertion, expressed through a group the parser cannot emit. D2 must rewrite it as two terms; deleting it loses coverage with nothing going red. |
| **Routing `resolveConcentrationSave` through `resolveD20Roll` (leaf 21's tempting neighbour)** | Not a pure refactor: it adds one input field and two result fields to a shape persisted verbatim into `CombatLog` (`packages/server/src/utils/concentration-helpers.ts:114`, `:134`), with advantage/disadvantage semantics to decide. K2 is the safe half. |
| **Merging the three `HALF_DIVISOR = 2` declarations** | A numeric coincidence across three unrelated rules — halving damage on a successful save, deriving a concentration DC, and halving a template side length inside a named-geometry lint fence. Both consults independently made the general point: numeric coincidences are not shared concepts. |
| **Removing `WEAPON_MASTERY_MAP`'s `?? null`, collapsing `conditions.ts`'s two lookups, forcing `homebrew.ts`'s three hand-rolled schemas onto `.extend`, consolidating `combat-action.ts`'s result/response schemas** | All four are already adjudicated in [`00-index.md`](./00-index.md#constraints-on-future-proposals) with reasons that still hold on `313b6dfe`. Neither consult overturned any of them, and neither did I. They are restated in the slices that come nearest to each. |
