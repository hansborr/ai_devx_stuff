# 58. Character creation writes six prepared level-1 spells for a wizard whose cap is four

Status: **Done 2026-07-30** on branch
`fix/cq-58-59-prepared-spell-writes`, commits `dba7a6190` and review follow-up
`f7f50f719`. Creation now validates and builds nested spell writes in one pass,
calls the canonical prepared-spell rule directly, keeps cantrips prepared, and
treats submitted order as Musi policy for which level-1 choices are prepared
first. The wizard's fifth and sixth choices remain known but unprepared;
existing over-cap characters were not backfilled, as scoped below.
Theme: A rules invariant enforced on one writer and not the other · Area: shared + server · Severity: medium · Size: S

Source: server-cluster review round, 2026-07-27 (surfaced while narrowing
`docs/CONCURRENCY.md`'s prepared-cap claim on `feat/cq-server-cluster`, which
names creation as the counterexample but does not track it) · Confidence: high —
**verified by execution**, not by reading

**Evidence in this leaf is pinned to `f16079c2f` (`main`), not the pack's
`883d48bf`.** None of the files cited below differ between `main` and
`feat/cq-server-cluster`, so the anchors hold on both.

## Problem

Character creation marks every spell the player chooses as prepared, and never
looks at the prepared-spell cap. For a level-1 wizard the two numbers do not
agree:

- `getLevel1SpellSelection("class-wizard", "full")` returns
  `{ cantrips: 3, spells: 6 }` — a wizard chooses six level-1 spells at
  creation.
- `buildSpellCreates` writes `prepared: true` on **every** chosen row, cantrip
  or not.
- `getMaxPreparedSpells` for a level-1 wizard returns `4`.

So a freshly-created wizard is persisted two spells over its own limit, on the
very first write, with no concurrency involved. **This is a rules defect, not a
concurrency one:** creation performs no cap check at all, so there is nothing for
a transaction, an isolation level, a CAS or a delegate gate to protect. The
invariant is enforced on exactly one of the column's two writers.

The two numbers are not in conflict by accident — they are the SRD's *spellbook*
and *prepared* counts. A level-1 wizard knows six level-1 spells and prepares
four of them. The schema already models that distinction (`CharacterSpell` has a
`prepared` boolean alongside `source`), and the post-creation writer already
honours it: `characterSpell.add` stores `prepared: spell.level === 0`, so a
level-1 spell added from the sheet defaults to *not* prepared. One column, two
writers, opposite defaults. Creation is the one that is wrong.

**Wizard is the only class this bites**, which is why it has gone unnoticed:
bard, cleric and druid select 4 against a cap of 4, and paladin, ranger,
sorcerer and warlock select 2 against a cap of 2. Every other caster lands
exactly at its cap; the wizard's spellbook is the only selection that exceeds
what the class can prepare.

## Verified by execution

The claim above was proved by running the real creation path, not by reading it.
A throwaway vitest case drove `createCharacter` (the service, not a mock)
against the test database with a wizard input of 3 cantrips + 6 level-1 spells,
then counted the persisted rows:

```
selection { cantrips: 3, spells: 6 }   cap 4
preparedLevel1 6                       cap 4
```

`expect(preparedLevel1).toBeLessThanOrEqual(cap)` failed with
`expected 6 to be less than or equal to 4`. The count query was the same
predicate the toggle path uses — `{ prepared: true, spell: { level: { gt: 0 } } }`
— so cantrips are excluded and the six are all level-1. **The test was deleted
after the run;** re-create it as step 1 of the fix rather than looking for it in
the tree.

## Evidence

- `packages/server/src/services/character-create-spells.ts:175-184` —
  `buildSpellCreates`, which maps each choice to
  `{ spell: { connect: ... }, source, prepared: true }`. The `prepared: true` at
  `:182` is unconditional; the function does not receive a cap and takes no
  branch on spell level.
- `:170-174` — the function's own doc comment states the intent: "Both cantrips
  and the chosen level-1 spells are marked prepared so a freshly-created caster
  can cast immediately." The defect is a deliberate decision that was never
  reconciled with the cap, not an oversight in the code.
- `:135` — creation's only use of the spellcasting rules is
  `getLevel1SpellSelection(input.classId, casterType)`.
- `:158-167` — the only two limit checks creation makes:
  `counts.cantrips > limits.cantrips` and `counts.level1 > limits.spells`. Both
  bound the *selection*; neither bounds the prepared count. There is no third
  check.
- `packages/shared/src/rules/spellcasting.ts:363` — `"class-wizard":
  { cantrips: 3, spells: 6 }` in `LEVEL_1_SPELL_SELECTION_BY_CLASS`.
- `:173-175` — `WIZARD_PREPARED` begins `4`, and `getMaxPreparedSpells`
  (`:228-233`) returns the table value at `:229-230` before the formula branch
  is reached, so `abilityMod` does not raise it.
- `:157-159`, `:161-163`, `:165-167`, `:169-171` — the other prepared tables,
  all of which start at the same value as their class's level-1 selection.
- `packages/server/src/services/character-create.ts:225` and `:228` — the creates
  are attached to the nested `character.create` payload
  (`data.spells = { create: spellCreates }`) and committed inside the creation
  transaction at `:231`. Nothing between build and commit inspects them.
