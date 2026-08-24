# 142. Analyzer root entrypoints maintain pseudo-library facades instead of executable-only boundaries

Status: Landed on fix/cq-142
Theme: Entrypoints as executables · Area: harness · Severity: medium · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`scripts/code-intel.ts` is the front door of one of this repo's most-used
developer tools, and it is 132 lines long. Three of them do the work: import
`runCodeIntelCli`, then call it. Everything else exists to let the file *also*
be imported as a library — nine namespace type imports, a re-export block, a
module-record type, eleven forwarding functions, a `let`-declared class export
assigned only on one branch, a nine-module `Promise.all` loader, and a guard
that throws when the forwarders are called on the wrong branch.

Nobody imports it. Not one tracked TypeScript file in the repo references the
root module, and the last consumer that did — the 2,437-line
`scripts/code-intel.test.ts` — was deleted on 2026-07-07 when its suites were
split into co-located module tests that import `./definition-query.js`,
`./graph-queries.js` and friends directly. The facade survived the split because
knip treats `scripts/*.ts` as entry points, so unused exports there are never
reported: the dead surface is invisible to every automated check in the repo.

`scripts/drift-ai.ts` is the same boundary failure with a different consumer
profile. It describes itself as the executable surface, then selectively
re-exports CLI parsing, Git helpers, reducers, report formatting, scope
conversion, defaults, and low-level types from 23 internal module paths. No
production TypeScript consumer uses that facade; six tests do. Those tests are
the only reason the executable needs an import-safe entrypoint guard and a
second manually curated module boundary, whose omissions make the implied API
incoherent and whose exports suggest compatibility guarantees the documented
CLI does not promise.

The cost is paid by whoever next touches the CLI. To add a command you must
first work out that `const isCli = isCliEntrypoint(import.meta.url)` decides
whether the module is a program or a library, that `apiModules` is populated by
a top-level `await` on the *library* branch only, that `WorkspaceResolver` is an
exported binding that is genuinely `undefined` on the CLI branch, and that the
CLI's own `await runCodeIntelCli()` sits in the middle of the file between the
forwarders and the loader that supports them. None of that reasoning is about
code intelligence; all of it is about a library that does not exist. The
lookalike sibling makes the contrast plain: `scripts/code-intel-server.ts` does
the same job — shebang, one import, one `await` — in four lines. For a repo that
is meant to be read and copied as a harness-engineering reference, two sibling
entrypoints demonstrating opposite idioms is the wrong thing to hand a reader,
and the 132-line one is the one they will open first.

## Evidence

- `scripts/code-intel.ts:4-12` — nine `import type * as …Module` namespace
  imports (`definition-query`, `export-query`, `format`, `graph-queries`,
  `import-graph`, `overview-query`, `query-executor`, `runner`,
  `workspace-resolver`), used only to type the facade.
- `scripts/code-intel.ts:14-27` — value and type re-exports of
  `runCodeIntelCli`, the daemon protocol types,
  `CODE_INTEL_DAEMON_PROTOCOL_VERSION`, `CodeIntelError`, and four result types.
- `scripts/code-intel.ts:32-42` — the `CodeIntelApiModules` record type, one
  field per namespace import.
- `scripts/code-intel.ts:44-45` — `const isCli = isCliEntrypoint(import.meta.url)`
  followed by `const apiModules = isCli ? undefined : await loadCodeIntelApiModules()`:
  a top-level `await` on the library branch.
- `scripts/code-intel.ts:47-50` — `export let WorkspaceResolver` assigned inside
  `if (apiModules)`, so the exported binding is `undefined` whenever the file
  runs as a program.
- `scripts/code-intel.ts:52-86` — eleven forwarding functions
  (`queryDefinition`, `queryDefinitionsByName`, `queryExports`, `queryOverview`,
  `queryDependents`, `queryTests`, `formatCodeIntelQueryResult`,
  `buildImportGraph`, `executeCodeIntelQuery`, `runCodeIntel`,
  `createWorkspaceResolver`), each proxying through `requireCodeIntelApiModules()`.
- `scripts/code-intel.ts:88-90` — the actual program: `if (isCli) { await runCodeIntelCli(); }`,
  sandwiched between the forwarders and their loader.
- `scripts/code-intel.ts:92-125` — `loadCodeIntelApiModules`, a nine-module
  `Promise.all` of dynamic imports; `:127-132` — `requireCodeIntelApiModules`,
  which throws `"code:intel API exports are not available while running the CLI
  entrypoint."` Of the file's 132 lines, only `:1`, `:3` and `:88-90` survive if
  the facade goes.
