# 61. Saving-throw proficiency identity mismatch drops proficiency bonuses in server-resolved combat

Status: **Done 2026-07-28** on branch `fix/saving-throw-proficiency-identity`,
commit `dd6b9f49f`. Filed as a record, not a plan: the fix landed with the leaf.
Theme: Ability-identity contract drift · Area: shared + server · Severity: high · Size: S

Source: reviewer observation, verified against `main` at `c104b310` by an
independent multi-angle analysis, then reproduced red-first at four seams ·
Confidence: high — every claim below was executed, not only read

**Evidence anchors are pinned to `c104b310` (`main` before the fix).**

## Problem

Class saving-throw proficiencies are canonically identified by three-letter
ability abbreviations, but two server consumers looked those rows up by full
ability name. Neither could match a normally derived character, so the
proficiency bonus was silently omitted from server-resolved saves.

The identity is a schema-level convention, not a seed spelling:
`classSchema.savingThrows` is typed `STR | DEX | CON | INT | WIS | CHA`
(`packages/shared/src/schemas/srd.ts:134`), all 12 SRD classes seed abbreviations
(`packages/server/src/seed/seed-srd-classes.ts:36-274`), the seeder writes those
arrays unchanged (`seed-srd-classes-and-features.ts:11-34`), and
`deriveProficiencies` copies each value verbatim into
`{ type: "savingThrow", name: st }`
(`packages/server/src/services/character-create-helpers.ts:23-24`). Nothing
normalizes in between: `CharacterProficiency.name` is an unconstrained string
with no ability relation (`packages/server/prisma/schema.prisma:965-976`, whose
`@@unique([characterId, type, name])` treats `"CON"` and `"Constitution"` as two
distinct rows), `mapCharacterDetail` returns `c.proficiencies` verbatim
(`packages/server/src/utils/character-mapping.ts:82`), and spell participant
loading includes the raw rows
(`packages/server/src/services/spell-casting/load-participants.ts:21-24`).

The two consumers:

- **Concentration.** `checkConcentrationOnDamage` queried Prisma for
  `{ type: "savingThrow", name: "Constitution" }`
  (`packages/server/src/utils/concentration-helpers.ts:68`) and passed
  `proficiencies.length > 0` as `isProficient`. A class-derived `"CON"` row never
  matched, so normally derived Barbarians, Fighters and Sorcerers lost their CON
  save bonus after **both** attack damage
  (`services/combat-actions/attack-transaction.ts:42-54`) and spell damage
  (`services/spell-casting/combat-transaction.ts:88`).
- **Spell saves — wider than first reported.** `characterSaveModifier` mapped the
  incoming abbreviation to a full name and compared by exact equality
  (`packages/server/src/services/spell-casting/resolve-character-spell.ts:72-85`).
  It backs `getTargetSaveModifier`, which serves both structured character-spell
  saves (`resolve-character-spell.ts:246`) and custom spell-save actions
  (`resolve-spell.ts:104`). So **every** class's two proficient saves were ignored
  for any character targeted by a server-resolved spell save, across all six
  abilities — not only concentration.

`saveModifier` adds the bonus only when its boolean is true
(`packages/shared/src/rules/character-rules.ts:138-147`), so affected totals came
in low by the level-scaled proficiency bonus: `+2` at levels 1–4 rising to `+6`
at 17–20. There is no natural-1/natural-20 exception on either save
(`rules/concentration-save.ts:40-52`, `rules/saving-throw.ts:68-74`), so the loss
is a straight 10–30 percentage-point drop in success probability wherever the
target number sits inside the d20's range. A damaging spell compounds it: an
under-bonused save can turn reduced damage into full damage, and the larger
damage then sets a higher concentration DC for a second under-bonused save.

Monster saving throws use a separate explicit-bonus path and were unaffected
(`resolve-character-spell.ts:93-97`). Manual sheet and VTT saves were already
correct — both client readers uppercase the stored name and compare against
`SAVE_ABILITIES` (`components/sheet/saving-throws.tsx:66`,
`components/vtt/drawer/tabs/stats-tab-rolls.tsx:117`) — so the sheet advertised a
bonus the server never applied.

### Two corrections to the original report

- **"The filter can never match" is too absolute.**
  `CreateCharacterInput.proficiencies[].name` is a free-form non-empty string
  (`packages/shared/src/schemas/character-inputs.ts:72-79`), so a client can
  persist `"Constitution"` today and it *would* have matched the buggy lookup.
  This is not merely a legacy-data hypothetical — it is a currently reachable
  write path, and it is the reason alias tolerance was chosen below.
- **Not "every character" for concentration.** Only characters who should have
  CON save proficiency: in the SRD seed, Barbarian, Fighter and Sorcerer. The
  spell-save miss is the one that spans all 12 classes.

## Why the tests did not catch it

No assertion required the buggy behaviour, but three test surfaces encoded the
non-production representation, and two of them are how the gap survived:

- `utils/concentration-helpers.test.ts:41-58` inserted a `"Constitution"` row —
  a spelling production never creates — and its save tests
  (`:260-321`) drove the RNG to its minimum and maximum, where no `+2…+6` bonus
  can change the outcome. The fixture also set `CharacterClass.level` to 5 while
  leaving `Character.level` at its default of 1; the concentration save reads the
  latter, so the fixture's stated level was not the level under test.
- `services/combat-actions/combat-actions.test.ts` created a `"Constitution"`
  proficiency "for the concentrating-character path" — the same masking, at the
  attack seam.
- `routers/encounter-combat-concentration.test.ts:51-53`'s
  `makeConcentrationSaveImpossible` deleted only `name: "Constitution"` rows.
  Against a real `"CON"` row that delete is a no-op; the test still passed only
  because CON 3 against DC 35 fails with or without proficiency.

