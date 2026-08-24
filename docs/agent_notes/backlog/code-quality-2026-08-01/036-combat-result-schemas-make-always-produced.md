# 36. Combat result schemas declare `rollMode` optional even though every producer always emits it

Status: Not started
Theme: schema/producer contract alignment · Area: shared · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The two combat result schemas mark `rollMode` optional, but nothing in the
system ever produces a result without it. Every result flows through
`resolveD20Roll`, whose return type *requires* `RollMode` and populates it on
every branch, and both the attack and saving-throw producers propagate it
verbatim into the result object. The Zod-inferred types are therefore weaker
than the values that actually exist: any consumer of `AttackRollResult`,
`SpellAttackResult` or `SavingThrowResult` sees `rollMode?: RollMode` and must
write an `undefined` branch for a state no flow produces. The schemas' own test
suites reinforce the false contract — the base fixtures omit `rollMode`
entirely and tests labelled "backward compatible" pin the omission as accepted
— even though no persisted payload is ever re-parsed through these schemas
(combat-log rows are re-read through an intentionally opaque record). The cost
today is small — no production consumer reads result `rollMode` yet — but the
first one that does will inherit a phantom optionality and the defensive code
that comes with it.

## Evidence

- `packages/shared/src/schemas/attack-roll-inputs.ts:123` —
  `rollMode: rollModeSchema.optional()` in `attackResolutionResultSchema`
  (`:117-152`); `secondRoll` at `:121` is the legitimately optional field.
  `attackRollResultSchema` (`:154`) and `spellAttackResultSchema`
  (`spell-action-inputs.ts:119`) both extend it, so one optionality flows into
  three result surfaces.
- `packages/shared/src/schemas/spell-action-inputs.ts:137` —
  `rollMode: rollModeSchema.optional()` in `savingThrowResultSchema`
  (`:131-154`); `secondSaveRoll` at `:136` is the legitimately optional field.
- `packages/shared/src/rules/d20-roll.ts:5-12` — `D20RollResult` requires
  `rollMode: RollMode`; both return branches (`:18`, `:27`) populate it.
- `packages/shared/src/rules/attack-roll.ts:56,90` — `resolveAttackRoll` calls
  `resolveD20Roll` and returns `rollMode: d20.rollMode`. All attack producers
  route through it: `packages/server/src/services/combat-actions/resolve-attack.ts:105,135`,
  `packages/server/src/services/spell-casting/resolve-character-spell.ts:199`,
  `packages/server/src/services/spell-casting/resolve-spell.ts:80`.
- `packages/shared/src/rules/saving-throw.ts:57-62,101,133` —
  `rollSavingThrowCheck` returns `rollMode: d20.rollMode`, and
  `resolveSavingThrowFromCheck` carries it into every `SavingThrowResult`; the
  intermediate `SavingThrowCheck` type already requires it (`:39`). Both save
  producers route through these (`resolve-character-spell.ts:247-257`,
  `resolve-spell.ts:133`).
- Parse surfaces are live-response only: the schemas back tRPC `.output()` at
  `packages/server/src/routers/encounter-combat.ts:49,54`. Persisted combat-log
  `rolls` JSON (`packages/server/src/services/combat-actions/attack-transaction.ts:65`,
  `packages/server/src/services/spell-casting/combat-transaction.ts:187`) is
  re-read through the deliberately opaque
  `rolls: z.record(z.string(), z.unknown())` at
  `packages/shared/src/schemas/encounter.ts:146`, never through these schemas.
- The suites pin the loose contract: `attack-roll-inputs.test.ts:481-498` —
  `validResult` omits `rollMode`; `:549` "accepts result without secondRoll
  (backward compatible)" parses that fixture, so it also pins the `rollMode`
  omission. Same pattern at `spell-action-inputs.test.ts:305` (spell attack)
  and `:349` (saving throw, fixture at `:311-330`).
- Zero production consumers read result `rollMode` today: a search across
  `packages/client/src` (excluding tests/fixtures) finds only input-side uses
  (`use-weapon-attack.ts:101`, `use-confirm-cast.ts:113`,
  `use-monster-attack.ts:83`, all sending `rollMode: "normal"`).

## Proposed direction

Per the agreed disposition: **make `rollMode` required in
`attackResolutionResultSchema` (`attack-roll-inputs.ts`) and
`savingThrowResultSchema` (`spell-action-inputs.ts`) after first confirming no
persisted combat-log payloads or non-canonical producers omit it, keeping
`secondRoll`/`secondSaveRoll` optional.**

Mechanics:

1. The producer half of the confirmation is done above: all production attack and saving-throw result paths eventually route through `resolveD20Roll`. The persisted half is structurally
   moot — no parse path feeds stored `rolls` JSON back through these schemas
   (`encounter.ts:146` keeps it opaque) — but re-run both greps at
   implementation time in case a parse site appeared since the pin.
2. TDD: first retarget the three "backward compatible" tests
   (`attack-roll-inputs.test.ts:549`, `spell-action-inputs.test.ts:305,349`) to
   omit only the second-roll field, add `rollMode` to the base fixtures
   (`attack-roll-inputs.test.ts:481-498`, `spell-action-inputs.test.ts:311-330`
   and the spell-attack fixture), and add rejects-missing-`rollMode` cases.
3. Then drop `.optional()` at `attack-roll-inputs.ts:123` and
   `spell-action-inputs.ts:137`. `bun run test -- packages/shared/src/schemas/attack-roll-inputs.test.ts`
   and `bun run test -- packages/shared/src/schemas/spell-action-inputs.test.ts`
   cover the schema side; typecheck surfaces any fixture or consumer that
   constructed a result without `rollMode`.

## Scope / caveats

- **Second-roll fields stay optional.** `secondRoll`/`secondSaveRoll` are
  genuinely absent on normal-mode rolls (`d20-roll.ts:18`); only `rollMode` is
  always produced.
- **Input schemas are untouched.** `rollMode: rollModeSchema.default("normal")`
  on the input side (`attack-roll-inputs.ts:73,100`) already yields a required
  field after parse; this leaf is result-side only.
- **Do not extend the tightening to concentration saves.**
  `ConcentrationSaveResult` has no `rollMode`/`secondRoll` by design; the live
  2026-07-25 pack
  ([21-shared-constants-single-source.md](../code-quality-2026-07-25/21-shared-constants-single-source.md),
  Scope) rules that routing `resolveConcentrationSave` through `resolveD20Roll`
  is a behaviour-widening change needing its own ticket — that ruling stands.
- **Future per-action tightening of persisted `rolls` is out of scope.** The
  comment at `encounter.ts:140-145` anticipates tightening the opaque record
  per action someday; whoever does that must treat `rollMode` as optional for
  historic rows written before the field existed — this leaf's guarantee covers
  live producer output, not old database rows.
- Read `packages/shared/src/schemas/MODULE.md` before editing; this is a
  schema-contract change, not rules logic, so `docs/guides/change-rules-logic.md`
  does not apply.
- Related, no ordering dependency:
  [061-rollmodetoggle-complete-production-orphan.md](./061-rollmodetoggle-complete-production-orphan.md)
  removes the orphaned input-side `RollModeToggle`; distinct problem, and
  neither leaf edits the other's files.
