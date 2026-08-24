# 139. Every triage item carries a display-string location list and a structured location list that three producers and both merge paths must keep in step by hand

Status: Landed on fix/cq-139
Theme: One authoritative location model · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

A triage item's locations exist twice. `TriageItem` declares both
`locations: readonly string[]` — human-readable `path:line-line` strings — and
`locationDetails: readonly TriageLocation[]`, the structured `{path, startLine,
startCol, endLine, endCol}` form
(`scripts/drift-triage/triage-report-types.ts:30-38`). Neither is derived from
the other. Every producer builds both arrays independently from the same source
row, and both branches of `addReviewItem` merge them through two separate
deduplication helpers with two different keys.

The cost lands on anyone touching triage locations. Adding a producer means
remembering that there are two arrays, not one, and getting the string format
right by copying an existing template rather than calling a formatter. The
parsing, formatting, and test-path rules that connect the two forms are spread
across three regexes and five functions in the support module, plus two inline
formatters in the producer file and a third formatter in the packet layer. And
because the two arrays dedup on different keys — exact string versus
`JSON.stringify` of the structured record — they can genuinely disagree: for a
Semgrep row with two matches on one line, the item ships one display location
and two structured locations, and nothing in the module notices.

The module already demonstrates the fix it needs. Every internal machine
consumer — packet selection, packet grouping, staleness checking — reads
`locationDetails` exclusively, and the staleness checker derives its display
strings from the structured form with a local `formatLocation`. Only the text
renderer, the clone-pair identity key, and the serialized report/packet JSON
still want strings, and all three are boundaries where a string can be derived
rather than carried.

## Evidence

- `scripts/drift-triage/triage-report-types.ts:30-38` — `TriageItem` holds
  `locations: readonly string[]` (`:35`) and
  `locationDetails: readonly TriageLocation[]` (`:36`) side by side;
  `TriageLocation` is defined at `:13-19`. The mutable build-time twin repeats
  the pair at `:113-121` (`:118`, `:119`).
- `scripts/drift-triage/triage-report-support.ts:115-135` — `addReviewItem`
  synchronizes both arrays on both paths: the merge path calls
  `mergeUniqueLocations` and `mergeUniqueLocationDetails` back to back
  (`:121-122`), and the create path builds `locations` through
  `uniqueLocations` and `locationDetails` through a separate seed-and-merge
  dance (`:126-128`).
- `scripts/drift-triage/triage-report-support.ts:33-41` vs `:47-59` — the two
  dedup helpers use different keys: `mergeUniqueLocations` keys on the exact
  string, `mergeUniqueLocationDetails` keys on `locationDetailKey`
  (`:93-95`), which is `JSON.stringify(location)`.
- Measured divergence: running `buildTriageReport` over the Semgrep fixture
  pinned at `scripts/drift-triage/triage-report.test.ts:449-483` (one row,
  two ranges on line 8 differing only in column) yields **one** entry in
  `locations` (`["src/auth.ts:8-8"]`, asserted at `:482`) and **two** entries in
  `locationDetails`. The same item reports two different location counts
  depending on which field you read.
- Three producers, three hand-built pairs of arrays, all in
  `scripts/drift-triage/triage-report.ts`: drift findings build strings at
  `:130` and re-parse those same strings into structured form at `:139`;
  Semgrep builds line-only strings at `:167-169` and column-aware details at
  `:180-186` from the same `row.ranges`; Dolos formats strings via
  `formatDolosRange` (`:221-223`, defined `:275-277`) and hand-writes the
  matching structured objects at `:231-246`.
- Parsing and formatting rules are scattered rather than owned. Three regexes
  in `scripts/drift-triage/triage-report-support.ts:27-29` (`LOCATION_SUFFIX`,
  `COLUMN_LOCATION`, `LINE_LOCATION`) feed `parseDisplayLocation` (`:61-75`),
  `parseColumnLocation` (`:77-87`), `pairKey` (`:97-106`, which strips the
  suffix to compare files), and `isTestLocation` (`:108-111`, which strips it
  again). Formatting lives in three other places:
  `scripts/drift-triage/triage-report.ts:167-169`, `:275-277`, and
  `scripts/drift-triage/triage-packet-staleness.ts:173-182`.