- Zero importers, derived two ways at the pin: `git grep` for
  `code-intel.js` / `code-intel.ts` module specifiers across `*.ts`/`*.tsx`
  returns no import site, and
  `bun run code:intel -- dependents scripts/code-intel.ts` reports
  `0 results, depth=1`.
- Commit `96a6f04de` ("test(code-intel): split root suites by module",
  2026-07-07) deleted `scripts/code-intel.test.ts` (2,437 lines) and created the
  co-located suites; `scripts/code-intel/definition-query.test.ts:3-8` and
  `scripts/code-intel/graph-queries.test.ts:3-6` import their subjects from
  `./definition-query.js`, `./graph-queries.js`, `./errors.js` and
  `./runner.js`, never from the root file.
- `scripts/code-intel-server.ts:1-4` — the sibling entrypoint, four lines,
  shebang plus `await runServerCli()`, with no `isCliEntrypoint` guard.
- `knip.config.ts:51-55` — `entry` includes `"scripts/*.ts"`, so the facade's
  exports are entry exports and were never reportable as unused.
- `docs/guides/code-intel.md` documents only CLI invocations
  (`bun run code:intel -- …`); no doc, and no `package.json` script beyond
  `"code:intel": "bun scripts/code-intel.ts"` (`package.json:39`), advertises a
  programmatic surface.
- `scripts/code-intel/cli-main.test.ts:17-27` — the thin-front-door guard reads
  the root file, filters lines containing `from "./code-intel/runner.js"`,
  discards those starting with `import type ` / `export type `, and asserts the
  remainder is empty. Today the only match is the facade's own type import at
  `:11`; the scan machinery exists to see past the facade.
- `scripts/code-intel.ts:28` is the *only* reference to
  `scripts/lib/process-argv.js` anywhere under `scripts/code-intel*`, yet
  `scripts/tests/test-code-intel.sh:14` declares
  `# smoke-subjects: scripts/lib/process-argv.ts`.
- `docs/generated/lint-coverage-map.md:159` describes the file as
  `1 .ts (top-level facade)`; `:13-18` states the file has hybrid ownership —
  only the marker-delimited `scripts/drift-ai/*.ts` table is generated, "every
  other row and all policy prose remain hand-maintained".
- `scripts/drift-ai.ts:2-5` — the header says the executable surface stays in
  this file and imports `runDriftAi`; `scripts/drift-ai.ts:7-142` then contains
  27 export statements targeting 23 distinct internal module paths.
- `scripts/drift-ai.ts:16-21` exports `parseColdspotsArgs`, while the sibling
  `parseHotspotsArgs` is defined at `scripts/drift-ai/hotspots-args.ts:57` and
  absent from the facade, demonstrating that the export set has no consistent
  capability boundary.
- A repository-wide TypeScript search found exactly six facade importers and no
  production importer: `scripts/drift-ai.test.ts:7-34` imports 26 names, while
  `scripts/drift-ai/commented-out-code.test.ts:3`,
  `scripts/drift-ai/comments.test.ts:5`,
  `scripts/drift-ai/duplicates.test.ts:7`,
  `scripts/drift-ai/ghost-files.test.ts:5`, and
  `scripts/drift-ai/suppressions.test.ts:3` import only `ChangedFile` or
  `DriftFinding`.
- `scripts/drift-ai.test.ts:35-40` already imports other dependencies directly
  from their owning internal modules, so the same test currently mixes facade
  and direct-internal boundaries.
- `scripts/drift-ai.ts:143-149` retains `isCliEntrypoint` and the shared argv
  offset solely so importing the barrel does not execute the CLI.
- `scripts/drift-ai/README.md:120-134` documents package-script and direct
  entrypoint invocation, while `scripts/drift-ai/README.md:230-261` calls the
  JSON report the portable surface and describes running the entry script from
  a tools checkout; it does not advertise a TypeScript API.
- Production harness code already names internal owners directly:
  `scripts/harness/pre-push-scope-trigger.ts:19` imports
  `buildSourceExtensions` from `drift-ai/scope.js`, and
  `scripts/drift-triage/triage-report-drift-input.ts:1-3` imports metadata and
  types from their internal modules.

## Proposed direction

Implement this as two ordered slices in separate commits. The code-intel slice
lands first and establishes the executable-only template; the drift-ai slice
lands second and applies it after retargeting that facade's six test importers.

