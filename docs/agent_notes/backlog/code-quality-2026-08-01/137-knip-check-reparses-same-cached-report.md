# 137. Each Knip category adapter carries its own copy of the report-envelope parser and runs it again over the one report the whole run shares

Status: Landed on fix/cq-137
Theme: Parse the Knip report once · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

drift:ai has three Knip-backed checks — `orphan-files`, `unused-exports` and
`knip-duplicates`. They are pass-through adapters over one `knip --reporter json`
run: the runner is memoized, so when a run selects more than one of them they all
receive the *same* report string. What each adapter then does with that string is
where the problem is.

Each one owns a private, hand-written copy of the same ten-line envelope: reject
empty output, `JSON.parse`, `isRecord` the result, pull `issues`, treat a
non-array `issues` as "no rows". The three copies are identical today down to the
two error strings. Only after those ten lines does anything category-specific
start. Two of the three also carry verbatim copies of the same location parser
(`locationFromItem` / `fullLocation` / `positiveIntegerOrUndefined`) and a
near-identical symbol-item reader.

That triplication is the cost. Knip's report shape is a pinned external contract
(6.26.0; see `package.json:206` and `bun.lock:42`), and when it moves — a renamed envelope key, a new "clean report" idiom,
a nested `issues` container — three files have to move together, with nothing in
the type system or the tests forcing the third one to follow. The divergence has
already started at the documentation level: `knip-orphan-files.ts` and
`knip-unused-exports.ts` each explain *why* empty output is a failure rather than
a clean result ("knip always prints `{"issues":[]}` even when clean"), and
`knip-duplicates.ts` performs the same check with no explanation at all. A
contributor reading only the duplicates adapter has no way to know that line is
load-bearing. And the copy count is not static: the plugin seam is built to grow
— every future Knip category becomes a fourth adapter, and the template it will
copy from is the envelope.

Two framings need correcting, because they change what the fix has to achieve.
First, the *malformed-report policy* is already centralized:
`runKnipPassThroughCheck` is the single place that turns a parse failure into a
diagnostic finding, so the three adapters cannot disagree about what happens when
the report is unreadable — only about what counts as unreadable. Second, the
performance angle is small: the Knip subprocess is already memoized across
selected checks, so a check-all run pays for one spawn and three redundant
`JSON.parse` calls over the same string. That is waste worth removing on the way
past, not the reason to do the work. The reason is that one external-format
contract is written down three times, in three files that have already stopped
saying the same thing about it.

## Evidence

- `scripts/drift-ai/knip-duplicates.ts:31-41` — `parseKnipDuplicates`: empty-output
  guard (`:32`), `JSON.parse` in try/catch (`:33-38`), `isRecord` guard (`:39`),
  `issues` extraction and non-array short-circuit (`:40-41`).
- `scripts/drift-ai/knip-orphan-files.ts:88-100` — `parseKnipOrphanFiles`: the same
  ten lines at `:91`, `:92-97`, `:98`, `:99-100`, preceded by the explanatory
  comment at `:89-90`.
- `scripts/drift-ai/knip-unused-exports.ts:60-72` — `parseKnipUnusedExports`: the
  same ten lines at `:63`, `:64-69`, `:70`, `:71-72`, with the same explanatory
  comment at `:61-62`.
- Both envelope error strings are byte-identical across all three files and appear
  nowhere else under `scripts/`: `"knip produced no JSON output"`
  (`knip-duplicates.ts:32`, `knip-orphan-files.ts:91`, `knip-unused-exports.ts:63`)
  and `"expected a JSON object with an 'issues' array"` (`knip-duplicates.ts:39`,
  `knip-orphan-files.ts:98`, `knip-unused-exports.ts:70`).
- `scripts/drift-ai/knip-duplicates.ts:27-30`, `knip-orphan-files.ts:83-87`,
  `knip-unused-exports.ts:47-59` — three independent prose statements of the same
  stale knip-6.14.1 envelope contract, despite the 6.26.0 dependency pin. Only the latter two explain that empty output
  means "the run never produced a report", which is exactly what the shared
  `:32`/`:91`/`:63` guard encodes.
- `scripts/drift-ai/knip-duplicates.ts:127-145` and
  `scripts/drift-ai/knip-unused-exports.ts:200-206`, `:213-223` — `locationFromItem`,
  `fullLocation` and `positiveIntegerOrUndefined` duplicated with identical bodies
  (17 lines per file); the only difference is the symbol type named in
  `fullLocation`'s parameter, and both those types carry the same optional
  `line`/`col` pair (`knip-duplicates.ts:12-16`, `knip-unused-exports.ts:34-41`).
- `scripts/drift-ai/knip-duplicates.ts:67-72` and
  `scripts/drift-ai/knip-unused-exports.ts:95-106` — the symbol-item reader in both:
  `isRecord` the item, require a non-empty string `name`, spread
  `locationFromItem(item)`. Unused-exports adds the optional `namespace` field; the
  rest is the same.