- `scripts/drift-triage/triage-packet-staleness.ts:173-182` — `formatLocation`
  already derives a display string from a `TriageLocation`, and `:92-94` feeds
  it straight from `item.locationDetails`. This is the target state, in the
  module, today.
- Every internal machine consumer already ignores the display strings:
  `scripts/drift-triage/triage-packet-select.ts:84-87` (path-prefix filter),
  `scripts/drift-triage/triage-packet-group.ts:141-143` (area grouping), and
  `scripts/drift-triage/triage-packet-staleness.ts:92` all read
  `locationDetails`. The only non-test reader of `item.locations` in the module
  is the text renderer at `scripts/drift-triage/triage-report-text.ts:98`.
- The display strings are load-bearing for identity, not only presentation:
  `scripts/drift-triage/triage-report.ts:131-132` derives a clone item's key
  from `pairKey(locations)`, `:172` embeds `row.path` and the serialized ranges
  in the Semgrep key, and both keys become the item `id` (`:134`, `:175`,
  `:226`).
- The item shape is serialized under `schemaVersion: 1`
  (`scripts/drift-triage/triage-report.ts:86`) and packets carry
  `readonly items: readonly TriageItem[]`
  (`scripts/drift-triage/triage-packet-types.ts:49`), so `locations` is part of
  a published artifact contract, not an internal convenience.
- Drift input arrives as display strings — `finding.file` values such as
  `"src/commented.ts:12:4"`, exercised at
  `scripts/drift-triage/triage-report-swarm-prep.test.ts:78-90` — so a
  string→structured parse is required at ingestion and cannot be deleted.

## Proposed direction

Make the structured form authoritative behind one parse/format/dedup unit, and
derive display strings at the serialization and text-output boundaries. Four
steps, each landable on its own.

1. **Give locations one home.** Collect `parseDisplayLocation`,
   `parseColumnLocation`, `locationWithoutRange`, the location regexes, the
   dedup key, and a new canonical `formatLocation` into one location unit inside
   `scripts/drift-triage/triage-report-support.ts` — the module's designated
   shared-helper home (`scripts/drift-triage/MODULE.md:45-47`) — or a
   `triage-location.ts` beside it if the support module is already crowded.
   Either way the module stays internal, so this adds no cross-module contract
   surface. The canonical formatter must reproduce **exactly** the strings
   produced today: line-only `path:startLine-endLine` for item display, matching
   `triage-report.ts:167-169` and `:275-277`. Note that
   `triage-packet-staleness.ts:173-182` emits a *column-precise* variant for
   staleness diagnostics; that is a second, deliberate format — keep both, named
   distinctly, rather than collapsing them and silently adding columns to item
   locations.
2. **Have producers build only `locationDetails`.** In
   `scripts/drift-triage/triage-report.ts`, drop the hand-built `locations`
   arrays from the drift (`:130`, `:138`), Semgrep (`:167-169`, `:179`), and
   Dolos (`:221-223`, `:230`) paths, and build the structured array once per
   row. Drift keeps its single ingestion parse — schema-v4 `finding.file`
   arrives as a string, so the goal is *one* parse point, not zero. The strings
   those paths still need for identity (`pairKey` at `:131`, the Semgrep key at
   `:172`) come from the canonical formatter, so the resulting `id` values are
   byte-identical to today's.
3. **Derive `locations` at finalization.** `toTriageItem`
   (`scripts/drift-triage/triage-report.ts:283-285`) is the single funnel from
   `MutableItem` to `TriageItem`; have it map `locationDetails` through the
   canonical formatter and dedup the result. Keep `locations` in the serialized
   `TriageItem` so the `schemaVersion: 1` report and the packet bundle consumed
   by swarm agents and the verdict pipeline need no version bump — the field
   stops being *maintained* without ceasing to be *published*.
4. **Unify the dedup rule, under test first.** With one producer of `locations`
   there is one dedup left, and the existing exact-string and
   `JSON.stringify` keys collapse into it. This is the step that can change
   observable output — the Semgrep two-columns-on-one-line case currently
   yields one display location and two structured ones — so TDD it: extend the
   cases at `scripts/drift-triage/triage-report.test.ts:449-483` and
   `scripts/drift-triage/triage-report-swarm-prep.test.ts:29-76` to assert both
   array lengths explicitly, decide deliberately whether the derived display
   list stays collapsed (it should, to preserve `:482`), and pin the decision
   before touching the merge helpers. Focused run:
   `bun run test:scripts:file -- scripts/drift-triage/triage-report.test.ts`.

