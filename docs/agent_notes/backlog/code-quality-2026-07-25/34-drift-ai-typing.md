# 34. drift-ai and drift-triage carry their internal contracts as free-form records, untyped string sets, positional params, and per-adapter copies

Status: Proposed — not promoted
Theme: implicit contracts in the drift script family · Area: harness · Severity: medium · Size: XL

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

The `scripts/drift-ai` / `scripts/drift-triage` family grew by copy-and-extend, and the
seams between its modules were never given names. Each new check, adapter, or triage
axis re-derives what the previous one already knew, in five recurring shapes:

- A reader reaches into an intentionally shapeless `details` record with a bare string
  key, so the one structured fact that gates a CLI exit code is untyped.
- Classification sets over drift check ids are declared as `Set<string>`, and one of
  them is declared twice with identical contents in two files that already import each
  other's neighbours.
- Four external-tool adapters each keep their own near-verbatim copy of the same
  timeout/error-code/spawn-options plumbing.
- Two hot paths thread five and six positionals that are already exactly an existing
  object type — and one of them re-materializes that object literally, one call deeper.
- drift-triage hand-writes 606 lines of `isString`/`isNumber` guards that restate,
  field by field, 112 lines of input interfaces — in a directory that already depends
  on zod.

Individually each is small. Together they are why adding a drift check touches more
files than it should, and why nothing but a test catches a wrong key or a swapped
positional. One further symptom sits on the test side: `scripts/drift-ai.test.ts` is a
2,765-line file organized around the barrel rather than around the modules, so
`runner.ts` and `cli-args.ts` have no colocated test at all.

## Evidence