- `scripts/drift-ai/knip-pass-through-check.ts:42` — the plugin seam is typed
  `parseReport: (jsonText: string) => TParsed | KnipReportParseFailure`, i.e. each
  category is handed raw text, which is what forces every adapter to own an
  envelope.
- `scripts/drift-ai/knip-duplicates-check.ts:24`,
  `scripts/drift-ai/knip-orphan-files-check.ts:24`,
  `scripts/drift-ai/knip-unused-exports-check.ts:29` — the three wirings that pass a
  whole text-level parser through that seam.
- `scripts/drift-ai/knip-pass-through-check.ts:143-155` — `runKnipPassThroughCheck`
  calls `options.parseReport(result.reportJson)` once per selected check and owns
  the *single* failure policy (a `buildKnipDiagnosticFinding` on `!parsed.ok`). This
  is why malformed-report policy cannot drift today — and why the envelope parse is
  the one thing the adapters still have to duplicate.
- `scripts/drift-ai/knip-runner.ts:249`, `:273-293` — `memoizingDefaultKnipRunner`
  serves selected checks from a module-level `knipRunCache` keyed on repo root, bin,
  config path, include categories and timeout.
- `scripts/drift-ai/knip-runner.ts:159-170` — `resolveKnipIncludeCategories` derives
  the `--include` superset from the *full* check selection, and
  `scripts/drift-ai/knip-pass-through-check.ts:107-114` builds every selected check's
  runner with that one value. So a check-all run really is one spawn, one report
  string, and three full re-parses of it.
- `scripts/drift-ai/knip-unused-exports-report.ts:31` and
  `scripts/sensor-knip-unused-exports-core.ts:227` — two consumers that call
  `parseKnipUnusedExports` on raw text *outside* the check pipeline (a supplied
  report file and a standalone sensor). The text-level entrypoint is not
  internal-only.
- `scripts/drift-ai/parsed-source-cache.ts:72-81` — `parsedSourceFileCacheForReport`,
  the existing in-repo pattern for a report-scoped derived cache, keyed into
  `env.reportCache` (`scripts/drift-ai/check-plugin.ts:45`, a
  `Map<string, unknown>`).

## Proposed direction

Parse once, cache at report scope, let the category adapters project — but stop
short of a single normalized all-category model. Four parts; 1 and 2 are
independent of each other, 3 depends on 1, 4 depends on 3.

1. **Hoist the envelope into one shared Knip-report module.** Add a
   `scripts/drift-ai/knip-report.ts` (or equivalent) owning the empty-output check,
   the `JSON.parse`, the `isRecord` guard and the `issues`-array extraction,
   returning typed issue rows plus the existing failure shape. Move the two error strings and the "knip always prints `{"issues":[]}` even
   when clean" rationale there once, delete all three envelope copies, and
   refresh the per-category contract prose from stale 6.14.1 to current 6.26.0. A future Knip category then inherits the
   envelope instead of copying it.
2. **Hoist the shared item parsing too.** `locationFromItem`, `fullLocation` and
   `positiveIntegerOrUndefined` (`knip-duplicates.ts:127-145`,
   `knip-unused-exports.ts:200-206`/`:213-223`) become one copy in the same module,
   along with the shared part of the symbol-item reader (`isRecord` + non-empty
   `name` + location spread). Unused-exports keeps its `namespace` handling on top;
   duplicates keeps its "fewer than two symbols is not a group" rule
   (`knip-duplicates.ts:64`).
3. **Narrow the plugin seam from text to rows.** Change
   `defineKnipPassThroughCheck`'s `parseReport: (jsonText: string) => …`
   (`knip-pass-through-check.ts:42`, and the matching field on
   `RunKnipPassThroughCheckOptions` at `:121`) to a per-category *projection* over
   already-parsed issue rows. `runKnipPassThroughCheck` then owns the envelope parse
   and keeps its single failure policy at `:144-155` unchanged. The three wirings at
   `knip-duplicates-check.ts:24`, `knip-orphan-files-check.ts:24` and
   `knip-unused-exports-check.ts:29` pass a projection instead of a parser.
4. **Memoize the parsed envelope at report scope.** Key it off the `KnipRunResult`
   object that `knipRunCache` already shares between checks — a `WeakMap` side-cache
   in `knip-runner.ts` keyed on that result object is the smallest form, and
   `parsedSourceFileCacheForReport` (`parsed-source-cache.ts:72-81`) is the in-repo
   precedent if you would rather thread `env.reportCache`. Either way a check-all run
   parses the report once and the three projections read the same rows.

Two things this direction deliberately does **not** do. It does not build a generic
normalized model covering every Knip category: the three row shapes are genuinely
heterogeneous (nested duplicate groups, file-level orphan rows, per-category symbol
arrays), and each adapter documents its own absent-vs-empty semantics — today against
the stale knip 6.14.1 prose, which the preserved contract should restate at the pinned
6.26.0: a category absent from a row means "not requested", an empty array means
"clean" (`knip-unused-exports.ts:56-59`). A monolithic model would obscure a
distinction the adapters currently state explicitly. And it does not delete the
text-level parse functions: `parseKnipUnusedExports` in particular has consumers
outside the check pipeline, so each category keeps a text-level entrypoint, now
composed as `shared envelope helper + that category's projection` rather than
open-coded.