## Landing decision

The canonical line-only projection applies to every producer, including drift
input. It deliberately normalizes an ingested `path:12` to `path:12-12` and
`path:12:4` to `path:12-12`; columns remain available in `locationDetails`.
Keeping the ingested spelling in `locations` would preserve a second
authoritative representation, contrary to this unit's purpose. Identity is
unchanged because drift and pair IDs consume admitted input strings before
parsing, `locations` remains in the schema-v1 serialized shape, and
`scripts/drift-triage/MODULE.md` records the normalization for downstream
readers.

## Scope / caveats

- **Do not bump `schemaVersion`, and do not remove `locations` from the
  serialized shape.** Step 3 exists precisely so the published contract at
  `scripts/drift-triage/triage-report.ts:86` and
  `scripts/drift-triage/triage-packet-types.ts:49` is untouched. Removing the
  field is a separate decision with swarm-agent and verdict-pipeline blast
  radius.
- **Item IDs must not change.** `pairKey` (`triage-report-support.ts:97-106`)
  and the Semgrep key (`triage-report.ts:172`) embed location strings, and item
  identity flows into packet manifests and returned verdicts. The canonical
  formatter reproducing today's exact string form is a hard constraint, not a
  nicety; `triage-report.test.ts` and `triage-report-swarm-prep.test.ts` are the
  pins.
- **Preserve the same-file clone-pair rule.** `MODULE.md:117-118` states that
  same-file clone pairs merge only when their line ranges match, which is
  implemented by `pairKey`'s branch on `files[0] === files[1]`
  (`triage-report-support.ts:102`). Any refactor that normalizes locations
  before `pairKey` sees them can silently merge fragment-level drift pairs with
  whole-file Dolos ranges.
- **One parse stays at the ingestion boundary.** Drift schema-v4 findings are
  display strings; `parseDisplayLocation` does not disappear, it just becomes
  the module's only caller-facing parse.
- **The staleness formatter is not the canonical item formatter.** It emits
  columns when present (`triage-packet-staleness.ts:175-180`); item display
  strings are line-only. Reusing it verbatim for step 1 would change both the
  string form and the dedup result.
- **Update `MODULE.md` in the same change** if the file layout moves. The data-
  flow section names `triage-report-support.ts` as the home of shared
  parse/build helpers (`scripts/drift-triage/MODULE.md:45-47`); a new
  `triage-location.ts` needs that sentence updated, per
  `docs/guides/add-module-doc.md`.
- **Sequencing with
  [138-triage-merge-keys-leak-directly-public.md](./138-triage-merge-keys-leak-directly-public.md).**
  That leaf reworks the same identity keys this one must keep stable
  (`pairKey`, the Semgrep and drift key construction). Land the two in one lane
  and in that order — identity first, then locations — or the second one lands
  on top of a key format the first one just changed. They must not run
  concurrently.
- **Do not work concurrently with
  [166-triage-report-tests-bury-scenarios-repeated.md](./166-triage-report-tests-bury-scenarios-repeated.md).**
  It restructures `scripts/drift-triage/triage-report.test.ts`, the file step 4
  extends.
- **Prior-pack coverage checked.** The 2026-07-25 pack's
  [34-drift-ai-typing.md](../code-quality-2026-07-25/34-drift-ai-typing.md) and
  its `34-PLAN.md` slices cover *contract typing* in this module — the
  `typeOnly` predicate, set typing, and the Zod input-narrowing carve-out scoped
  to `triage-report-input.ts` / `triage-report-drift-input.ts` — not the dual
  location model. Leaf
  [31-harness-shared-helpers.md](../code-quality-2026-07-25/31-harness-shared-helpers.md)
  did touch `mergeUniqueLocations` and explicitly put the `locationDetails`
  merge path out of scope (`31-harness-shared-helpers.md:97`), so this is
  unaddressed work, not a declined one.
