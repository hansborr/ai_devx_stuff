# 42. The character-creation reducer stores step data pre-flattened, forcing steps into mirrored local state, paired writes, and lossy two-way converters

Status: Not started
Theme: draft-state ownership · Area: client · Severity: medium · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`WizardState` in the character-creation wizard stores each step's *data* in the
shape the eventual mutation wants — flat scalars like `abilityMethod` +
`baseAbilityScores`, or a plain `abilityBoosts` array — while the steps that
edit that data work in richer models: an assignment map for the standard array,
a slot-and-mode form for background boosts, and seven independent personality
fields (six text fields plus visibility). (The state is not purely a submission shape — it also carries
navigation and editing-only helper fields, and `buildCreateInput` performs a
separate final transport projection — but the step data itself is stored
pre-flattened.)

Because the reducer only accepts whole-slice actions, the ability and
background steps keep local `useState` mirrors, pair local writes with reducer
dispatches, and reconstruct editing state from flattened reducer data.
Personality has no local mirror; instead every one-field edit rebuilds and
dispatches the full seven-field slice. Together these structures have three
recurring costs:

1. **Silent-revert hazard.** A single-field personality edit must restate all
   seven fields from render-time state; any handler that forgets a field, or
   dispatches from a stale closure, silently reverts unrelated user input.
   Correctness depends on every handler everywhere preserving fields it never
   meant to touch.
2. **Lossy round-trips.** The converters cannot fully reconstruct the editing
   model from the flattened form. The standard-array assignment map is
   re-inferred from scores on remount and misreads unassigned default-10
   abilities as assigned 10s; the background boost *mode* is guessed from the
   boost array and flips a partially-filled one-one-one selection back to
   two-one when the user navigates away and back.
3. **Recurring friction on a growth surface.** Every new species, class, or
   background option routes through these steps, so each addition re-pays the
   mirror/sync/convert tax and re-risks the bug class above.

## Evidence

- `packages/client/src/components/character-create/wizard-state.ts:9-58` —
  `WizardState` is one flat field bag: per-step data fields plus navigation
  (`currentStep`/`highestVisitedStep`, :10-11) and editing-only helpers
  (`speciesHasSubspecies` :16, `classCasterType` :22, `equipmentChoice` :38).
- `wizard-state.ts:91-100` — `SET_PERSONALITY` requires all seven personality
  fields; the handler at :312-322 overwrites all seven unconditionally.
- `packages/client/src/components/character-create/steps/personality-step.tsx:161-180`
  — `updatePersonality` rebuilds the full seven-field payload from render-time
  `state` and spreads a one-field patch over it, so every single-character
  keystroke dispatches all seven values.
- `packages/client/src/components/character-create/steps/ability-scores-step.tsx:36-37`
  — `method` and `scores` are mirrored into local `useState` from reducer
  state; the `sync` callback at :49-54 re-dispatches `SET_ABILITY_SCORES`, and
  all three handlers (`switchMethod` :67-72, `assignArrayValue` :74-83,
  `handleChangeScore` :85-89) pair a local `setX` with a `sync(dispatch)`.
- `ability-scores-step.tsx:38-47` — `arrayAssignments` exists *only* in local
  state and is re-inferred on mount from flattened scores via
  `STANDARD_ARRAY.includes`. `STANDARD_ARRAY` is `[15, 14, 13, 12, 10, 8]`
  (`steps/ability-score-card.tsx:28`) and unassigned abilities read 10
  (`next[ab] ?? 10`, ability-scores-step.tsx:79), so an *unassigned* ability
  left at the default 10 is reconstructed as an *assigned* 10 after remount —
  a concrete lossy-round-trip bug.
- `packages/client/src/components/character-create/steps/background-step.tsx:31-35`
  and `:45-70` — bidirectional converters `buildBoosts` /
  `boostStateFromAbilityBoosts`. The mode is not round-trippable: a
  one-one-one selection with a single +1 chosen falls through to the
  `EMPTY_BOOST_STATE` fallback at :69, whose mode is `"two-one"`, so the UI
  remounts in the wrong mode.
- `background-step.tsx:111-113` — local `boostState` seeded from reducer
  `state.abilityBoosts`; `setAndPersistBoostState` (:134-137) pairs
  `setBoostState` with a whole-slice `SET_BACKGROUND` dispatch, and five
  handlers (:150-172) all route through it.
- `packages/client/src/components/character-create/create-character-input.ts:64-92`
  — `buildCreateInput` is already the final transport projection (flattening
  boosts into six scores via `buildBoostedScores`, :34-50), so storing step
  data pre-flattened in the reducer buys nothing at submission time.
- `packages/client/src/components/character-create/wizard-validation.ts:30-43`
  — `canAdvanceAbilities` must re-derive standard-array validity by sorting
  the flattened scores against a second copy of the array values, because the
  assignment map the user actually edited was thrown away.
- `packages/client/src/components/character-create/wizard-state.test.ts` — 782
  lines pinning reducer behavior, including the cross-step invariants: class
  change rewinds progress and clears spell choices (`wizard-state.ts:229-255`,
  protecting the spell-count gate) and background change resets equipment
  (`wizard-state.ts:257-275`).