TDD applies as usual. The parser suites at
`scripts/drift-ai/knip-duplicates.test.ts:97-165`,
`knip-orphan-files.test.ts:105-130` and `knip-unused-exports.test.ts:202-301`
already pin empty-output and non-JSON behaviour per category, but do not cover
non-object envelopes or non-array `issues`; add those missing cases for all
three adapters during the extraction, then keep the expanded suites green to
prove the shared-envelope behavior. Run them with
`bun run test:scripts:file -- scripts/drift-ai/knip-duplicates.test.ts scripts/drift-ai/knip-orphan-files.test.ts scripts/drift-ai/knip-unused-exports.test.ts scripts/drift-ai/knip-pass-through-check.test.ts scripts/drift-ai/knip-runner.test.ts`.

## Scope / caveats

- **Implementation narrowing (2026-08-20): parts 1-3 only.** Part 4 is
  deliberately deferred because the prerequisite 2026-07-25 slice 34.2 is still
  unlanded: `scripts/drift-ai/knip-runner.ts:252` still declares the module-level
  `knipRunCache`, and `clearKnipRunCache` still exists at
  `scripts/drift-ai/knip-runner.ts:300-301`. This lane does not touch that cache,
  add a `WeakMap`, or add parsed-report memoization; a check-all run still performs
  three envelope parses over the shared string. Parts 1-3 stand alone as
  external-format contract centralization, not a performance fix.
- **A fully generic Knip issue-row model is out of scope.** The shared envelope plus
  a shared symbol/location item parser captures all the real duplication with far
  less abstraction, which is also the more copyable shape for a public harness
  reference. Do not let the extraction grow into a normalized union over all Knip
  categories.
- **Do not delete the per-category text-level parse functions.**
  `parseKnipUnusedExports` is called on raw file contents by
  `knip-unused-exports-report.ts:31` (consumed in turn by
  `class-construction-command.ts:62` and
  `coverage-unused-correlation-command.ts:55`) and by the standalone sensor at
  `sensor-knip-unused-exports-core.ts:227`. Narrowing the *plugin seam* to rows is
  the goal; removing the text entrypoints breaks callers outside the check pipeline.
- **Do not sell this as a performance fix.** The spawn is already deduplicated
  (`knip-runner.ts:273-293`), so part 4 saves two `JSON.parse` calls per check-all
  run — real, but marginal next to the Knip self-scan. If part 4 turns out to be the
  awkward part, parts 1-3 stand on their own.
- **Preserve the failure semantics exactly.** Empty output stays a *failure*
  (attempted-and-failed), a non-array `issues` stays a *success with zero rows*, and
  a parse failure stays a diagnostic finding rather than a skip
  (`knip-pass-through-check.ts:144-155`). Three different outcomes for three
  different malformed inputs; an extraction that collapses any two of them is a
  behaviour change.
- **Respect the injected-runner bypass if part 4 touches `knip-runner.ts`.** Runners
  injected via `env.overrides.knip` never pass through `memoizingDefaultKnipRunner`
  (`knip-runner.ts:246-248`), so tests stay their own source of truth; a
  parsed-report cache must inherit that property. If it needs a reset seam, note that
  `clearKnipRunCache` (`knip-runner.ts:297-299`) already has call sites across
  `scripts/drift-ai.test.ts`, `knip-runner.test.ts` and `knip-unused-exports.test.ts`
  — do not add a second test-named reset beside it.
- **Sequencing with the 2026-07-25 pack (CQ25-46).**
  [`34-PLAN.md`](../code-quality-2026-07-25/34-PLAN.md) slice **34.2** moves the raw
  Knip run memo out of the module-level `knipRunCache` into `env.reportCache` and
  deletes `clearKnipRunCache`. It is still unlanded — `knip-runner.ts:249` is a
  module-level `Map` today — and it never touches the parsers, so this leaf is
  genuinely novel against it. But both edit the same cache in the same file: land
  34.2 first if it is scheduled, then key part 4's parsed-report cache off whatever
  report-scoped structure 34.2 leaves behind, rather than adding a module-level
  `WeakMap` that 34.2 would have to relocate a second time.
- **Sequencing:**
  [163-ratchet-driven-file-boundaries-strand.md](./163-ratchet-driven-file-boundaries-strand.md)
  also edits `knip-runner.ts`. There is no logical ordering dependency, but do
  not work the two concurrently; whichever lands second must rebase on the
  runner surface left by the first. No other leaf in this pack is recorded as
  touching these files; if one later does work in
  `scripts/drift-ai/knip-*.ts`, sequence rather than parallelize because the
  extraction rewrites the top of all three adapters at once.
