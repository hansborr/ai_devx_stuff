# 26. shared's exported surface has drifted from its consumers, and one helper re-implements a guarantee the runtime already gives

Status: **Done 2026-07-27** in
[SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md) slices **E1 and E2**, plus
the S1 documentation rider, merge `75bad57dc`; see
[Landed](./00-index.md#landed). The plan superseded and cut this leaf to
roughly a third (M→XS); read its outcome rather than the
`## Proposed direction` below. Read `knip.config.ts` first: it blanket-exempts
`packages/shared/src/{schemas,rules,map}/**` from unused-`exports` and `types`
reporting, so "unused export" here is a *policy consequence*, not automatically
a finding, and no gate confirms a cleanup landed. **Dropped: step 1** (exporting
`GridCell`/`TemplateParams` — the caller's object literal was already
structurally checked, the interface was renamed `ComputeTemplateCellsInput`,
and the client has its own `GridCell`) and **step 3's action-economy half**
(`ActionEconomyState` encodes no type→field relation; see the
[Constraints](./00-index.md#constraints-on-future-proposals) row).
**Merged: step 6 into one line of `schemas/MODULE.md` in slice S1.** E1 and E2
landed the honest remainder. Do **not** un-export or delete the five
area-template shape functions, and `ACTION_ECONOMY_TYPES` is not deletable.
Theme: shared surface hygiene · Area: shared · Severity: low · Size: M

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

`packages/shared` is the contract package: everything downstream reads its
exports to know what the domain is. Five small spots have drifted away from that
job, in three directions.

**The export list does not match what callers need.** `area-template.ts` exports
`templateCells` and `cellAngle` — the two functions the client actually calls —
but the types in their signatures, `GridCell` and `TemplateParams`, are declared
without `export`. The one production caller therefore declares its own
`ComputeAndSetInput` interface and hands `templateCells` an unnamed structural
literal that will silently stop matching when the real type changes. In the
other direction, `spellcasting.ts` exports `ClassPreparedEntry`, a bare alias of
`PreparedSpellLimitInput` that adds no meaning and has exactly one use — the very
next line. And eight exported helpers across `rules/combat.ts`,
`rules/initiative.ts` and `map/grid-utils.ts` have no production caller at all:
they are reached only by their own colocated tests, so the tests pass, coverage
looks healthy, and nothing they assert protects a shipping code path. Worse, one
of them is *shadowed twice*: the server's turn-advance transaction writes
`FRESH_ACTION_ECONOMY`'s exact three-field reset out by hand, and the client
hand-rolls `ACTION_ECONOMY_CONFIG` mapping each action type to its `*Used`
field — exactly the relation shared's `ActionEconomyState` already describes.

No gate catches any of this: `knip.config.ts:21-24` blanket-exempts
`packages/shared/src/{schemas,rules,map}/**` from both `exports` and `types`
issues, on the grounds that shared is a deliberate contract surface. That
exemption is why unused exports accumulate here silently, and it means the
`knip-unused-exports` verify slot will neither prompt this cleanup nor confirm
it landed.

**One spot re-implements something already available.** `sortByInitiative`
decorates every participant with an `originalIndex`, sorts on it as the final
tie-break, then strips it back off — paying for that round trip with an
`as unknown as` double assertion and two Stryker suppressions that exist only to
excuse the redundant fallback. `Array.prototype.sort` has been specified stable
since ES2019, and the function's own doc comment already promises stable
behaviour, so the entire scaffold emulates a guarantee the runtime gives for
free.

**And one small inconsistency.** Two entity schema files type their
`createdAt`/`updatedAt` as bare `z.string()` while ten sibling schema files use
the `dateTimeField` helper that accepts `string | Date` and normalizes to
`string`. This is a readability wart only. It is *not* the cause of the server's
`.toISOString()` calls: because every mapper is annotated with the schema's
`z.infer` (output) type, `createdAt` is `string` regardless of which validator
the schema uses, so `dateTimeField`-adopting schemas call `.toISOString()` too —
`campaign.ts:67-68` uses `dateTimeField` and `routers/campaign.ts:92`, `:111`
still convert by hand. Adopting the helper here deletes nothing.

None of this is a bug. It is the kind of drift that makes the package harder to
trust: exports that lead nowhere, tests that guard nothing, and helpers the
codebase quietly declines to use.

## Evidence

- `packages/shared/src/map/area-template.ts:36` (`GridCell`) and `:45` (`TemplateParams`) — declared without `export`, while appearing in the signatures of `templateCells:280` and `cellAngle:311`, the two functions with production callers.
- `packages/client/src/hooks/canvas-input/tool-handlers.ts:104-112` — declares a local `ComputeAndSetInput` whose `origin`/`direction` are inline `{ x: number; y: number }`; `:117-125` passes `templateCells` an unnamed structural literal. This is the only production call site of `templateCells`.
- `packages/shared/src/map/area-template.ts:57` (`AreaInput`) and `:202` (`LineInput`) — also unexported, but they appear only in the signatures of `sphereCells:83`, `cubeCells:100`, `coneCells:142`, `lineCells:207` and `emanationCells:242`, none of which is called outside `area-template.ts` and `area-template.test.ts`.
- `packages/shared/src/map/area-template.ts:40` — `MapBounds` appears in **no** exported signature (only the private `ConeConfig.bounds:68` and `inBounds:75`).
- `packages/shared/src/rules/spellcasting.ts:238` — `export type ClassPreparedEntry = PreparedSpellLimitInput;`, used only at `:240`; repo-wide search finds no other reference in tests, server, client or scripts.
- `packages/shared/src/rules/combat.ts:19-21` (`getValidTransitions`), `:38-42` (`FRESH_ACTION_ECONOMY`), `:47-49` (`hasActionsRemaining`), `:27` (`ACTION_ECONOMY_TYPES`) — each referenced only by `combat.test.ts`.
- `packages/shared/src/rules/initiative.ts:93-98` (`getCurrentParticipant`) — referenced only by `initiative.test.ts`.
- `packages/shared/src/map/grid-utils.ts:44-46` (`snapToGrid`), `:78-82` (`pixelToHex`), `:85-102` (`hexRound`) — referenced only by `grid-utils.test.ts`; `pixelToHex` calls `hexRound` at `:81`, so the pair lives or dies together.
- `packages/server/src/services/combat-actions/turn-transaction.ts:77-79` — the turn-advance write-back returns `{ actionUsed: false, bonusActionUsed: false, reactionUsed: false, conditions: tickedConditions }`, hand-writing the exact reset `FRESH_ACTION_ECONOMY` (`combat.ts:38-42`) already is.
- `packages/client/src/components/campaign/combat/action-economy-indicators.tsx:8-22` — `ACTION_ECONOMY_CONFIG` hand-rolls the type→field mapping that `ActionEconomyState` (`combat.ts:31-35`) describes.
- `knip.config.ts:21-24` — `ignoreIssues` exempts `packages/shared/src/{schemas,rules,map}/**` from `exports` and `types`, so no gate reports these unused exports.
- `packages/shared/src/rules/initiative.ts:23` — builds `indexed` with `originalIndex`; `:40` tie-breaks on it; `:43-47` strips it back out; `:46` carries `as unknown as T & { sortOrder: number }` with a `type-assertion-boundary: framework` marker.
- `packages/shared/src/rules/initiative.ts:33`, `:39` — `Stryker disable next-line ConditionalExpression` and `ArithmeticOperator`, both justified by "stable-sort preserves order".
- `packages/shared/src/schemas/homebrew.ts:270-271`, `:299-300`; `packages/shared/src/schemas/magic-item.ts:69-70` — bare `z.string()` for `createdAt`/`updatedAt`.
- `packages/shared/src/constants.ts:89-91` — `dateTimeField` accepts `string | Date` and transforms to an ISO string; imported by 10 sibling schema files.
- `packages/server/src/routers/magic-item.ts:57-58`, `packages/server/src/utils/homebrew-helpers.ts:58-59` and `:72-73` — three hand-written `row.createdAt.toISOString()` pairs.
- Counter-evidence that those calls are **not** caused by the bypass: `packages/shared/src/schemas/campaign.ts:67-68` uses `dateTimeField`, `CampaignDetail`/`CampaignSummary` are `z.infer` of those schemas (`:146`, `:160`), and `packages/server/src/routers/campaign.ts:92` and `:111` still call `.toISOString()`. There are 45 `.toISOString()` call sites across 18 non-test files in `packages/server/src`, spread across `dateTimeField` and non-`dateTimeField` schemas alike.
- `packages/server/src/routers/magic-item.ts:43` — `function mapMagicItem(m: PrismaMagicItem): MagicItem`, where `MagicItem = z.infer<typeof magicItemSchema>` (`schemas/magic-item.ts:73`). The declared return type is the schema's *output* type, so `createdAt` is `string` whatever the field validator is.
- `packages/server/src/utils/srd-query-helpers.ts:36`, `:53`, `:69` — the one place that does type a mapper against `z.input<TItem>` rather than the output type; the only existing precedent for letting a `Date` flow into a schema.

## Proposed direction

Six independent commits; nothing here needs to land as a unit.

1. **Export the two types the live callers need**, and adopt them. Read
   `packages/shared/src/map/area-template-MODULE.md` first (`area-template.ts:8`
   points at it and `AGENTS.md` requires it). Add `export` to `GridCell`
   (`area-template.ts:36`) and `TemplateParams` (`:45`), then replace the inline
   `{ x: number; y: number }` fields of `ComputeAndSetInput`
   (`packages/client/src/hooks/canvas-input/tool-handlers.ts:104-112`) with
   `GridCell` and give the `templateCells` argument at `:117-125` its real type.
   Land the export together with that adoption — an export with no importer is
   the same drift this leaf is clearing. Update the MODULE doc's Purpose
   paragraph (`:9-14`), which enumerates the exported surface, per
   `docs/guides/add-module-doc.md`. Do not export `AreaInput` or `LineInput` —
   see caveats.

2. **Delete `ClassPreparedEntry`** at `packages/shared/src/rules/spellcasting.ts:238`
   and inline `PreparedSpellLimitInput[]` into the `getMulticlassMaxPreparedSpells`
   signature at `:240`.

3. **Decide the fate of each uncalled helper, one file at a time.** For each of
   `getValidTransitions`, `FRESH_ACTION_ECONOMY`, `hasActionsRemaining`,
   `getCurrentParticipant`, `snapToGrid`, and the `pixelToHex`/`hexRound` pair:
   either wire it into the caller that should have been using it, or delete it
   with its colocated tests. Prefer wiring where a duplicate already exists. The
   two concrete targets are
   `packages/server/src/services/combat-actions/turn-transaction.ts:77-79`, whose
   reset becomes `{ ...FRESH_ACTION_ECONOMY, conditions: tickedConditions }`, and
   `ACTION_ECONOMY_CONFIG` in `action-economy-indicators.tsx:8-22`, which should
   derive its `field` from shared rather than restating it.

4. **Simplify `sortByInitiative`** in `packages/shared/src/rules/initiative.ts:20-48`:
   sort a copy directly (`[...participants].sort(cmp)`), then
   `.map((p, sortOrder) => ({ ...p, sortOrder }))`. This removes the
   `originalIndex` intermediate, the `:40` fallback comparator, and both Stryker
   suppressions at `:33` and `:39`. Write the tie-order tests first — the existing
   `initiative.test.ts` tie cases are the gate.

5. **Check whether the cast at `:46` actually goes away** before claiming it in
   the commit message. The return type is declared explicitly, so what must pass
   is the assignability of the generic spread to `(T & { sortOrder: number })[]`.
   Run a typecheck; if TS still refuses, keep an assertion with an honest
   `// type-assertion-boundary: framework - <reason>` marker rather than forcing
   the shape. See `docs/guides/local-eslint-rules.md#type-assertion-boundary-marker`.

6. **Decide, in one shared-only commit, what the two off-pattern schema files
   should say — and do not touch the server.** Either swap the bare `z.string()`
   for `dateTimeField` in `packages/shared/src/schemas/homebrew.ts`
   (`homebrewCollectionSchema:270-271`, `homebrewEntrySchema:299-300`) and
   `packages/shared/src/schemas/magic-item.ts:69-70` purely for symmetry with the
   ten siblings, or leave them and add a line to `schemas/MODULE.md` recording
   that these three fields are deliberately string-only. Either way the change is
   type-neutral downstream: `MagicItem`, `HomebrewCollectionWithAuthor` and
   `HomebrewEntry` are `z.infer` output types, so `createdAt`/`updatedAt` stay
   `string`, the tRPC `.output(...)` wire shape is unchanged, and the three
   `.toISOString()` calls at `routers/magic-item.ts:57-58` and
   `utils/homebrew-helpers.ts:58-59`, `:72-73` **must stay** — deleting them
   without also re-annotating the mappers is a typecheck failure.

   Deleting those conversions is a separate, larger question: it requires
   re-typing `mapMagicItem`/`mapCollection`/`mapEntry` to
   `z.input<typeof …Schema>` (the pattern at
   `packages/server/src/utils/srd-query-helpers.ts:36`, `:53`, `:69`), which would
   make three mappers diverge from every other server mapper — including the ones
   over `dateTimeField` schemas. Do not fold that into this leaf; if it is worth
   doing it is worth doing uniformly, as its own piece of work. See
   `docs/guides/add-trpc-procedure.md` for the router-mapper conventions.

## Scope / caveats

- **Do not export `AreaInput` (`area-template.ts:57`) or `LineInput` (`:202`),
  and do not un-export or delete the five shape functions that use them.**
  `sphereCells`, `cubeCells`, `coneCells`, `lineCells` and `emanationCells` have
  no production caller, but `templateCells` dispatches to all five and
  `area-template-MODULE.md:65-68` names `area-template.test.ts` "the single
  regression guard", pinning "the numeric output of every shape, the dispatcher,
  and the angle utilities (40 cases)"; the export is that test's access path.
  Their parameter types stay module-private accordingly — exporting them would
  widen the public surface for callers that do not exist, which is the problem
  this leaf exists to reduce. The MODULE doc's Gotchas (`:76-77`) record the real
  external dependents: "`snapAngle`, `cellAngle`, and `templateCells` have
  external dependents; do not change their signatures."
- **Do not export `MapBounds`** (`area-template.ts:40`). It appears in no
  exported signature — only the private `ConeConfig.bounds:68` and `inBounds:75` —
  so exporting it would widen the surface for no caller.
- **The geometry comments in `area-template.ts` are load-bearing and must survive
  verbatim**: `:118-121` (the cardinal-axis mapping for `cubeOffset`), `:187-189`
  (why `dirX*dirY` folds all four diagonal quadrants into one expression), and
  `:217-219` plus `:226-227` (the rotated-rectangle hit test and the half-open
  `along > 0` gate). `area-template-MODULE.md:74-75` already flags them; step 1
  only adds `export` keywords, so do not "tidy" around them.
- **`ACTION_ECONOMY_TYPES` is not deletable as written.** The array itself has no
  production caller, but `ActionEconomyType` at `combat.ts:29` is derived from it
  and *is* used by several client components. Deleting the const breaks the type.
  Either keep it as the type's source or replace it with a literal union — do not
  treat it as plain dead code.
- **`hexRound` is not standalone-dead**; it is called by `pixelToHex:81`. Remove
  the pair together or keep both. This is also not a blanket "grid-utils is dead"
  claim: `hexCorners` and `hexGridCenters` in the same file are live, used by
  `packages/client/src/components/campaign/maps/map-canvas-grid.tsx`.
- **`packages/shared/src/schemas/note-inputs.ts:77` is not a bypass** and must not
  be converted in step 6. That `updatedAt` is a keyset-pagination *cursor* field
  inside a client-supplied `.strict()` input schema; it never arrives as a Prisma
  `Date`, and `z.iso.datetime()` is both stricter and correct there. Folding it
  into `dateTimeField` would loosen an input validator. The finding is two entity
  files, not three.
- Step 4 changes the ordering of encounter turns if it is wrong, so treat it as a
  rules change: read `docs/guides/change-rules-logic.md` and let
  `initiative.test.ts` drive it. Behaviour is expected to be identical for every
  input; the replacement relies on documented engine stability, which is why this
  is low- rather than zero-risk. Removing the two Stryker suppressions shrinks
  `suppression-ledger.json` (the `stryker-disable` entries at `:559` and `:569`,
  targets `ArithmeticOperator` and `ConditionalExpression`). Regenerate with
  `bun scripts/suppression-ledger.ts --update` and commit the result in the same
  diff, or the `suppression-ledger` verify slot fails — it locks in drained
  identities as well as new ones, and runs in pre-commit and `verify:changed` too.
  This is not a lint-ratchet concern; `lint-ratchet.baseline.json` is untouched.
  Mutation coverage is advisory (no break threshold), but `initiative.ts` is
  inside the Stryker mutate glob (`stryker.config.mjs:18-24`), so spot-check the
  rewritten comparator with
  `bun run test:mutation -- --mutate packages/shared/src/rules/initiative.ts`
  before concluding no suppression is needed.
- Step 6 is cosmetic consistency only. It does not delete the server's
  `.toISOString()` calls: every mapper's declared return type is the schema's
  `z.infer` *output* type, so `createdAt` is `string` whichever validator the
  schema uses, and `dateTimeField`-adopting schemas such as `campaign.ts:67-68`
  convert by hand too (`routers/campaign.ts:92`, `:111`). The three conversions
  at `routers/magic-item.ts:57-58` and `utils/homebrew-helpers.ts:58-59`,
  `:72-73` must stay.
- These six items share a theme but not a mechanism. Steps 2 and 4-6 are
  shared-package-only; step 1 also edits `packages/client`
  (`tool-handlers.ts`) and the `area-template-MODULE.md` doc, and step 3's
  preferred "wire it in" option reaches into `packages/server`
  (`turn-transaction.ts`) and `packages/client`
  (`action-economy-indicators.tsx`).
- No sequencing dependency on other leaves in this pack.
