# 116. Twelve generated-surface manifest records hand-copy one dependency graph across trigger and fixture facets that the closure validator already computes

Status: Landed on fix/cq-116
Theme: manifest facet derivation · Area: harness · Severity: medium · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Every generated harness surface is registered once in `harness.controls.json`
via a `generatedSurface` facet — but inside that facet the same dependency
information is written out by hand several times. Twelve records declare 158
`triggerPaths` references and 123 `fixturePaths` references; 85 of those are
the *same path listed twice on the same record*, and all 12 records repeat
their own `source` file inside their own trigger list. The overwhelming bulk of
both lists is the static import closure of the generator source — a graph the
repo already computes: `harness:check` walks each `source`'s imports and
diff-checks the declared lists against the result, naming the exact entries to
add or remove.

So the workflow for a generated-boundary change is a human relaying data
between two programs. Add an import to a generator, run `bun run
harness:check`, read the failure message that names the missing `triggerPaths`
and `fixturePaths` entries, paste those strings into `harness.controls.json`,
re-run `bun run verify:steps`. Nothing can drift — the validator is exact and
fail-closed — but nothing is learned either: the hand-maintained lists are
mostly mechanical echo of the import graph, and the handful of entries that
carry real semantics (runtime data inputs like `harness.controls.json` itself,
scanned directory prefixes like `.claude/skills/`, non-walkable shell and JSON
files) are visually indistinguishable from the echo. A reader auditing a
record cannot tell which of 31 trigger entries are deliberate declarations and
which are just imports restated, and a contributor registering a new surface
copies 20-40 lines of closure by trial and error against the validator.

## Evidence

All counts re-derived at the audit pin from `/workspace/harness.controls.json`
(12 records carrying a `generatedSurface` facet).

- Totals: 158 `triggerPaths` references and 123 `fixturePaths` references
  across the 12 records; 85 per-record trigger∩fixture duplicates; 12 of 12
  records repeat their own `source` path inside their own `triggerPaths`.
- `harness.controls.json:1489` — `check/verify-steps-generator`'s facet:
  17 triggers, 37 fixtures, 15 paths listed in both, `source`
  (`scripts/harness/generate-verify-steps.ts`) repeated as a trigger.
- `harness.controls.json:1616-1617` and `:1659` —
  `check/skill-artifacts-generator`: a 31-entry trigger list and a 22-entry
  fixture list; all 22 fixture entries are duplicates of trigger entries
  (`scripts/harness/*`, `scripts/lib/*`, `scripts/path-policy/*` closure
  files hand-copied into both facets).
- Densest echo ratios: `check/smoke-subjects-generator` duplicates 12 of 12
  fixture entries into triggers; `check/concurrency-relation-graph-generator`
  6 of 7.