- `scripts/drift-ai/types.ts:60-71` — `DriftFinding.details?: Readonly<Record<string, string | number | boolean | readonly string[]>>`, with the comment at `:66-70` documenting the shapelessness as deliberate ("Populated per-check, not universally … readers must treat it as optional and never assume a shape across checks").
- `scripts/drift-ai/runner.ts:191` — `finding.details?.["typeOnly"] !== true`, the gate behind `--fail-on-runtime-cycles`; and `scripts/drift-triage/triage-report-support.ts:232` — the only other production read. Both read the same key on the same check (`import-cycles`); every other `details?.[…]` hit under `scripts/` is a test assertion. 13 sites write `details`.
- `scripts/drift-triage/MODULE.md:84-94` ("Drift-AI Contract And Direction Law") — triage may import exactly five drift-ai modules (`types.ts`, `check-metadata.ts`, `scope.ts`, `prototype-advisory.ts`, `scan-provenance.ts`); growing that list needs a reviewed ruling. The live imports match (`triage-report-contracts.ts:1-5`, `triage-report-drift-input.ts:1-3`, `triage-report-summary.ts:1-2`, `triage-report-support.ts:1`, `triage-report-types.ts:1-3`), and two of them are runtime, not type-only (`ALL_CHECKS`, `DEFAULT_CHECKS`, `DRIFT_SCHEMA_VERSION`).
- `scripts/drift-triage/triage-report-contracts.ts:7-15` vs `scripts/drift-ai/types.ts:60-75` — the two sides read *different* finding types: triage's `DriftFindingInput` has `check: string` and `details?: Readonly<Record<string, unknown>>`; drift-ai's `DriftFinding` has `check: DriftCheckId` and a narrowed details value union. Neither is assignable to the other, so any shared accessor must be typed structurally.
- `scripts/drift-ai/knip-runner.ts:249` — module-level `const knipRunCache = new Map<string, KnipRunResult>()`, read at `:287` and written at `:290`, with a `clearKnipRunCache()` reset seam at `:297`.
- `scripts/drift-ai/report-builder.ts:44` — production is forced to call `clearKnipRunCache()`; three lines later `:47` builds `reportCache: new Map<string, unknown>()` on `CheckServiceEnv`, the report-scoped container the memo wants.
- `scripts/drift-ai/parsed-source-cache.ts:72-81` — `parsedSourceFileCacheForReport(env.reportCache)`, existing precedent for exactly that pattern.
- `scripts/drift-ai/knip-pass-through-check.ts:107-114` — `memoizingDefaultKnipRunner` is constructed with `env` in scope, refuting the module-global's stated justification at `knip-runner.ts:241-244` ("must outlive a single plugin's resolveServices call").
- `scripts/drift-triage/triage-report.ts:51` and `scripts/drift-triage/triage-report-support.ts:184` — `const CLONE_CHECKS = new Set(["duplicates", "near-duplicates"]);`, declared twice, identical.
- `scripts/drift-triage/triage-report.ts:33,43` — `REVIEW_FIRST_CHECKS` and `MAINTENANCE_CHECKS` inferred as `Set<string>`, while `triage-report-drift-input.ts:1-2` already imports `DriftCheckId` and `ALL_CHECKS`.
- `scripts/drift-ai/duplicates-runner.ts:150` / `knip-runner.ts:225` / `semgrep-runner.ts:298` / `dolos-runner.ts:290` — four copies of `isTimeoutResult` sharing the same `ETIMEDOUT` probe and the same `/\b(?:ETIMEDOUT|timed out|timeout)\b/iu` regex; `hasErrorCode` repeats verbatim at `:156`/`:231`/`:308`/`:300` (the record predicate it calls is already shared: all four import `isRecord` from `../lib/records.js`), and each file re-declares the same `Pick<SpawnSyncReturns<string>, "error"|"status"|"stdout"|"stderr"|"signal">` seam and the same spawn options block.
- `scripts/drift-ai/tool-bin.ts` — `resolveToolBin`, the precedent: executable resolution was already folded out of those same four adapters.
- `scripts/drift-ai/duplicates-runner.ts:202-209` and `:223-230` — `runCurrentDuplicatesCheck(options, minLines, minTokens, mode, ignoreGlobs, supportedExtensions)` and `runDuplicateScopes(scopes, runner, minLines, minTokens, mode, ignoreGlobs)`, six params each; `{minLines, minTokens, mode, ignoreGlobs}` is exactly `Omit<JscpdRunnerInput, "scopePath">` (`:41-47`), and `:233-239` rebuilds that object literally.
- `scripts/drift-ai/report-output.ts:54-60` and `:61-68` — `groupFindingsForChunks` and `buildChunkManifest` called with 5 and 6 unpacked `DriftReport` fields from inside a function that already holds the whole `report`.
- `scripts/drift-triage/triage-report-input.ts:287-305` — hand-rolled `isString`/`isNumber`/`isBoolean`/`isNullableString`/`isNullableNumber` (`isRecord` comes from `scripts/lib/records.js`, imported at `:1`); the guard layer is `triage-report-input.ts` (305 lines) + `triage-report-drift-input.ts` (160) + `triage-verdict-input.ts` (141), restating `triage-report-contracts.ts` (112 lines) field by field, e.g. `SemgrepRowInput` (contracts `:45-63`) vs `parseSemgrepHeader` (input `:61-88`), `DolosRowInput` (contracts `:72-83`) vs input `:114-168`.
- `scripts/drift-triage/drift-triage-options.ts:1` — already imports zod, in this same directory.
- `scripts/drift-ai.test.ts:1262-2554` — one `describe("runDriftAi")` spanning 1,293 lines of a 2,765-line file that imports 26 symbols from `./drift-ai.js`; `scripts/drift-ai/` holds 104 colocated test files (25,368 lines) but no `runner.test.ts` and no `cli-args.test.ts`, so `runner.ts` (271 lines) and `cli-args.ts` (229 lines) are covered only through the barrel.
- `scripts/drift-ai.ts:143-149` — the barrel is not a pure re-export; it also holds the CLI entrypoint guard.

## Proposed direction

Each numbered step is one commit, ordered cheapest-first; steps 1-5 are independent of
each other and can be reordered or dropped individually.

