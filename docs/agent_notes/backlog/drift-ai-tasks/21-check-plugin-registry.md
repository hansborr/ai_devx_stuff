# 21 — CheckPlugin registry + CheckOutcome union (the keystone)

Status: Done
Track: A (architecture / single report)
Size: medium
Depends on: 20 (path-util shared helpers)
Blocks: 22 (reporting trust pass), 30 (import-cycles plugin), 31 (knip adapter),
32 (near-duplicate plugin), 33 (any later plugin/adapter)

**The keystone.** Every other architecture/new-check task assumes this shape
exists. Do it right after task 20.

## Goal

Replace the bespoke per-check dispatch with a `CheckPlugin` registry and a
`CheckOutcome` union, so adding a check is **one file**, skip-reasons become
first-class (`{check, reason}[]`), and the `exactOptionalPropertyTypes`
conditional-spread noise dissolves by building the run context **once**.

## Background

Read [`01-shared-context.md`](./01-shared-context.md) and
[`02-seam-map.md`](./02-seam-map.md) first. Deeper rationale:
`../drift-ai-review/code-quality.md` High-2/High-3 and Med-2;
`../drift-ai-improvements.md` Part B (B2/B3) and "The unifying thesis."

Today a check call flows: build a `CheckContext` → `buildReport` →
`buildCheckRunnerContext` (rebuilds a near-identical context field-by-field) →
`CHECK_RUNNERS[check]` (each entry re-derives config, branches on scope, resolves
ignore globs via free helpers). `CheckContext` is an 11-field optional god-bag
passed whole to every check though `comments` needs only `readFile`. Adding a
check = ~8 edit sites across 5 files. This is the single highest-leverage
structural change, and it is the enabler the portability/adapter/new-check work
depends on: "what's portable" reduces to "what's in the default plugin array,"
and a check that needs an absent external tool can `skip` with a reason instead
of crashing or emitting a false finding.

## Target contract (agreed in the cross-pollination round)

This is the shape to build toward — copied from `../drift-ai-improvements.md`
Part B (B2):

```ts
type CheckOutcome =
  | { status: "ran"; findings: DriftFinding[] }
  | { status: "skipped"; reason: string };   // scope-N/A, missing binary, disabled

type CheckPlugin<C = unknown> = {
  id: DriftCheckId;
  usage: string;                              // CLI usage derives from the registry
  defaultConfig: C;
  parseConfig: (raw: unknown, keyPath: string) => C;   // each plugin owns its config block
  preflight?: (ctx: CheckRunContext) => string | undefined;  // returns a skip reason, or undefined
  run: (ctx: CheckRunContext, config: C) => CheckOutcome;     // never throws
};

const CHECK_PLUGINS = [duplicatesCheck, ghostFilesCheck, commentsCheck, suppressionsCheck];
```

`CheckRunContext` is the build-once context (compare the current `CheckContext`
god-bag at `report-builder.ts:21–34`). The code-quality note sketched it as:

```ts
type CheckRunContext = {
  detectorScope; config; roots; sourceExtensions; repoRoot;
  suppressionDiffRef: string | null;
  inventoryByDir: ReadonlyMap<string, readonly string[]> | undefined;
  warnStderr; deps: CheckDeps;   // jscpd, listDirectory, readFile, suppressionsGit
};
```

Grouping the injected runners under `deps` keeps the I/O seams (jscpd, listing,
readers, git) together and out of the data fields — but the exact grouping is an
open decision below.

## Seams to touch

Re-confirm anchors before editing (source has drifted from the seam map — grep
the symbol name).

From seam-map **§2 (Check dispatch)** — the bulk of the work:
- `report-builder.ts:38–95` — `CHECK_RUNNERS` record (duplicates 38–62,
  ghost-files 63–77, comments 78–85, suppressions 86–94). Each entry becomes a
  plugin's `run`.
- `report-builder.ts:21–34` — `CheckContext` god-bag → becomes `CheckRunContext`,
  built once.
- `report-builder.ts:124–148` — `buildCheckRunnerContext` (the per-check rebuild)
  → **deleted**; context is built once in `buildReport`.
- `report-builder.ts:150–186` — `buildReport` orchestrator → becomes:
  build context once → for each requested plugin, run `preflight`, then `run`,
  collect `CheckOutcome`s → flatMap `ran` findings, collect `skipped` reasons.
- `report-builder.ts:97–102` — `IMPLEMENTED_CHECKS` → derived from `CHECK_PLUGINS`.
- `report-builder.ts:188–191` — `checkRunsForScope` (suppressions skipped in
  current) → folds into the suppressions plugin's `preflight`.
