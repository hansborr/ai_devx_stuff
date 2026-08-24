# 123. Concurrency-guard repair guidance is duplicated in two divergently-worded hand maps instead of riding the generated policy graph

Status: Landed on fix/cq-123
Theme: generated policy descriptor · Area: harness · Severity: medium · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The concurrency guard's *structural* policy is already single-sourced: the
codemod owns `GATED_DELEGATES`/`GATED_MUTATORS` as generator input, the
generator renders them into
`packages/server/src/prisma/concurrency-relation-graph.generated.json`, and the
lint rule, the runtime nested-write guard, and the codemod all read the gated
sets and relation graph from that one artifact. What never made it onto that
seam is the *repair* policy — the "use this helper instead" guidance a
contributor sees when the guard fires. That guidance lives in two hand-written
`DIRECT_WRITE_SUGGESTIONS` maps with the same five keys and deliberately
different prose: the codemod's copy names helpers plus `docs/CONCURRENCY.md`
pattern anchors, the lint rule's copy names helpers plus module paths and drops
the anchors. A drift test aligns only their *key sets* with the gated
delegates; the wording is free to rot independently, and it already has — one
of the codemod map's three doc anchors no longer matches any heading in
`docs/CONCURRENCY.md`.

So a gated-delegate change today is: edit `constants.ts`, regenerate the
graph, then hand-write the same guidance twice in two files with two house
styles, with a test that catches a missing key but not a wrong or stale
sentence. For a flagship harness surface that the repo holds up as the
copyable pattern for "codemod-owned inputs feeding one checked-in descriptor",
stopping the generation seam one field short of the repair metadata is the
part a copier would faithfully reproduce and regret.

## Evidence

- `scripts/codemods/concurrency-guard/constants.ts:14-24` — `GATED_DELEGATES`
  (5 delegates) and `GATED_MUTATORS` as codemod-owned generator input;
  `scripts/codemods/concurrency-guard/generate-relation-graph.ts:16-29` feeds
  exactly these structural sets into the generated JSON — repair metadata is
  not part of the artifact.
- `eslint-rules/concurrency-guard-graph.js:3-24` — the lint side derives
  `GATED_DELEGATES`, `GATED_MUTATORS`, `DATA_SCALAR_MODELS`,
  `RELATIONS_BY_MODEL`, and `PAYLOAD_ENVELOPE_KEYS` from the generated JSON
  (imported `with { type: "json" }`), and
  `packages/server/src/prisma/nested-write-guard.ts:9-12` reads the same file
  at runtime — three consumers of structure, zero of repair guidance.
- `scripts/codemods/concurrency-guard/constants.ts:118-139` — hand map #1:
  `DIRECT_WRITE_SUGGESTIONS`, delegate-keyed strings naming helpers plus
  `docs/CONCURRENCY.md` section anchors; consumed at
  `scripts/codemods/concurrency-guard/scanner.ts:46-47` with a generic
  fallback string for unmapped delegates.
- `eslint-rules/concurrency-guard.js:70-88` — hand map #2: a second
  `DIRECT_WRITE_SUGGESTIONS` with the same five keys and different wording
  (module paths, no doc anchors), declared locally in the rule even though
  lines 62-68 import every structural set from `concurrency-guard-graph.js`.
- `scripts/codemods/concurrency-guard/concurrency-guard-drift.test.ts:434-442`
  — the only cross-check: both maps' key sets must equal the gated delegates;
  the test's own comment concedes the map "lives only in the rule and the
  codemod". Nothing checks the strings.
- Measured wording drift: `constants.ts:129` points at
  `docs/CONCURRENCY.md#pattern-c--compound-updatemany-for-encounter-state`,
  but the live heading is "Pattern C — compound `updateMany` with the
  precondition in `where`" (`docs/CONCURRENCY.md:309`), whose slug is
  `#pattern-c--compound-updatemany-with-the-precondition-in-where` — the
  anchor is dead;
  the Pattern A/B anchors (`constants.ts:121`, `:133`) still match their
  headings (`docs/CONCURRENCY.md:58`, `:285`).
- `scripts/codemods/concurrency-guard/constants.ts:27-116` — the helper-shape
  inventories (`PATTERN_A_BY_FILE`, `PATTERN_B_BY_FILE`,
  `NON_CAS_HELPER_SHAPES`) sit in the same module but have exactly one
  consumer, `scripts/codemods/concurrency-guard/helper-shapes.ts:21-23` — they
  are hand-owned policy, not duplication (see Scope).
- `harness.controls.json:60-79` — the
  `check/concurrency-relation-graph-generator` entry already lists
  `constants.ts` among the generator inputs and registers
  `bun run concurrency:relation-graph` as the refresh invocation, so the
  registration seam for extending the artifact exists.

## Proposed direction