1. **One named key plus one structurally-typed accessor for the `typeOnly` fact.** The
   writer (`scripts/drift-ai/import-cycles.ts:187-208`, `cycleFinding`) and the two
   production readers (`scripts/drift-ai/runner.ts:191`,
   `scripts/drift-triage/triage-report-support.ts:229-235`) share only the bare string
   `"typeOnly"`. Two constraints decide where the accessor goes and what it accepts:

   - **Home:** put the key constant and the predicate in `scripts/drift-ai/types.ts` — a
     leaf module (its only import is `import type … from "./scope.js"`) that is inside
     drift-triage's five-module forward contract and that triage already imports at
     *runtime* (`triage-report-drift-input.ts:3` imports `DRIFT_SCHEMA_VERSION`).
     `scripts/drift-ai/check-metadata.ts` is an equally contract-legal alternative if a
     check-scoped home reads better. Do **not** export it from
     `scripts/drift-ai/import-cycles.ts`: that module is outside the contract and pulls
     the module-graph adapter, so importing it from triage would breach the direction law
     documented in `scripts/drift-triage/MODULE.md:84-94` ("Drift-AI Contract And
     Direction Law", plus the closing gotcha requiring a reviewed ruling update to grow
     the list).
   - **Signature:** it cannot take `DriftFinding`. Triage never holds a `DriftFinding`; it
     holds its own `DriftFindingInput` (`scripts/drift-triage/triage-report-contracts.ts:7-15`)
     whose `check` is `string` and whose `details` is `Readonly<Record<string, unknown>>`,
     neither of which is assignable to `DriftFinding`'s `DriftCheckId` /
     `Readonly<Record<string, string | number | boolean | readonly string[]>>`. Declare
     the parameter as the structural minimum both satisfy:

     ```ts
     export const TYPE_ONLY_CYCLE_DETAIL_KEY = "typeOnly";
     export function isTypeOnlyCycleFinding(finding: {
       readonly check: string;
       readonly details?: Readonly<Record<string, unknown>>;
     }): boolean;
     ```

   Body: `finding.check === "import-cycles" && finding.details?.[TYPE_ONLY_CYCLE_DETAIL_KEY] === true`.
   The two readers differ in polarity — the runner gates on `!== true` (fail closed) and
   triage defers on `=== true` — so the predicate states "this is a type-only cycle" and
   callers negate; do not fold either caller's surrounding policy (the runner's
   skipped-check fail-closed branch at `runner.ts:187-189`, triage's
   `policy.includeTypeOnlyCycles`) into it. Have `cycleFinding` write the constant too.
   Leave `DriftFinding.details` open and leave its `types.ts:66-70` comment intact.
   Test-first: the existing `--fail-on-runtime-cycles` cases in `scripts/drift-ai.test.ts`
   and the type-only deferral cases in `scripts/drift-triage/triage-report.test.ts` are
   the red/green harness.
2. **Move the knip memo into `env.reportCache`.** Read
   `docs/agent_notes/finished_work/drift-ai-knip-cache-report-boundary.md` first: it
   records why the clear lives in `buildReport` and names the fake-`node_modules/.bin/knip`
   test that proves both halves of the invariant (selected knip checks share one spawn
   within a report; separate report builds re-spawn). That test is this step's acceptance
   criterion. Then, in `scripts/drift-ai/knip-pass-through-check.ts:107-114`, pass
   `env.reportCache` into `memoizingDefaultKnipRunner`; in
   `scripts/drift-ai/knip-runner.ts`, key the memo off that map instead of the
   module-level `Map` at `:249`; delete `clearKnipRunCache` and its forced call at
   `scripts/drift-ai/report-builder.ts:44` along with the now-stale comment above it.
   Mirror `parsed-source-cache.ts:72-81`. Keep the injected-runner bypass documented at
   `knip-runner.ts:246-248`.
3. **Type and de-duplicate the triage classification sets.** Hoist the single
   `CLONE_CHECKS` into `scripts/drift-triage/triage-report-support.ts` (delete the copy
   at `triage-report.ts:51`, import it), and check the *contents* of all three sets —
   `REVIEW_FIRST_CHECKS`, `MAINTENANCE_CHECKS`, `CLONE_CHECKS` — against `DriftCheckId`
   by writing them as `const REVIEW_FIRST_CHECKS: ReadonlySet<string> = new Set<DriftCheckId>([…])`.
   The literal array is what catches a typo'd id; the `ReadonlySet<string>` annotation is
   load-bearing. Do **not** annotate the variables as `ReadonlySet<DriftCheckId>`: triage's
   `finding.check` is `string`, so `.has()` would stop compiling at
   `triage-report.ts:133,137,272,273` and `triage-report-support.ts:218`.