- The graph is already computed: `scripts/harness/fixture-closure-check.ts:80`
  (`closureWalkEntries`) walks each record's `source` import closure via
  `validateSeedImportClosure` (`:121-125`), and
  `scripts/harness/generated-surfaces.ts:358` (`diffFixtureClosure`) /
  `:416` (`diffTriggerPathClosure`) diff the declared lists against it. The
  failure messages name the exact entry and record to edit ("add it to
  fixturePaths of …", "add the file … so edits to it stale-warn").
- The two facets have different check directions today:
  `diffFixtureClosure` is exact over the walkable portion (missing-copy *and*
  stale-declaration failures, `generated-surfaces.ts:349-368`, `:436-448`),
  while `diffTriggerPathClosure` is deliberately one-directional — "extra
  triggers never fail" (`:406-415`). Fixtures are therefore the
  exactly-derivable facet.
- The projection generator is walker-free today: `bun run verify:steps`
  (`scripts/harness/generate-verify-steps.ts`) renders the checked-in
  projections `scripts/verify/steps.generated.sh`,
  `scripts/harness/generated-surface-freshness.generated.sh`, and
  `scripts/tests/harness-check-fixture-manifest.generated.txt` (all
  git-tracked) straight from the declared lists.
- The walker-incapable smoke tree is a real constraint:
  `scripts/harness/fixture-closure-check.ts:94-100` documents the fail-closed
  zero-declaration rule and the sole sanctioned skip,
  `MUSI_HARNESS_CHECK_ALLOW_NO_FIXTURE_PATHS=1` (`:46`), set by
  `scripts/tests/test-harness-check.sh` because the reduced fixture tree
  cannot resolve the `typescript` walker.
- The declare-then-validate loop is the documented contract:
  `docs/guides/harness-manifest-parser.md:105-107` (migration step 4) tells
  the contributor the closure checks "will name the exact `triggerPaths` /
  `fixturePaths` entries to add"; the `scripts/harness/generated-surfaces.ts:1-9`
  module header declares the facet the single-source registration and this
  module the only sanctioned read path.
- Non-derivable residue that any fix must preserve as declarations:
  `SHARED_FIXTURE_INFRA_RECORD_ID` (`generated-surfaces.ts:267`) and
  `FIXTURE_SYNTHESIZED_PATHS` (`:274`), plus non-closure trigger inputs like
  the scanned `.claude/skills/` prefix and `.gitignore`
  (`harness.controls.json:1618-1619`).

## Proposed direction

Derive the walkable portion of the `generatedSurface` facets at projection
time and shrink the hand-declared lists to semantic residue — layered
*additively over* the existing declare+validate contract, not replacing it.
Keep `harness.controls.json` the sole registration surface and keep every
projection checked in and freshness-checked, so graph changes remain
reviewable diffs.

1. **One shared derivation module, no second walker.** Build a module in
   `scripts/harness/` that reuses the existing closure walk
   (`closureWalkEntries` + `validateSeedImportClosure` from
   `fixture-closure-check.ts`) to compute, per record:
   `effectiveFixtures = closure(source) ∪ outputPaths ∪
   SHARED_FIXTURE_INFRA/FIXTURE_SYNTHESIZED handling ∪ residue` and
   `effectiveTriggers = closure(source) ∪ {source} ∪ residue`. Both
   `generate-verify-steps.ts` and `harness:check` consume this module, so the
   graph is computed exactly once.
2. **Slice 1 — fixtures first** (85-entry echo, exactly-derivable): rename the
   shrunk facet to a residue-semantics name (e.g. `fixtureExtras`) where each
   surviving entry carries a one-line reason; derive the copy-manifest
   projection (`harness-check-fixture-manifest.generated.txt`) from the union;
   flip the closure validator from exact-equality to residue hygiene — a
   residue entry the walker can derive *fails*, so mechanical entries cannot
   re-accrete. An emptied residue stays fail-closed, carrying
   `MUSI_HARNESS_CHECK_ALLOW_NO_FIXTURE_PATHS` semantics over to the generated
   file.
3. **Docs move with the contract, in the same slice.** Rewrite
   `docs/guides/harness-manifest-parser.md` (migration step 4 and the
   closure-check contract) and the `generated-surfaces.ts` module header,
   including an explicit statement that derivation is an optimization layer
   over declare+validate and that a walker-less copier may declare full lists
   by hand — the additive union makes that a valid degenerate mode.
4. **Prove convergence per slice**: regenerate the projections and re-run
   `bun run harness:check` (plus `bash scripts/tests/test-harness-check.sh`
   for the smoke tree) after each slice; the checked-in projection diffs must
   be empty or explained.
5. **Slice 2 — triggers, separately judged and explicitly deferrable**: same
   treatment for `triggerPaths` (an `extraTriggerPaths` residue holding
   runtime data inputs, directory prefixes, and non-walkable files). Slice 1
   alone is an acceptable stopping point.
6. **Derivation runs only in the real tree at projection time.** The
   walker-incapable smoke-fixture tree keeps consuming checked-in projections
   and never runs the walker.

Implementation narrowing (work unit 116): slice 1 is the stopping point.
`fixturePaths` became reasoned `fixtureExtras`, while the effective fixture
copy list is derived from the shared closure walk and checked in as before.
Slice 2 is deferred because trigger validation remains deliberately
one-directional: runtime inputs, directory prefixes, and non-walkable files
make its residue classification less exact than the fixture slice. The fixture
slice removes the densest exactly-derivable echo without broadening this
medium-severity refactor into that separately judged contract change.

Recorded fallback if derivation is rejected at planning time: an S/M
closure-sync autofix writer (`harness:check --fix`) that writes back the
validator's already-computed exact fix sets. It is structurally inferior — it
keeps derived data in the source-of-truth file and adds a second writer of a
hand-authored file — but preserves every current review property.

## Scope / caveats

Binding rulings from the direction review:

- **Do not build a new standalone producer/source/output/fixture/freshness
  edge-graph model.** The graph already exists as each record's `source` plus
  the closure walk in `fixture-closure-check.ts`; extend that, factored into
  one shared module consumed by both the generator and `harness:check`.
- **Do not replace the declare+validate contract.** Derivation is an additive
  union over residue declarations (closure ∪ extras); fully hand-declared
  lists remain a valid degenerate mode so the manifest format stays copyable
  to walker-less repos — and the guide must say so explicitly.
- **Do not keep derivable entries under the same facet names.** The shrunk
  facets get residue-semantics names (`fixtureExtras` / `extraTriggerPaths`)
  with a reason per entry, and the validator flips to residue hygiene so echo
  cannot re-accrete.
- **Do not do triggers first.** Fixtures first: densest duplication, exactly
  derivable (`diffFixtureClosure` is already bidirectional over the walkable
  portion), and the smoke tree already consumes a checked-in projection so
  derivation risk surfaces as reviewable diffs and smoke failures. The
  trigger slice is separately judged and deferrable.
- **Do not run derivation in the smoke-fixture tree or weaken fail-closed
  semantics** (see direction steps 2 and 6).
- **Do not adopt the `--fix` writer as the primary direction**; it is recorded
  only as the fallback.
- Severity is medium, not the original high: the closure validator and parity
  checks make drift impossible — misses fail loudly with exact-fix
  diagnostics — so the cost is tedium and obscured residue semantics, not
  active misdirection. Weigh that honestly at planning time: this refactors a
  recently-landed, working, fail-closed system for legibility.

Other scope notes:

- Out of scope: the shell/`jq` manifest consumers
  (`docs/guides/harness-manifest-parser.md:95-98` keeps them independent of
  the generator by design), and any change to which surfaces are registered.
- Same-file neighbors: [125-manifest-copies-verify-slot-programs-across.md](./125-manifest-copies-verify-slot-programs-across.md)
  (gate slot programs) and [126-hook-wiring-repeats-adapter-templates-leaves.md](./126-hook-wiring-repeats-adapter-templates-leaves.md)
  (hook adapter bindings) are distinct duplication problems inside
  `harness.controls.json`; [114-harness-controls-represented-competing.md](./114-harness-controls-represented-competing.md)
  (competing TS models of the manifest) edits the same parser modules this
  leaf's derivation seam lives in. No hard ordering, but do not work 114 and
  this leaf concurrently in `scripts/harness/`.
- Prior pack: the 2026-07-25 HARNESS-CLUSTER plan's H15 follow-up note
  (`docs/agent_notes/backlog/code-quality-2026-07-25/HARNESS-CLUSTER-PLAN.md:144-152`)
  proposes an optional import-closure sensor for *smoke-subject* declarations
  — a different surface; this leaf is novel. The standing 2026-07-25 ruling
  against rebuilding a shared manifest/fixture framework
  (`docs/agent_notes/backlog/code-quality-2026-07-25/CONSTRAINTS.md:48`) is
  scoped to the lint-ratchet sandbox copy sets and does not block this leaf,
  but its derive-only-on-concrete-need spirit is satisfied here precisely
  because the 85-entry echo is existing, materialized repetition — keep the
  fix a projection over the existing manifest, never a new framework layer.