- **The cap function has exactly one non-test consumer in the server package,
  and it is not creation.** On `main`,
  `packages/server/src/routers/character-spell.ts:6` and `:56`
  (`calcMaxPrepared` → `getMulticlassMaxPreparedSpells`); on
  `feat/cq-server-cluster` the same single consumer, moved to
  `packages/server/src/utils/prepared-spell-toggle.ts:38` and `:132`. Either
  way the creation path never calls it.
- Contrasting writer: `packages/server/src/routers/character-spell.ts:123`
  (`main`) — `characterSpell.add` writes `prepared: spell.level === 0`.
- `packages/server/prisma/schema.prisma:1003-1017` — `CharacterSpell` carries
  `prepared` and `source`, so known-but-unprepared is already representable; no
  schema change is needed to fix this.
- `docs/CONCURRENCY.md` on `feat/cq-server-cluster` (§"Serializable isolation
  exception", the paragraph beginning "What this establishes, precisely") names
  this exact case as the reason the prepared-cap guarantee is stated per-path
  rather than globally: "Character creation already breaks that one without any
  concurrency". **That text does not exist on `main`** — it arrives with this
  branch — and it explicitly defers the fix as "a rules change, tracked
  separately". This leaf is that tracking.

## Proposed direction

A hypothesis, not a spec. This is a rules-facing change, so read
`docs/guides/change-rules-logic.md` first and classify the provenance of every
number the fix touches (SRD rule, named outside source, or Musi policy) — the
index records that as an acceptance criterion for rules slices, not a
suggestion.

1. **Re-create the red test from "Verified by execution" as the first commit.**
   It goes through `createCharacter` and asserts the persisted prepared count
   against `getMaxPreparedSpells`, so it fails for the right reason and keeps
   failing if a later change re-introduces the conflation. Put it beside
   `packages/server/src/services/character-create-spells.test.ts`.
2. **Answer the rules question before writing the fix, because it is the whole
   substance of this leaf: what is a level-1 wizard's fifth and sixth spell?**
   Three answers fit and they are not equivalent:
   - **Known but not prepared.** Write the six rows with `prepared: false` for
     level-1 spells and `true` for cantrips, matching what `characterSpell.add`
     already does, and let the player prepare four from the sheet. Smallest
     change, correct by SRD, and it makes a new wizard arrive with nothing
     prepared — which is a real UX regression the doc comment at `:170-174` was
     deliberately avoiding.
   - **Prepare up to the cap.** Mark the first `cap` level-1 choices prepared
     and the rest known. Preserves the "can cast immediately" intent, but
     "first" is an arbitrary Musi policy over an unordered selection and must be
     named as one in the test.
   - **Ask at creation.** Add a prepared-selection step to the creation wizard.
     Correct and explicit, and the only answer with a client half; it takes this
     leaf out of `S`.
3. **Enforce the cap in the creation writer, not only in the selection
   validator.** Whichever answer wins, `buildSpellCreates` (or its caller) must
   consult the same helper the toggle path uses rather than re-deriving a limit,
   so the two writers cannot drift again. At creation the character is always
   single-class level 1, so a single `getMaxPreparedSpells` entry suffices — but
   route it through the shared helper anyway.
4. **Update `docs/CONCURRENCY.md` when it closes.** The paragraph cited above
   exists specifically to stop readers citing the toggle guarantee as a global
   one. Once creation checks the cap, that caveat becomes wrong in the other
   direction and must be re-narrowed, not merely deleted.

## Scope / caveats

- **This is not a concurrency defect and must not be fixed as one.** No locking
  discipline, transaction, isolation level or gated delegate closes it: there is
  no check to serialise. `docs/CONCURRENCY.md` on this branch already spells that
  out, including why a per-character advisory lock would cost the canonical
  acquisition order in §"Cross-table invariants" and buy nothing here. A commit
  that adds a lock and claims to fix the cap is the failure mode to watch for.
- **Do not "fix" it by raising the cap.** `WIZARD_PREPARED` is transcribed SRD
  table data under an explicit `no-magic-numbers` disable, and
  `docs/guides/change-rules-logic.md:21-23` mandates the table form for exactly
  these. The selection count of 6 is equally SRD. Both numbers are right; the
  conflation between them is the bug.
- **Every other caster lands exactly at its cap, so the fix must not make them
  under-prepared.** A blunt "prepare nothing above level 0" changes bard,
  cleric, druid, paladin, ranger, sorcerer and warlock from correctly-prepared to
  entirely-unprepared. Whatever shape is chosen, pin the per-class level-1
  outcome for all eight caster classes, not just wizard.
- **Characters created before the fix keep six prepared rows.** Deciding whether
  to backfill, and what a backfill would choose to unprepare, is an open
  question this leaf does not answer — the same unanswered-backfill shape as
  leaf 55. Do not let it block the forward fix.
- **The client creation wizard reads the same selection helper**
  (`packages/client/src/components/character-create/wizard-state.ts:126` calls
  `getLevel1SpellSelection`). A fix that only changes the `prepared` flag has no
  client half; a fix that changes *what is selected*, or that adds a
  prepared-choice step, does.
- **Cantrips are correctly prepared and must stay that way.** They are always
  prepared by rule (`characterSpell.togglePrepared` rejects them outright), and
  the cap predicate excludes them (`spell: { level: { gt: 0 } }`). Do not widen
  the fix over cantrips.
- Sequencing: independent of leaf 51, which fixed the *toggle* path's race and
  changes nothing here. `character-create-spells.ts` is owned by no other leaf
  in this pack. Leaf 07's spell-casting reshaping touches neighbouring types but
  has no edge to this check.