4. **Pass the objects that already exist.** In
   `scripts/drift-ai/duplicates-runner.ts`, replace the four threaded scalars with the
   `Omit<JscpdRunnerInput, "scopePath">` object those functions already reassemble at
   `:233-239`; in `scripts/drift-ai/report-output.ts:54-68`, pass `report` (or a named
   slice of it) to `groupFindingsForChunks` / `buildChunkManifest` rather than unpacking
   five and six fields at the call site.
5. **Extract a bounded-subprocess kernel.** New module under `scripts/drift-ai/`
   (sibling to `tool-bin.ts`) owning: the shared spawn-result `Pick<…>` seam, the
   `{cwd, encoding, stdio, maxBuffer, timeout, killSignal}` option block,
   `isTimeoutResult`, and `hasErrorCode` — which imports the shared `isRecord` from
   `scripts/lib/records.js` rather than re-declaring the predicate. Migrate one adapter
   per commit — `duplicates-runner.ts`, `knip-runner.ts`, `semgrep-runner.ts`,
   `dolos-runner.ts` — running that adapter's colocated tests each time. The kernel
   returns a classified result; **exit-code interpretation and tool-unavailable
   classification stay per-adapter** (see caveats).
6. **Split the barrel test.** Move all three runner suites out of
   `scripts/drift-ai.test.ts` into a colocated `scripts/drift-ai/runner.test.ts`:
   `describe("runDriftAi")` (`:1262-2554`), `describe("runDriftAi --fail-on-runtime-cycles gate")`
   (`:2555-2687`) and `describe("runDriftAi HARNESS_DIAGNOSTICS_OUTPUT sidecar")`
   (`:2688-2765`); move `describe("parseArgs")` (`:315-468`) into
   `scripts/drift-ai/cli-args.test.ts`. Import the modules directly rather than the
   26-symbol barrel. Leave in `scripts/drift-ai.test.ts` only what genuinely tests the
   barrel and its CLI entrypoint guard at `scripts/drift-ai.ts:143-149`. Steps 1 and 6
   both touch this file: if step 1 lands first, the cases it adds to the
   `--fail-on-runtime-cycles` suite move with that suite here.
7. **Port drift-triage's input narrowing to zod** — the largest and last step, only
   worth starting once 1-6 have landed. Replace `triage-report-contracts.ts` interfaces
   with zod schemas and derive the types from them (repo convention: schema is the
   contract, types are derived); delete the guard bodies in `triage-report-input.ts`,
   `triage-report-drift-input.ts`, `triage-verdict-input.ts`, leaving the shared
   `isRecord` import from `scripts/lib/records.js` alone. Do it schema-by-schema with the
   existing tests green at every step, preserving the behaviours listed under caveats.

## Scope / caveats

- **The drift-triage → drift-ai direction law binds every step here.** Triage's forward
  contract is exactly five modules (`scripts/drift-triage/MODULE.md:84-94`); the reverse
  direction is ESLint-enforced (`driftDirectionLawConfigs` in
  `eslint-config/script-configs.js:11`). Step 1 must land inside that contract rather than
  grow it, and steps 3 and 7 must not introduce a new drift-ai import either. If some
  future step genuinely needs a sixth module, that is a separate reviewed ruling update,
  not a side effect of this leaf.
- **Anything shared across the drift-ai/drift-triage seam must be typed structurally.**
  The two directories model a finding with two different types (see Evidence); a helper
  declared over `DriftFinding` is simply not callable from triage. This applies to step 1
  and to any helper step 7 might want to share with drift-ai.
- **Do not turn `DriftFinding` into a per-check discriminated union.** There are exactly
  two production reads of `details`, both of the same key on the same check, against 13
  writers. A `DriftFindingDetailsByCheck` map plus a 16-arm union would have to thread
  through the generic `TExtra` merge in `scripts/drift-ai/duplicate-shapes.ts:240` (four
  checks feed it via `detailsForGroup`) to protect two call sites, and it would contradict
  the deliberate open-extension-point contract documented at `scripts/drift-ai/types.ts:66-70`.
  Step 1 is the whole fix.