**Slice 1 — code-intel template.** Delete the facade outright and collapse
`scripts/code-intel.ts` to the shape of its sibling
`scripts/code-intel-server.ts`. Do **not** add a
`scripts/code-intel/api.ts`: the modules under `scripts/code-intel/` are already
direct, side-effect-free import targets (the split test suites prove it), no doc
or consumer advertises a programmatic API, and knip's `scripts/*.ts` entry rule
means these exports were never load-bearing for any check.

1. **Reduce the root file to an executable.** Shebang,
   `import { runCodeIntelCli } from "./code-intel/cli-main.js";`, and an
   unconditional `await runCodeIntelCli();`. Everything at `:4-12`, `:14-86` and
   `:92-132` goes, including the `isCliEntrypoint` import at `:28` and the
   `isCli` branch — with no importer, the guard has nothing to guard, and the
   server sibling already omits it. `scripts/lib/process-argv.ts` stays; 18
   other production TypeScript files still use it.
2. **Shrink the front-door test.** `scripts/code-intel/cli-main.test.ts:22-27`
   scans the root file for a runtime `runner.js` import and filters out
   type-only lines. The invariant it protects (the front door does not pull the
   heavy runner in eagerly; `cli-main.ts` does it behind
   `await import("./runner.js")`) is still worth pinning, but with the facade
   gone the type-line filtering is dead weight — assert on the whole file text
   instead. Keep the spawn-based `--help` and parse-error assertions at `:30-45`
   untouched; they are the real CLI contract.
3. **Correct the coverage-map entry.**
   The rendered row calls the file a "top-level facade" and its Notes column
   recounts the leaf-03f facade-lint adoption. Since leaf 111 the document is
   pure generator output: edit the entry in the typed manifest
   (`scripts/lint-coverage-map-manifest-<area>.ts` — find it by entry id, not by
   line number), then run `bun run docs:lint-coverage-map:generate` and confirm
   with `bun run docs:lint-coverage-map:check`. No ratchet baseline entry names this
   file, and the dedicated `ratchet/local-max-lines-code-intel` floor was already
   drained (`lint-ratchet.debt-log.jsonl:6`), so nothing else moves.
4. **Decide the stale smoke subject.**
   `scripts/tests/test-code-intel.sh:14` subjects `scripts/lib/process-argv.ts`,
   which after step 1 is no longer reachable from any code-intel file. Drop that
   header line and regenerate with `bun run test:scripts:subjects` (it rewrites
   `scripts/path-policy/path-policy-smoke-subjects-data.ts` and
   `scripts/fixtures/test-scripts/all-smoke-tests.txt`; commit both). The
   `scripts/code-intel.ts` subject at `:3` stays as is.

**Slice 2 — drift-ai application.**

5. **Retarget all six test importers before removing the facade.** The five
   detector tests at `scripts/drift-ai/commented-out-code.test.ts`,
   `comments.test.ts`, `duplicates.test.ts`, `ghost-files.test.ts`, and
   `suppressions.test.ts` should import `ChangedFile` and `DriftFinding` from
   `scripts/drift-ai/types.ts`. Split the 26-name import in
   `scripts/drift-ai.test.ts:7-34` among the canonical modules identified by the
   current facade: `check-metadata`, `inventory-by-dir`, `report-builder`,
   `scope`, `types`, `check-registry`, `git-changed-scope`, `errors`,
   `report-format`, `cli-args`, and `runner`. Use the facade's current export
   groups as the source-to-owner map rather than selecting an incidental
   re-export.
6. **Reduce the drift-ai root file to an executable.** Delete the re-export
   surface at `scripts/drift-ai.ts:7-142` and follow the
   `scripts/code-intel-server.ts:1-4` shape: shebang, an updated pure-executable
   comment, the `runDriftAi` import, and an unconditional call. `runDriftAi` is
   synchronous, so retain the existing stdout write and `exitCode` handling
   from `scripts/drift-ai.ts:146-148`. Remove `isCliEntrypoint` and
   `PROCESS_ARGV_USER_ARGS_START`; after the importer sweep they serve no
   caller.
7. **Do not introduce `scripts/drift-ai/api.ts`.** Its internal modules are
   already side-effect-free import targets used by production harness code, and
   the documented contract is the executable plus its report format. A new API
   module without a real consumer would only relocate the manual barrel.