- `types.ts:3` (`DriftCheckId` union) + `types.ts:5–10` (`ALL_CHECKS`) → derive
  `ALL_CHECKS` from `CHECK_PLUGINS.map(p => p.id)` (keep the canonical order =
  registry order).
- `types.ts:29–40` — `DriftReport`: change `skippedChecks` (`:37`) from
  `readonly DriftCheckId[]` to `readonly { check: DriftCheckId; reason: string }[]`.
- `types.ts:30` — `schemaVersion: 1` literal type → type it as the new constant
  (below). Note the chunk types also pin it: `DriftFindingChunk.schemaVersion`
  (`types.ts:43`) and `DriftChunkManifest.schemaVersion` (`types.ts:63`).
- **`schemaVersion` literal `1`** at all six sites: `types.ts:30,43,63`,
  `report-builder.ts:175`, `chunks.ts:23` (chunk) and `chunks.ts:47` (manifest).
  Replace all with one constant. (`report-format.ts` does not emit the version.)

From seam-map **§1 (Entry / dispatch)** for the runner wiring:
- `runner.ts:81–122` — `runDriftAi`; the report-build call site that today passes
  the flat option bag → pass the single built context / plugin loop.
- `runner.ts:108–112` — `warnForUnsupportedDuplicateExtensions` call (defined
  `runner.ts:160–173`). **Fold this into the duplicates plugin's `preflight`** so
  the "unsupported extension" case becomes a normal skip-or-warn path, not a
  side-channel call in the runner (see open decision).
- Keep the `harness-freshness` subcommand branch (`runner.ts:82–84`) and
  `runHarnessFreshnessSubcommand` (`runner.ts:124–150`) **outside** the registry —
  it has a distinct subcommand surface and finding type (`HarnessFreshnessFinding`).

Config parsing (seam-map §10 references `config*`):
- `parseChecksConfig` (in `config.ts`/`config-parsing.ts`) → becomes a registry
  loop: for each plugin, call `plugin.parseConfig(raw[plugin.id], "checks." +
  plugin.id)` (or a shared parser — see open decision).

CLI:
- `cli-args.ts:24–39` — usage text and the "unknown check" error → derive from
  `CHECK_PLUGINS` (`usage` field + `id` list) instead of hardcoded strings.

Schema constant (Med-2):
- Add `export const DRIFT_SCHEMA_VERSION = 1 as const` in a sensible home
  (`types.ts`), type `DriftReport.schemaVersion` as `typeof DRIFT_SCHEMA_VERSION`,
  and reference it at every literal-`1` site listed above. **Bump it** to `2` for
  the new report shape (`skippedChecks` is now `{check, reason}[]`).

## What to do

1. Define `CheckOutcome`, `CheckPlugin`, and `CheckRunContext` (the build-once
   context). Decide the `deps` grouping (open decision).
2. Convert each of the four current `CHECK_RUNNERS` entries into a plugin module
   (`duplicates`, `ghost-files`, `comments`, `suppressions`), each exporting a
   `CheckPlugin`: `id`, `usage`, `defaultConfig`, `parseConfig`, optional
   `preflight`, `run`. `run` returns a `CheckOutcome` and **never throws** — wrap
   any failure into a `skipped` reason or let it surface as today's behavior, but
   not as an uncaught throw inside the loop.
   - `suppressions.preflight` returns a skip reason in `current` scope (replacing
     `checkRunsForScope`).
   - `duplicates.preflight` folds in the unsupported-extension warning (see open
     decision for how it reports that case).
3. Build `CHECK_PLUGINS` in canonical order; derive `ALL_CHECKS` /
   `IMPLEMENTED_CHECKS` from it.
4. Rewrite `buildReport`: build `CheckRunContext` **once**; for each requested
   plugin run `preflight` (skip with reason if it returns one), else `run`;
   flatMap `ran` findings into `report.findings`, push `{check, reason}` for each
   `skipped`/preflight-skip into `report.skippedChecks`.
5. Delete `buildCheckRunnerContext` and the four free ignore-glob helpers it fed;
   their logic moves into the plugins or the single context build. This is what
   dissolves the High-3 conditional-spread noise (the
   `...(x === undefined ? {} : { x })` re-spreads at `report-builder.ts` and
   `runner.ts:64–70` go away because the context is built once). For any optional
   that remains, prefer explicit-`null` modeling (as
   `PreparedRun.suppressionDiffRef: string | null` already does) — do **not**
   relax `exactOptionalPropertyTypes`.
6. Make `parseChecksConfig` a registry loop; make `cli-args` usage and the
   "unknown check" error derive from the registry.