- **Do not collapse `check-metadata.ts` and `check-registry.ts` into one registry.** The
  split is deliberate, documented at `scripts/drift-ai/check-metadata.ts:1-6` (CLI/config
  code must enumerate checks without loading jscpd/knip/ts-morph adapters), and
  test-enforced: `scripts/drift-ai/check-metadata.test.ts:17` asserts the two id orders
  are equal on purpose, and a second suite in the same file walks transitive relative
  value imports to prove the lightweight surface never pulls in a runtime adapter. Do not
  resolve that order assertion by merging the registries.
- **Do not fold triage's category/priority sets into drift-ai's check descriptors.**
  `REVIEW_FIRST_CHECKS` (priority) and `MAINTENANCE_CHECKS` (category) are two
  independent axes that overlap on four ids; pushing them into the producer would put
  consumer policy in the producer and still need two fields. Step 3 is scoped to typing
  and de-duplication only.
- **The subprocess kernel must not unify exit-code policy.** The four adapters differ
  exactly where it matters: jscpd treats a non-zero exit as failure, while
  `scripts/drift-ai/knip-runner.ts:212-215` documents that a non-zero exit is knip's
  normal success case, and only semgrep and dolos classify `ENOENT` as
  tool-unavailable. If the kernel absorbs those decisions it will silently flip
  skip-vs-finding behaviour. Keep them as per-tool policy passed into the kernel.
- **Leave `scripts/drift-ai/config-readers.ts:10-12` out of step 5.** It is a second copy
  of `scripts/lib/records.ts:13-15` with six importers (`semgrep-output.ts:8`,
  `semgrep-rule-manifest.ts:10`, `dead-code-corpus-labels.ts:5`, `clone-corpus.ts:16`,
  plus `semgrep-runner.ts:14` and `dolos-runner.ts:10`). Step 5 removes the two runners'
  only use of it, so the adapters stop reaching that copy on their own. Collapsing the
  remaining four — by making `config-readers` re-export `scripts/lib/records.js`, not by
  deleting its export — is a separate one-line item.
- **Three subtleties the zod port must preserve** (step 7), each worth a test before the
  change: the per-kind parsers (`parseDriftReport` in `triage-report-drift-input.ts:14`,
  `parseSemgrepAdvisory` `:31-35`, `parseDolosAdvisory` `:108-112`) return `null` so
  `parseTriageInput` (`:19-29`) can fall through to the next report kind, while
  `parseTriageInput` itself never returns `null` — it throws `input is not a supported
  drift report, …` once every kind has been tried (`:26-28`) — and `parseAdvisory` throws
  `malformed <subcommand> advisory field X` once kind/lane/subcommand match (`:175-191`,
  `:274-276`); section/row errors carry user-visible index positions
  (`:245,251,259,266`); and numeric acceptance is narrower than `number` on both sides of
  the port — the local `isNumber` (`:291-293`) rejects non-finite values and so does zod
  4's `z.number()` (verified on zod 4.4.3), so plain `z.number()` preserves it, but the
  non-negative-integer bound on `totalCandidates` lives in `parseAdvisorySections`
  (`:264-268`), not in a guard, and has to be re-expressed explicitly.
- **This leaf is XL and should almost certainly be split before scheduling.** Step 7 alone
  replaces 606 lines of hand-rolled guards across three files with zod schemas derived
  from a 112-line contracts module, and step 6 alone re-homes 1,658 lines of test out of a
  2,765-line barrel test; either is a leaf-sized item on its own. Step 2 (knip cache) and
  step 6 (test split) also share only the area, not the cause. The coherent "name the
  contract" thread is steps 1, 3, 4 and 5; carve 2, 6 and 7 out as separate items unless
  there is capacity for the whole thing.
- Update `scripts/drift-triage/MODULE.md` alongside steps 3 and 7 (see
  `docs/guides/add-module-doc.md`). Run focused tests with
  `bun run test:scripts:file -- <file>` while iterating. If any step changes drift CLI
  usage strings or other generated harness surfaces, run `bun run harness:check` before
  committing.