Creation tests already asserted the canonical `"STR"`/`"CON"` rows
(`services/character-create-helpers.test.ts:47-63`), and sheet tests already
asserted the proficient modifier — so the contract was pinned on both sides of
the gap, and only the middle was unpinned.

## What landed

1. `normalizeAbilityIdentity` and `hasSavingThrowProficiency` were added to
   `packages/shared/src/rules/character-rules.ts`, **not** to a new
   `ability-identity.ts`. `docs/guides/change-rules-logic.md` step 2 prefers
   extending the closest helper, and that module already owns `SAVE_ABILITIES`,
   `ABILITY_FULL_NAMES` and `saveModifier`. Extending it also avoids a new
   import edge into `character-rules.ts` (see the cycle note at
   `character-rules.ts:166-174` for why that matters here).
2. Both server consumers now call `hasSavingThrowProficiency`. The concentration
   query selects every `savingThrow` row and filters by identity in code rather
   than pinning a spelling in SQL.
3. **Reads are alias-tolerant. Class-derived writes stay abbreviated; client
   writes are not constrained at all.** All six full ability names resolve to
   their abbreviation, case- and whitespace-insensitively. Note the asymmetry
   precisely: `deriveProficiencies` only ever writes abbreviations, but
   `CreateCharacterInput.proficiencies[].name` is a free-form
   `z.string().min(1)`, so any caller can still persist `"Constitution"` or
   `" con "` today. That reachable write path is the reason reads must tolerate
   aliases, and it is why "writes stay abbreviated" is true only of the derived
   path.
4. The seed and `deriveProficiencies` were left alone — class-derived rows are
   already canonical, so there is nothing to backfill.
5. The two masking fixtures now use the production spelling, and
   `makeConcentrationSaveImpossible` deletes every saving-throw row.

### Why alias tolerance rather than abbreviation-only

Tightening to abbreviations only would have bought a single representation at
the price of an audit, a backfill, and a dedup for any character carrying both
`"CON"` and `"Constitution"` — and it would not have held. The free-form
`name: z.string().min(1)` on the create input means new full-name rows can still
arrive the moment the backfill finishes, so abbreviation-only reads would
reintroduce the same silent bonus loss with a new cause. Tightening the *input
schema* is the change that would make abbreviation-only reads safe, and that is
a separate breaking-API decision.

Alias tolerance also narrows a real inconsistency rather than only deferring a
migration. Before this change the client readers uppercased before comparing, so
a stored `"Constitution"` row was proficient to the buggy server lookup but not
to the sheet, *and* a canonical `"CON"` row was proficient to the sheet but not
to the server. This branch closes the second, larger divergence — the one that
affects every normally-created character.

**It does not close the first, and the server and client do not yet agree on
both spellings.** `saving-throws.tsx` and `stats-tab-rolls.tsx` still build their
own uppercased `Set` with no trim and no alias table, so a `"Constitution"` or
`" CON "` row now grants the bonus on server-resolved saves while still
rendering as non-proficient on the sheet and in the VTT stats tab. That gap
predates this branch at identical severity and is narrower than the defect
fixed here, but it is open — see "Not done — deliberate" below and leaf 62.

The cost is stated plainly: two representations stay readable indefinitely, and
until the client adopts the shared helper, they are read differently on each
side.

## Not done — deliberate

- **Client adoption — filed as [leaf 62](./62-client-ability-identity-adoption.md).**
  `saving-throws.tsx` and `stats-tab-rolls.tsx` still build their own uppercased
  `Set`, with no `.trim()` and no alias table. They are correct for
  abbreviations, and the scope made this optional and separately committable.
  All four reviewers on this branch's merge panel independently recommended
  keeping it out of a combat-correctness fix.
- **Tightening `savingThrow` proficiency writes.** Constraining
  `CreateCharacterInput.proficiencies[].name` to `abilityAbbreviationSchema` when
  `type === "savingThrow"` is the change that would let reads drop alias
  tolerance. It owes an audit of persisted names and a dedup where more than one
  spelling exists on one character. Note the audit is wider than "the six full
  names": because reads normalize case and whitespace, `" con "` and
  `"constitution"` are equally reachable through the free-form input, and any
  two of them on one character collapse to a single identity on read while
  remaining distinct rows under `@@unique([characterId, type, name])`.

## Verify

Reproduced red-first at four seams on `c104b310`, all four green after the fix:

- `services/spell-casting/resolve-character-spell.test.ts` (new) — a level-5
  target with 14s across the board, so a proficient save is `+5` and a
  non-proficient one `+2`. All six abilities failed before the fix. A fixed
  natural 10 against DC 13 then separates the two at both resolver modes:
  structured (`characterSpell`) and custom (`customSpellSave`), each with a
  non-proficient control that must fail.
- `utils/concentration-helpers.test.ts` — 26 damage sets DC 13; natural 10 with
  the bonus is 15 and without it 12. Asserts the logged `conSaveModifier` and
  the resulting concentration state, plus an alias case proving `"CON"` and
  `"Constitution"` resolve alike.
- `services/combat-actions/combat-actions.test.ts` — concentration after attack
  damage, through `executeAttack`.
- `services/spell-casting/spell-casting.test.ts` — concentration after spell
  damage, through `runCastCombatSpellCore`, with the spell's own save DC set
  unreachably high so the assertion isolates the concentration save.
- `packages/shared/src/rules/character-rules.test.ts` — all six abilities in
  both spellings, whitespace and case, non-ability names, wrong-ability and
  wrong-`type` non-matches.

Existing sheet/VTT assertions were left untouched and still pass.