7. Add `DRIFT_SCHEMA_VERSION`, bump to 2, reference everywhere.

## Open decisions

- **Where `parseConfig` lives.** On the plugin (per the contract) vs. one shared
  parser the plugins parameterize. *Recommend on the plugin* — it is the whole
  point of "adding a check is one file" — but allow plugins to call a shared
  primitive parser for common shapes (e.g. min-lines, exclude-prefixes) so each
  `parseConfig` stays a few lines.
- **How `preflight` reports the duplicates "unsupported extension" case.** Today
  it is a `warnForUnsupportedDuplicateExtensions` stderr warning, *not* a skip
  (the check still runs on the supported subset). Options: (a) keep it as a
  stderr warning issued from inside `preflight`/`run` via `ctx.warnStderr`, and
  return `undefined` (not a skip) so the check still runs; (b) model it as a
  partial-skip. *Recommend (a)* — it is a warning about a subset, not a
  whole-check skip; a whole-check `skipped` reason should be reserved for "this
  check did not run at all" (scope-N/A, missing binary). Document the chosen
  semantics in the plugin.
- **`deps` grouping shape.** Group injected runners under `ctx.deps`
  (jscpd/listDirectory/readFile/suppressionsGit) vs. flat fields. *Recommend
  grouped* — keeps I/O seams together and makes "which deps does this check use"
  explicit per plugin. Escalate if it forces awkward optionals at the build site.
- **Does `run` ever throw?** Contract says never. *Recommend* a thin guard in the
  loop that converts an unexpected throw into a `skipped` reason
  (`"check errored: <message>"`) so one check can't abort the whole report — but
  only if it doesn't mask real bugs in tests. Discuss before adding broad
  catch-alls.

## Testing

- Existing per-check tests adapt to the plugin shape (call `plugin.run(ctx,
  config)` and assert on the `CheckOutcome`). Keep them behavior-focused with the
  existing DI fakes (`FileReader`, `GitRunner`, `JscpdRunner`, `ListDirectory`) —
  **no `vi.mock`**.
- **Add coverage for a skipped outcome**: `suppressions` in `current` scope →
  `{ status: "skipped", reason }` from `preflight`, and assert the JSON
  `skippedChecks` carries `{ check: "suppressions", reason }` (not a bare string).
- Assert `ALL_CHECKS` / CLI usage / the "unknown check" error all derive from the
  registry (e.g. adding a fake plugin in a test surfaces in usage) — or at least
  that the registry is the single source.
- Assert `DRIFT_SCHEMA_VERSION` is referenced (no stray literal `1`) and the
  emitted report carries the bumped version.
- **Do NOT** add a test for `buildCheckRunnerContext` — it is deleted here.
- Run the full drift-ai suite + `bun run verify:changed` with changes staged.
- This task changes only the architecture, not what each check finds: validate
  behavior is unchanged by re-running current scope on OpenClaw (read-only, per
  01-shared-context) and confirming the same findings are produced (exit 0).

## Done notes

Landed as a registry-centered refactor with `CHECK_PLUGINS` in canonical order,
`CheckRunContext` built once by the runner, per-check plugin modules for
duplicates / ghost-files / comments / suppressions, and `CheckOutcome` skip
reasons in `DriftReport.skippedChecks`.

Schema version is now `DRIFT_SCHEMA_VERSION = 2`; report, chunk, and manifest
schema fields reference the shared constant. Text output renders structured
skips as `check (reason)` so JSON shape changes do not leak as `[object Object]`.

Config parsing now loops over the check registry while parser primitives live in
leaf helpers to avoid a runtime cycle. `types.ts` intentionally keeps the
`DriftCheckId` type leaf-local while runtime `ALL_CHECKS` is derived from
`CHECK_PLUGINS`.

Validation: full drift-ai Bun test set passed; `bun run typecheck` passed;
OpenClaw current-scope smoke exited 0 with schema 2, 14,923 scoped files, 360
findings (20 duplicates, 329 ghost-files, 11 comments), and suppressions skipped
with reason `not run for current scope`.

## Out of scope

- **Rendering** the skip reasons in text/JSON, the findings-first JSON, summary,
  chunk-label, and same-file-clone fixes — all task 22 (which consumes this
  task's `CheckOutcome`/`{check,reason}[]`/schemaVersion bump).
- Any **new** checks (import-cycles 30, knip 31, near-duplicate 32).
- Folding `harness-freshness` into the registry — it stays a separate subcommand.
- The shared lexer (Med-4), shared `harness-freshness` renderer/reader (Med-1),
  re-splitting module pairs (50/Med-3) — separate tasks.
