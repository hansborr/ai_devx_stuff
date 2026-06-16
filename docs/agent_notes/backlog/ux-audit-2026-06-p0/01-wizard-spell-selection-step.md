# Wizard Spell Selection: Casters Must Leave Creation Able To Cast

Status: Done
Order: 01
Source: audit P0-1 (`docs/agent_notes/ux-audit-2026-06-06.md:47-60`).

## Notes (decision + implementation)

Decision: a dedicated **Spell-selection wizard step** (the audit's stronger
fix), gated on caster classes. Non-casters never see it.

- Contract (shared -> server -> client): `createCharacterInputSchema` grew an
  optional strict `spells: [{ spellId, source: "class" (default) }]` array
  (`packages/shared/src/schemas/character-inputs.ts`). Types derive from the
  Zod schema. Recorded in `docs/agent_notes/decisions-schemas.md`.
- Rules: `getLevel1SpellSelection(classId, casterType)` returns the per-class
  level-1 cantrip + spell counts (wizard 3/6, bard 2/4, sorcerer 4/2,
  cleric 3/4, druid 2/4, paladin/ranger 0/2, warlock 2/2), in
  `packages/shared/src/rules/spellcasting.ts`.
- Server: `validateCreateSpells` + `buildSpellCreates`
  (`packages/server/src/services/character-create-spells.ts`) validate
  caster-only, level 0/1, class availability, counts, and no duplicates
  (BAD_REQUEST / NOT_FOUND), and persist chosen spells (all `prepared: true`)
  in the same create transaction (`routers/character.ts`).
- Client: new `classCasterType` + `cantripChoices`/`level1SpellChoices` wizard
  state, `SET_SPELLS` action, a `spell` step in `WIZARD_STEPS` rendered only
  for casters (`visibleStepIndices`/`isStepApplicable` drive nav + stepper),
  the `SpellSelectionStep`, and a Review-step `SpellsReviewCard`.
- Cantrips and the level-1 picks are marked prepared so a new caster can cast
  immediately and the sheet no longer reads "No spells known".

### Follow-up fix (warlock caster gate)

Reviewer found a client/server contract mismatch: warlock seeds
`casterType: "none"` (Pact Magic) with `spellcastingAbility: "CHA"`. The shared
`getLevel1SpellSelection("class-warlock", "none")` returns `{cantrips:2,
spells:2}` from the per-class table (ignoring `casterType`), so the client
showed the spell step and required the picks — but `validateCreateSpells` gated
solely on `casterType === "none"` and rejected the submission with BAD_REQUEST.
Fix: `validateCreateSpells` now treats a class as a caster when it has a
non-null `spellcastingAbility` or a non-empty `getLevel1SpellSelection` result,
mirroring the rule the client uses. Non-casters (fighter: no ability, 0/0) are
still rejected. Added warlock service tests
(`character-create-spells.test.ts`) and a warlock create end-to-end test
(`routers/character.test.ts`).

### Follow-up fix (codex review — three P2 defects)

A codex review of the freshly-written spell-selection code flagged three real
[P2] defects, all fixed (TDD):

1. **Server: non-class spell sources bypassed the class-list check.** The shared
   schema accepts `source` of `"item"/"feat"/"species"`, but
   `validateCreateSpells` skipped the class-availability check for non-`"class"`
   sources, letting a caster launder an out-of-class cantrip (e.g. a wizard
   submitting a druid-only cantrip as `"item"`). Creation spells are class picks,
   so non-`"class"` sources are now rejected with BAD_REQUEST
   (`packages/server/src/services/character-create-spells.ts`,
   `assertSpellInClassList`). Tests added in `character-create-spells.test.ts`.
2. **Client: Review reachable with empty Spell step after class switch.** A
   non-caster who walked to Review, jumped back to Class, and switched to a
   caster kept `highestVisitedStep` at Review while the now-visible Spell step
   was empty — Review always validated true, so Create bypassed the spell-count
   gate. `handleClass` now rewinds `highestVisitedStep`/`currentStep` to the
   Class step whenever the class changes (matching the existing spell-choice
   reset), so Review isn't reachable until the now-required Spell step is
   satisfied (`wizard-state.ts`). Tests added in `wizard-state.test.ts`.
3. **e2e: concentration spell locator missed the badge.** Selecting a
   concentration spell like "Dancing Lights" with `{ exact: true }` failed
   because the button's accessible name is "Dancing Lights C" (concentration
   badge). `character-wizard.po.ts` now matches with an anchored regex
   `^name( C)?$` (rejects prefix collisions) instead of exact text.

## Context

The 8-step creation wizard has no spell/cantrip selection step. The Class
step's own copy promises "three Wizard cantrips of your choice" and "six
level 1 Wizard spells", but no step asks; a finished Lv-1 wizard lands on
a sheet reading "No spells known" with nothing to cast and no signal that
anything is missing.

Verified surfaces (2026-06-12):

- Step registry: `WIZARD_STEPS` and `TOTAL_STEPS` in
  `packages/client/src/components/character-create/wizard-state.ts:92-103`;
  per-step validators in `STEP_VALIDATORS` (same file, ~:279-292).
- Step components: `packages/client/src/components/character-create/steps/`.
- Submit path: `buildCreateInput` and the `trpc.character.create` mutation
  in `packages/client/src/pages/character-create-page.tsx:81-132`.
- Server: `create` in `packages/server/src/routers/character.ts:44-82`,
  delegating to `services/character-create.ts` (validate + build + level-1
  features + starting inventory in one transaction).
- The post-hoc "+ Add" spell dialog on the sheet already works; the audit
  calls out the missing mandatory discovery, not the dialog.

## Scope

- Decide the mechanism (audit allows either): a spell-selection wizard
  step for caster classes, or auto-populating class cantrips plus a
  default spellbook with sheet-side editing. A step is the stronger fix;
  auto-grant of the cantrip count is the floor. Record the decision and
  rationale in this leaf's Notes (and `decisions-schemas.md` if the
  contract changes).
- Schema first (shared -> server -> client): extend the create-character
  input contract in `packages/shared` with the spell choices, derive
  types from the Zod schema, validate counts server-side against class
  rules (a non-caster submitting spells is a contract violation).
- Persist chosen spells in the same create transaction; the Review step
  and the finished sheet must show them.
- Gate the step (or auto-grant) on caster classes only; non-caster flow
  must be unchanged.
- TDD throughout: rules logic near the rules engine, service tests beside
  `character-create`, wizard step tests beside the step, and an e2e
  extension through `character-wizard.po.ts` (born clean per the e2e
  selector rules — coordinate with lint pack leaf 03d).

## Definition Of Done

A new Lv-1 wizard built through the UI finishes creation with the class's
promised cantrips and spells visible on the Review step and the sheet; a
non-caster sees no spell step; server rejects out-of-contract spell
payloads with a consistent tRPC error code.

## Verification

- `bun run e2e -- e2e/character-create.spec.ts e2e/wizard-validation.spec.ts`
  (extended for the caster path).
- Unit/integration tests for input validation and persistence.
- Manual repro from the audit: rebuild "Mithrandir" (Human Wizard, Sage)
  and confirm the sheet shows spells.
- `bun run verify:changed`.