Extend the existing generated artifact
(`packages/server/src/prisma/concurrency-relation-graph.generated.json`,
produced by `scripts/codemods/concurrency-guard/generate-relation-graph.ts`)
with a per-delegate repair block, keeping the established idiom of
codemod-owned inputs feeding one checked-in descriptor. The repair metadata is
policy, not schema-derivable, so it stays hand-authored as generator input —
the generation seam moves the *duplication*, not the authorship. Land as two
parts, in order:

1. **Descriptor schema + generator input.** In
   `scripts/codemods/concurrency-guard/constants.ts`, replace the string map
   at `:118-139` with a structured record per gated delegate: helper function
   names, helper module path, `docs/CONCURRENCY.md` pattern anchor, optional
   extra guidance. The generator renders one canonical suggestion string per
   delegate into the descriptor, and **fails generation** when the record's
   key set diverges from `GATED_DELEGATES` — converting today's drift-test
   key-alignment check into a build-time error. Pick the richer merged wording
   deliberately (helper names + module path + doc anchor); do not silently
   drop the anchors, and fix the dead Pattern C anchor (`constants.ts:129`)
   while authoring the records. Regenerate with
   `bun run concurrency:relation-graph`; update the
   `check/concurrency-relation-graph-generator` principle text in
   `harness.controls.json` to mention repair metadata (its inputs already
   list `constants.ts`), run `bun run harness:check`, and check whether the
   generatedSurface facet needs a `bun run verify:steps` regen (it should not
   if the descriptor path and refresh command are unchanged).
2. **Consumer migrations + drift-suite rework.** The codemod scanner
   (`scanner.ts:46`) reads suggestions from the descriptor instead of the
   local map; `eslint-rules/concurrency-guard-graph.js` exports the
   suggestions map from the same JSON so `concurrency-guard.js` keeps
   importing policy from the graph module alone — its local map at `:70-88`
   is deleted. Rework
   `concurrency-guard-drift.test.ts:434-442` from key alignment into an
   assertion that neither consumer declares a local
   `DIRECT_WRITE_SUGGESTIONS` and that the descriptor covers the gated
   delegates.

End state: a gated-delegate change is `constants.ts` + regenerate, with both
consumers untouched — down from today's edit-twice-and-hope-the-wording-holds.

## Scope / caveats

- **Out of scope: the helper-shape tables.** `PATTERN_A_BY_FILE`,
  `PATTERN_B_BY_FILE`, and `NON_CAS_HELPER_SHAPES` (`constants.ts:27-116`)
  stay hand-maintained: they have a single consumer (`helper-shapes.ts`) and
  are not duplicated, so folding single-consumer scanner config into the
  descriptor would launder an edit point through generation for no dedup gain.
  They change only when helper policy changes, not per gated-delegate edit.
- **Out of scope: the direct/nested lint test corpora JSON files.** They are
  deliberately separate fixtures and remain so.
- **Standing ruling (CQ25-100, prior pack):** do not hand-list relation names
  in `local/concurrency-guard` or the runtime nested-write guard, and do not
  drop model/context tracking — the generated relation-subgraph artifact is
  authoritative and drift-tested. This direction complies: the relation graph
  stays generated and authoritative; only adjacent repair metadata joins it.
- **Output-text churn is real and intended.** Unifying two deliberately
  different wordings into one canonical string changes lint and codemod
  output, so `eslint-rules/concurrency-guard.test.js` and codemod
  expectations will need updating in the same slices — that is the wording
  decision being made once, not collateral damage.
- **The descriptor has a runtime consumer.**
  `packages/server/src/prisma/nested-write-guard.ts` types itself off the
  JSON's shape (`:3-9`); new top-level keys must be additive and ignored
  there, and any whole-shape assertions in the drift suite or
  `nested-write-guard.test.ts` must be updated in the same slice.
- **Keep the loudness or lose the copyability.** Hand-authored policy emitted
  through a generated file can obscure where to edit; the generator's
  key-mismatch error and the updated `harness.controls.json` principle are
  load-bearing, not polish.
- **Keep the lint rule's import discipline.** The drift suite asserts the
  graph module is the rule's sole relation source
  (`concurrency-guard-drift.test.ts:420-432`); route the suggestions through
  `concurrency-guard-graph.js`, and remember the JSON import there uses
  `with { type: "json" }` attributes in plain JS.
- **Preserve the codemod's fallback** suggestion string at `scanner.ts:46-47`
  for unexpectedly-unmapped delegates.
- **Sequencing (soft edge only):** the suggestion strings embed
  `docs/CONCURRENCY.md` pattern anchors, and
  [092-concurrency-rulebook-claims-three-exhaustive.md](./092-concurrency-rulebook-claims-three-exhaustive.md)
  and
  [099-concurrency-rulebook-mislocates-participant.md](./099-concurrency-rulebook-mislocates-participant.md)
  are both CONCURRENCY.md accuracy passes — if either renames headings, land
  them first or re-verify the anchors when the descriptor is generated. No
  other cross-leaf dependency.
