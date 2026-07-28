# 20. Shared rules state simple relationships in forms nothing can check: unprovenanced 20-row tables, mirrored if-chains, an open-typed skill vocabulary, and fake arithmetic derivations

Status: **Done 2026-07-27** in [SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md)
slices **R1, R2 and R3**, merge `ec4d732c4`; see
[Landed](./00-index.md#landed). The plan superseded and shrank this leaf (M→S);
read its outcome rather than the `## Proposed direction` below. The headline
remains permanently dropped: do not convert the tables to formulas.
Theme: Relationships written in unverifiable forms · Area: shared · Severity: low · Size: M

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

Several places in `packages/shared/src` write down a relationship in the least
legible available form, so nothing checks that the written-down version matches
the rule it encodes. The maintenance cost is uniform: a reader has to scan rows or
mirrored branches to recover a rule that fits on one line, and a future edit can
desynchronise the halves with no compiler or test signal.

- **Step tables with no recorded source.** `PROFICIENCY_BONUS_TABLE`
  (`rules/character-rules.ts:13`) is 20 hand-written rows of exactly
  `2 + floor((level - 1) / 4)`. `FULL_CASTER_CANTRIPS` / `HALF_CASTER_CANTRIPS` /
  `THIRD_CASTER_CANTRIPS` (`rules/spellcasting.ts:252`, `:275`, `:298`) are 60 more
  rows — three 20-row tables — carrying three distinct values each. None of the four
  carries the provenance comment `docs/guides/change-rules-logic.md:21-23` requires,
  so a reader cannot tell which SRD table a row transcribes or whether a value is
  SRD text or app policy. The row *values* are largely covered already
  (`character-rules.test.ts:48-78` walks levels 1-20 through `proficiencyBonus`;
  `spellcasting.test.ts:573-615` pins eight caster step points), but the half-caster
  level-10 step is untested and none of the out-of-range answers these tables
  silently produce is pinned anywhere. The table shape itself is the *correct* form
  here — the guide explicitly asks for SRD tables to be transcribed as reviewable
  constants rather than hidden in arithmetic — so the defect is the missing
  provenance and the unpinned edges, not the table.
- **Mirrored if-chains instead of one table.** `formatCr` (`rules/xp.ts:68-70`) and
  `parseCr` (`:80-82`) hand-write the three fractional CRs in opposite directions.
  The mirroring is invisible to the compiler, and the file already demonstrates the
  better idiom one screen up: `CR_TO_XP` (`:15`), which `parseCr:85` itself reuses
  as a membership check.
- **A closed vocabulary typed open.** `SKILL_ABILITY_MAP`
  (`rules/character-rules.ts:36`) is 18 literal skill keys typed
  `Record<string, AbilityAbbreviation>`. `SKILL_NAMES = Object.keys(...)` (`:57`)
  therefore widens to `string[]`, `skillModifier`'s option is `skillName: string`
  (`:111`), the lookup needs an `if (ability === undefined) return 0` guard (`:120`)
  that silently scores a typo'd skill as 0, `"Perception"` is a bare magic string at
  `:149`, and both client consumers pay for the widening with unreachable fallbacks.
- **Arithmetic that pretends to be a derivation.** `map/drawing.ts:21` defines
  `DEFAULT_STROKE_WIDTH = MIN_STROKE_WIDTH + 1` and `:24` defines
  `MIN_FREEHAND_POINTS = DEFAULT_STROKE_WIDTH + DEFAULT_STROKE_WIDTH`. A geometric
  minimum (4 numbers = 2 x,y pairs) is expressed as twice a *pixel stroke width*,
  so raising the default stroke width would silently change how many points a
  freehand stroke needs. The doubled, self-contradicting JSDoc at `:47-48` ("Flat
  array of [x, y, x, y, ...]" then "Min 2 numbers (one x,y pair)" over a minimum of
  4) is the visible symptom.
- **Dead code with a name that suggests a rule.** `isSubclassLevel`
  (`rules/character-rules.ts:189-191`) is `return classLevel === subclassLevel;`
  exported with a doc comment and a three-assertion test block, and has zero call
  sites.

## Evidence

- `packages/shared/src/rules/character-rules.ts:13` — `PROFICIENCY_BONUS_TABLE: Record<number, number>`, 20 rows, values 2/3/4/5/6; module-private, no `export`.
- `packages/shared/src/rules/character-rules.ts:81` — `return PROFICIENCY_BONUS_TABLE[level] ?? DEFAULT_PROFICIENCY_BONUS;` — the table doubles as the out-of-range guard: level 0 or 21 yields 2, not a formula result.
- `packages/shared/src/rules/character-rules.test.ts:48-78` — `describe("proficiencyBonus")` loops 1-4, 5-8, 9-12, 13-16, 17-20 and asserts 2/3/4/5/6, so every row is already checked through the public helper. No case covers a level outside 1-20 or a non-integer level.
- `packages/shared/src/rules/spellcasting.ts:252,275,298` — the three cantrip tables, 20 rows each; `:324` clamps with `Math.min(Math.max(classLevel, MIN_LEVEL), MAX_LEVEL)`; `:326-328` still apply `?? 0` after the clamp (the clamp does not integer-round, so a fractional `classLevel` still misses the table and yields 0).
- `packages/shared/src/rules/spellcasting.test.ts:573-615` — `describe("getCantripsKnown")` pins full 1→3, 4→4, 10→5; half 1→0, 2→2; third 2→0, 3→2, 10→3; plus `"none"`→0. The half-caster level-10 step (→3) and every out-of-range level are unpinned.
- `docs/guides/change-rules-logic.md:21-23` — "Transcribe rules tables as reviewable constants near the helper that owns them. Add a short provenance comment with the SRD section, table, or explicit non-SRD source"; `:31-33` — "Prefer scenario tables for SRD table rows, edge cases, and regression examples. Assertions should prove observable rule results, not mirror a private implementation formula." None of the four tables above carries the required provenance comment.
- `packages/shared/src/rules/xp.ts:9-11` — `CR_ONE_EIGHTH` / `CR_ONE_QUARTER` / `CR_ONE_HALF`; `:68-70` — `formatCr`'s three `if`s; `:80-82` — `parseCr`'s mirrored three; `:15` — `CR_TO_XP` map; `:85` — `CR_TO_XP.has(num)`.
- `packages/shared/src/rules/character-rules.ts:36` — `Record<string, AbilityAbbreviation>` over 18 literal keys; `:57` — `SKILL_NAMES = Object.keys(SKILL_ABILITY_MAP)`; `:111` — `skillName: string`; `:119-120` — lookup plus `if (ability === undefined) return 0;`; `:149` — `skillName: "Perception"` as a bare string inside `passivePerception`.
- `tsconfig.base.json:3` — `"strict": true`; `:16` — `"noUncheckedIndexedAccess": true`. Both bear on step 4: once the map is a closed object type, indexing it with a `string` is a `noImplicitAny` error, while indexing it with a key of the union adds no `undefined`.
- `packages/client/src/components/sheet/skills-list.tsx:87,98` — maps over `SKILL_NAMES`, then `SKILL_ABILITY_MAP[name] ?? "—"`; `packages/client/src/components/vtt/drawer/tabs/stats-tab-rolls.tsx:234,244` — same shape with `?? "-"`. Both fallbacks become unreachable once the map is closed.
- Boundary where skill names really are free strings: `packages/client/src/pages/sheet-helpers.ts:26-29` matches DB proficiency rows by `p.name === "Perception"`, and `packages/client/src/components/vtt/drawer/monster-stat-block-profile.tsx:94-101` remaps lowercased SRD monster skill keys back onto `SKILL_NAMES`.
- `packages/shared/src/rules/character-rules.ts:189-191` — `isSubclassLevel`; its only references are `packages/shared/src/rules/character-rules.test.ts:13` (import) and `:244-256` (three assertions). `packages/server/src/services/level-up/level-up-test-helper.ts:58` declares an unrelated *local variable* of the same name and does not import the shared function.
- `packages/shared/src/map/drawing.ts:21,24` — the two fake derivations; `:47-48` — the contradictory double JSDoc over `points: z.array(z.number()).min(MIN_FREEHAND_POINTS)`; `:8` (`MAX_DRAWING_SHAPES = 500`) and `:18` (`MAX_STROKE_WIDTH = 20`) — plain literals in the same file with no lint suppression.
- `eslint-config/rule-groups.js:32-37` — `noMagicNumbersRuleOptions` (`ignore: [0, 1, -1]`, `enforceConst: true`), severity `warn` at `:39`: the rule does not report a literal that initialises a `const` declarator.
- `packages/client/src/hooks/canvas-input/use-canvas-input-drawing-template.test.ts:136` — `// Only the start point (2 entries) — below MIN_FREEHAND_POINTS (4)`; a test comment is currently the clearest statement of the constant's meaning.

## Proposed direction

Each numbered step is one commit. Read `docs/guides/change-rules-logic.md` before
steps 1-3 — it is what decides steps 2 and 3, not just background. Every step must
be behaviour-preserving, so write the characterisation test first where one does
not already exist. Step 3 adds only comments and tests; it changes no production
code.

1. **Delete `isSubclassLevel`.** Remove `character-rules.ts:189-191` (with its doc
   comment) and the `describe("isSubclassLevel")` block at
   `character-rules.test.ts:244-256` plus the import at `:13`. There are no call
   sites to inline it into — this is a deletion, not a refactor.
2. **Fold `formatCr`/`parseCr` onto one table** in `packages/shared/src/rules/xp.ts`:
   a single `[value, label]` pair list (or a `Map` plus its inverse) that both
   directions read. `formatCr` and `parseCr` each shrink to a lookup plus their
   existing fallbacks; keep `parseCr`'s `CR_TO_XP.has(num)` membership check and its
   `""`/`NaN` rejections exactly as they are.
3. **Provenance the step tables and pin their edges.** Do **not** convert
   `PROFICIENCY_BONUS_TABLE` or the three cantrip tables into formulas — that
   fights `docs/guides/change-rules-logic.md:21-23` ("transcribe rules tables as
   reviewable constants … add a short provenance comment") and, for
   `proficiencyBonus`, it silently changes behaviour (see the first caveat). The
   row values are already covered by the existing suites; what is missing is
   attribution and the edges:
   - Add the provenance comment the guide asks for above each of the four tables
     (SRD 5.2.1 section/table for the proficiency-bonus column and the per-caster
     cantrips-known columns). Where a value is not in the SRD, say so and name the
     decision, per guide step 1.
   - Add the one missing cantrip step point to `spellcasting.test.ts` — half caster
     at level 10 → 3. Full and third casters are already pinned at all three of
     their steps.
   - Pin the out-of-range answers, which nothing currently covers:
     `proficiencyBonus(0)`, `(21)` and `(5.5)` all return `2` today (table miss →
     `DEFAULT_PROFICIENCY_BONUS`), and `getCantripsKnown` returns `0` for a
     non-integer `classLevel` even after its clamp at `spellcasting.ts:324`. These
     are the behaviours any future refactor has to preserve, and guide step 6 asks
     for min/max-level boundaries to be named cases rather than left implicit.
   - Assert through `proficiencyBonus` and `getCantripsKnown` only. Do not export
     `PROFICIENCY_BONUS_TABLE` or the cantrip tables to read a row directly, and do
     not assert a row against `2 + Math.floor((level - 1) / 4)`:
     `docs/guides/change-rules-logic.md:31-33` requires assertions that "prove
     observable rule results, not mirror a private implementation formula", and
     exporting the tables would hand callers a second, unguarded way to read
     proficiency bonuses.
4. **Close the skill vocabulary.** Write
   `export const SKILL_ABILITY_MAP = { … } as const satisfies Record<string, AbilityAbbreviation>;`
   and *then* derive `export type SkillName = keyof typeof SKILL_ABILITY_MAP;`.
   The constraint must be `Record<string, …>`, not `Record<SkillName, …>`: the
   latter is circular (`SkillName` is defined from `typeof SKILL_ABILITY_MAP`,
   whose type cannot be inferred until the `satisfies` clause resolves) and TS
   rejects it with "referenced directly or indirectly in its own initializer".
   Then:
   - `SKILL_NAMES` becomes `Object.keys(SKILL_ABILITY_MAP) as SkillName[]` with a
     `// type-assertion-boundary: interop - Object.keys widens to string[]; the keys are the SkillName union by construction`
     marker (exactly the `interop` category AGENTS.md names), or an explicitly
     written `readonly SkillName[]` literal if you would rather have no cast at all.
   - `skillModifier` keeps `skillName: string` (see the second caveat), so the
     lookup at `character-rules.ts:119` has to narrow rather than index a closed
     object type with a `string` — that is a `noImplicitAny` error, not a widening.
     Add a predicate beside the map,
     `export function isSkillName(value: string): value is SkillName { return Object.hasOwn(SKILL_ABILITY_MAP, value); }`,
     and rewrite `:119-120` as `if (!isSkillName(skillName)) return 0;` followed by
     the lookup. The boundary check moves from an `undefined` compare to the
     predicate; the returned `0` for an unknown skill is unchanged.
   - Replace the `"Perception"` literal at `:149` with a named constant of type
     `SkillName`.
   - Delete the now-unreachable `?? "—"` / `?? "-"` fallbacks at
     `skills-list.tsx:98` and `stats-tab-rolls.tsx:244` — both sites index the map
     with a value that comes straight out of `SKILL_NAMES`, so once the map is
     closed the lookup is total (`noUncheckedIndexedAccess` does not add
     `undefined` for a literal key type).
5. **Un-fake the drawing constants.** In `packages/shared/src/map/drawing.ts` write
   `export const DEFAULT_STROKE_WIDTH = 2;` and
   `export const MIN_FREEHAND_POINTS = 4;` as plain literals — **no
   `eslint-disable` wrapper** — and replace the two conflicting JSDoc lines at
   `:47-48` with one that states the real rule ("at least 2 points ⇒ 4 numbers").

## Scope / caveats

- **Do not replace these tables with clamp-then-formula.** The lookup tables are
  also the out-of-range guards, and clamping does not reproduce them.
  `proficiencyBonus(21)` returns `2` today (table miss → `DEFAULT_PROFICIENCY_BONUS`,
  `character-rules.ts:81`) while clamp-then-formula returns `6`; `proficiencyBonus(5.5)`
  is `2` today and `3` under the formula. `getCantripsKnown` has the identical hole,
  because its clamp at `spellcasting.ts:324` passes a non-integer straight through
  to a table miss and `?? 0`. A faithful conversion would have to read "if
  `!Number.isInteger(level) || level < 1 || level > 20` return the default, else
  formula" — longer and less reviewable than the table it replaces.
- **Do not narrow `skillModifier`'s `skillName` parameter to `SkillName`.** Skill
  names genuinely arrive as free strings at two boundaries (DB proficiency rows via
  `sheet-helpers.ts:26-29`, lowercased SRD monster keys via
  `monster-stat-block-profile.tsx:94-101`). Narrow the *table* and `SKILL_NAMES`,
  and keep the boundary check at `character-rules.ts:119-120` — as the `isSkillName`
  predicate from step 4, which is what makes the lookup compile once the map's key
  type is closed.
- **The `drawing.ts` derivation is not dodging a lint rule.** The obvious reading —
  "these are chained to satisfy `no-magic-numbers`" — is wrong, and acting on it
  would produce an unnecessary `eslint-disable` block. `noMagicNumbersRuleOptions`
  (`eslint-config/rule-groups.js:32-37`) exempts literals that initialise a `const`
  declarator, which is why `MAX_DRAWING_SHAPES = 500` and `MAX_STROKE_WIDTH = 20`
  sit unsuppressed in the same file. Plain literals are the whole fix; no
  `docs/guides/lint-ratchet.md` interaction is expected. (`grid-utils.ts` needs its
  disable block for fraction *expressions*, not for plain consts — do not copy that
  pattern here.)
- **Do not try to deduplicate the three roll-description formatters.**
  `formatAttackDescription` (`rules/attack-roll.ts:138-152`, 4 branches),
  `formatSavingThrowDescription` (`rules/saving-throw.ts:164-187`, 3 branches), and
  the inline concentration formatter (`rules/concentration-save.ts:54-57`) are three
  different sentence skeletons. Their shared fragments — `… save … vs DC …`
  (`saving-throw.ts:178`, `concentration-save.ts:57`) and `… ${damageType} damage`
  (`attack-roll.ts:146,149`, `saving-throw.ts:181,186`) — are too small to factor
  without a 7-10 field options object that reads worse than three explicit
  templates. The one defensible move is *colocation*: pull the vocabulary into a
  single `packages/shared/src/rules/roll-description.ts` so
  `rules/MODULE.md:11-13`'s "this package owns rules calculations only" stays
  honest. That belongs in its own leaf — these strings persist into
  `CombatLog.description`, so exact-string pinning tests must land first.
- Step 4 touches two client components; no cache or socket surface is involved, so
  `docs/guides/add-client-feature-module-cache-socket.md` does not apply.
- Leaves 19 and 21 also edit `packages/shared/src/rules/character-rules.ts`, and
  leaf 21 step 1 additionally rewrites the `MIN_LEVEL`/`MAX_LEVEL` declarations at
  `rules/spellcasting.ts:74-75` — the same file this leaf's step 3 annotates and
  tests. No ordering dependency in either direction, but do not run them
  concurrently against those two files. In particular, leaf 19 requires the comment
  block at `character-rules.ts:157-165` to survive — it sits ~30 lines above
  `isSubclassLevel`, so do not sweep it up as part of the same deletion.