## Proposed direction

Restructure `WizardState` from one flat field bag into typed per-step draft
slices, each storing the step's authoritative *editing* model, with the
reducer as single owner and all flattening one-directional (derive at
validation/submission, never write back). Ordered plan:

1. **Reshape the state into draft slices.** In `wizard-state.ts`, introduce
   e.g. `state.abilities: { method, scores, arrayAssignments }`,
   `state.background: { backgroundId, boosts: BoostState }`,
   `state.personality: { name, traits, ideals, bonds, flaws, backstory,
   visibility }` — the editing model, not a flattened projection of it.
   Navigation state (`currentStep`/`highestVisitedStep`) keeps its current
   shape and handlers.
2. **Replace whole-slice actions with fine-grained events** —
   `SET_PERSONALITY_FIELD` with a keyed patch, `SET_BOOST_SLOT` /
   `SET_BOOST_MODE`, `SWITCH_ABILITY_METHOD` / `ASSIGN_ARRAY_VALUE` /
   `SET_SCORE` — so a handler never restates fields it did not change.
3. **Re-express the cross-step invariants against the slices, verbatim.**
   `SET_CLASS`'s spell-clear and progress-rewind (`wizard-state.ts:229-255`)
   and `SET_BACKGROUND`'s equipment reset (:257-275) must survive unchanged.
   Migrate the existing `wizard-state.test.ts` (782 lines) and per-step tests
   rather than rewriting them, so the gate semantics keep their regression
   coverage; run focused suites with `bun run test -- <file>` as you go.
4. **Delete the step-side scaffolding.** Ability scores and background drop
   their local `useState` mirrors, paired writes, and reconstruction logic
   (`boostStateFromAbilityBoosts` and the standard-array re-inference at
   `ability-scores-step.tsx:38-47`). Personality drops its full-slice
   reconstruction helper and dispatches fine-grained field events. The draft
   model eliminates both lossy round-trips by construction:
   `arrayAssignments` and `BoostState.mode` become stored state, not guesses.
5. **Make derivation one-way and shared.** `buildBoosts`- and
   `buildBoostedScores`-style flattening runs inside `buildCreateInput`
   (`create-character-input.ts`, already the final transport projection) and
   inside `wizard-validation.ts` validators as pure selectors over drafts —
   never written back into state. Validation and projection must share the
   same derive helpers, so an ambiguous draft cannot pass validation yet
   project differently at submission.
6. **Migrate the uncited steps mechanically.** Species, class, proficiencies,
   equipment, and spells already dispatch a single whole-slice action with no
   local mirror; their shape maps 1:1 onto a draft-set action with no behavior
   change.

Place the derive helpers beside `wizard-state.ts` /
`create-character-input.ts` with adjacent tests, keeping the business logic
out of the step components per AGENTS.md.

## Scope / caveats

- **Out of scope:** the shared `CreateCharacterInput` schema, the server
  contract, and any change to `buildCreateInput`'s *output*. This leaf
  reshapes only how the client wizard stores and edits drafts.
- **Biggest risk: silently dropping a cross-step invariant.** The class-change
  rewind exists to stop a non-caster-turned-caster from reaching Review with
  the Spell step empty, bypassing the spell-count gate. Reshaping state makes
  it easy to lose these guards; step 3's migrate-not-rewrite rule on
  `wizard-state.test.ts` is the mitigation, not optional polish.
- **Validation/projection divergence risk.** Validators currently read flat
  fields. If validation runs against the draft form while submission flattens
  it through different code, an ambiguous draft (e.g. a `BoostState` the old
  converter would have reconstructed differently) could validate yet project
  unexpectedly — hence step 5's shared-derive-helper requirement.
- **Prior work, no conflict:** the directly overlapping prior slice was
  CLIENT-CLUSTER-PLAN.md Q2, which extracted and tested `buildCreateInput` as
  the transport projection. Other prior character-creation slices changed
  separate rules behavior; none ruled on draft-state ownership. Keep
  `create-character-input.test.ts` green; its projected-output assertions
  should survive with only input-shape updates.
- There is no `MODULE.md` under `character-create/`, so no doc-refresh
  obligation attaches to this leaf.
- **Related leaves (no recorded ordering edge — avoid concurrent edits):**
  [004-character-creation-large-pseudo-module-loose.md](./004-character-creation-large-pseudo-module-loose.md)
  reorganizes the same directory at module level;
  [045-character-creation-ability-rules-have-four.md](./045-character-creation-ability-rules-have-four.md)
  deduplicates the ability-rule constants this leaf brushes against (e.g.
  `POINT_BUY_COSTS` in both `steps/ability-score-card.tsx` and
  `wizard-validation.ts:9-20`) — both leaves edit `wizard-validation.ts`;
  [056-wizard-contexttesttsx-stale-duplicate-wizard.md](./056-wizard-contexttesttsx-stale-duplicate-wizard.md)
  prunes `wizard-context.test.tsx`, which a state reshape also touches.