Acceptance establishes one convention for both analyzer roots under
`scripts/*.ts`: entrypoints are executables, not barrels. Each root file must
contain zero `export` statements, and repository-wide searches for its root
module specifier must find no TypeScript importer. For code-intel,
`bun run code:intel -- def --name …` and
`bun run code:intel -- dependents …` must still work,
`bash scripts/tests/test-code-intel.sh` and
`bun run test:scripts:file -- scripts/code-intel/cli-main.test.ts` must pass.
For drift-ai, a search for TypeScript imports ending in `drift-ai.js` must return
no matches, `bun run drift:ai` must still execute through the verified root
script at `package.json:147`, and all six retargeted tests must preserve their
existing behavior. Run `bun run harness:check` after both slices to catch hidden
harness coupling.

## Scope / caveats

- **Keep two implementation commits.** Land the code-intel slice first as the
  cheaper template, then land the drift-ai slice after retargeting its six test
  importers. The shared convention and acceptance criteria do not turn these
  per-entrypoint implementations into one mixed commit.
- **Do not create a replacement API module.** The "if a supported API is
  intentional" branch of the original finding is resolved: it is not. Adding
  `scripts/code-intel/api.ts` or `scripts/drift-ai/api.ts` would recreate the
  maintained boundary this leaf deletes, and the internal modules are already
  the supported import targets.
- **The guard removal is the one-way part.** Once `isCliEntrypoint` is gone, any
  future import of either root runs its CLI at import time. That is the same
  contract `scripts/code-intel-server.ts` already has, but it makes each
  zero-importer check a precondition rather than a nicety. For code-intel, re-run
  `bun run code:intel -- dependents scripts/code-intel.ts` immediately before
  landing rather than trusting this note; for drift-ai, re-run the root-module
  import search after the six-test sweep.
- **Out of scope:** anything inside `scripts/code-intel/`. The layering, the
  daemon stack, the query modules and the workspace resolver are untouched; this
  leaf moves no logic, only deletes an unused wrapper around it. Renaming or
  relocating either root entrypoint is also out of scope —
  `scripts/test-changed.sh:231` pattern-matches `scripts/code-intel*.ts` and
  `package.json:39,41` bind both script names to these paths.
- **Do not delete the front-door test.** Step 2 shrinks its file scan; it must
  keep failing if someone reintroduces an eager runtime `runner.js` import into
  the entrypoint, because the lazy `await import("./runner.js")` inside
  `scripts/code-intel/cli-main.ts` is what keeps `--help` and parse errors fast.
- **Prior-pack overlap is clean.** The 2026-07-25 pack's code-intel work
  (CQ25-11, CQ25-65/66, CQ25-119) targets modules *inside* `scripts/code-intel/`
  only; that pack fixed the analogous entrypoint-API problem for `logs-audit.ts`
  but nothing was scheduled or declined for this root facade, and its
  "facade retained" rulings apply to other scripts and only pin entry paths
  during directory moves.
- **Preserve the prior drift-ai rulings.** CQ25-155 permanently rejected
  splitting the 2,765-line `scripts/drift-ai.test.ts`; its ruling in
  [34-PLAN.md](../code-quality-2026-07-25/34-PLAN.md) remains binding, so this
  work changes imports only and does not reopen describe-block layout. CQ25-146
  keeps `scripts/drift-ai/` flat, as recorded in
  [28-PLAN.md](../code-quality-2026-07-25/28-PLAN.md); do not create
  subdirectories or reorganize detector modules.
- **Drift-ai behavior remains out of scope.** Do not change `runner.ts`, detector
  behavior, CLI arguments, output formats, or report contracts. Retargeting 26
  names to the wrong owner is the primary mechanical risk: typechecking catches
  missing exports but not a non-canonical re-export, so map from the current
  facade groups.
- **No drift-ai coverage-map refresh is expected.**
  `docs/generated/lint-coverage-map.md:47-52` explicitly excludes root drift-ai
  entrypoints. The smoke-subject data names `scripts/drift-ai/` and
  `scripts/drift-ai/scope.ts`, not the root file, while
  `scripts/test-changed.sh:231` already matches `scripts/drift-ai.ts` by path and
  should continue to do so.
- **A `scripts/code-intel/MODULE.md` is proposed separately** in
  [147-major-harness-implementation-directories.md](./147-major-harness-implementation-directories.md),
  and it will describe `scripts/code-intel.ts` and `scripts/code-intel-server.ts`
  as the two external entrypoints. If that doc lands first, this leaf carries the
  one-line update to it; if this leaf lands first, the doc simply describes two
  four-line executables.
