# 35. code-intel and logs-audit carry structure by convention: two duplicate workspace caches, an optional-dependency bag, unions re-narrowed with impossible throws, and core types stranded in a CLI entrypoint

Status: Scheduled work landed 2026-08-01 on `fix/cq-harness-h18-h19` (merge
`57ef569e5`) — H18 (`d65612bd2`; hardened `a99c7c3f9`, simplified
`ba4636886`, tested `ac1f8a533`, polished `42d877830`) and H19 (`f687b65e4`);
H20 and H21 remain optional and unstarted
Theme: module boundaries that do not match where the types live · Area: harness · Severity: medium · Size: L

Source: codebase quality audit 2026-07-25 · Confidence: high

Future note (unscheduled): `CodeIntelQueryResult`'s `"results"` arm re-widens the
narrowed query outputs to `IntelResult[]`. That is why formatting needs an out-of-band
`commandKind` and daemon IPC needs handwritten command/discriminator correlation.
Correlating command and result in the type could remove both, but exceeds H18.

## Problem

In both of these `scripts/` tools the module boundary was drawn in a different place
from the types, so every consumer re-derives what a type could have carried.

In `scripts/code-intel` the duplication is structural. `GraphCache` and `ProjectCache`
share four of their five private fields (`current`/`computeManifest`/`rebuild`/`repoRoot`),
the same options-defaulting constructor shape, and a byte-for-byte identical `ensure()`;
`ProjectCache` adds `buildReferenceProject` on top and imports the *same*
`computeWorkspaceManifest` from `graph-cache.ts`. The daemon instantiates both, and each
one independently owns the full manifest walk (every workspace source file, tsconfig,
package.json, `bun.lock`, git HEAD) and its own `createWorkspaceResolver`. A daemon
serving a mixed workload therefore keeps two resolvers alive and re-walks and re-hashes
the whole workspace once per cache rather than once per manifest, and `GraphCache`'s
rebuild constructs a full-workspace ts-morph `Project` whose construction is identical to
the `graphProject` `ProjectCache` is already holding. Above that sits `CodeIntelContext`, a
bag of seven optional fields where the same conceptual dependency is resolved from a
different field depending on which command you are running, and every field has a silent
`??` tail that rebuilds it from disk when absent. Nothing in the type connects a command
to the field set it actually reads, so a context filled for the wrong command still
compiles and quietly pays for a full-workspace rebuild instead of failing. And below it,
five query paths each produce exactly one arm of a five-arm union but hand back the whole
union, which is then re-narrowed downstream by seven formatters that all open with an
unreachable `throw`, plus an `emptyResultLine` that recovers the result kind by
string-prefix-matching a header the caller had just built with a template literal.

`scripts/logs-audit` has the same disease in a different organ: the core types live in
the executable CLI file (`#!/usr/bin/env bun`, top-level side effect at the bottom), and
five submodules import them back out of it, creating a type-graph back-edge that one of
them has a comment apologizing for. The barrel named `logs-audit-checks.ts` contains no
checks, and `JsonObject` is re-declared identically in four files.

## Evidence

- `scripts/code-intel/graph-cache.ts:27-45` and `scripts/code-intel/project-cache.ts:39-59` — same `current`/`computeManifest`/`rebuild`/`repoRoot` fields, same options-defaulting constructor, identical `ensure()` bodies.
- `scripts/code-intel/project-cache.ts:6` — `import { computeWorkspaceManifest } from "./graph-cache.js"`: both caches fingerprint the workspace with the same sha256 walk.
- `scripts/code-intel/graph-cache.ts:150-158` and `scripts/code-intel/project-cache.ts:73-86` — both rebuilds call `createWorkspaceResolver(repoRoot)` independently, and both build a ts-morph `Project` over the same `discoverWorkspaceSourcePaths` set (`sourceFilesForGraph` -> `source-project.ts:25-32`; `createGraphProject` -> `project-cache.ts:82-86`).
- `scripts/code-intel/daemon-server.ts:50-51` — `new GraphCache(...)` and `new ProjectCache(...)` per daemon, both threaded through connection handling.
- **Cost, precisely:** `scripts/code-intel/daemon-query.ts:46-55` routes each request to exactly one cache (`isGraphCommand` → `graphCache`, `isSymbolCommand` → `projectCache`), so a single request performs one manifest walk. `CachedGraphEntry` (`graph-cache.ts:16-20`) retains only `{graph, manifest, resolver}` — `ImportGraph` is plain data (`types.ts:151-153` — one `Map` of `ImportEdge`) — and the `Project` that `sourceFilesForGraph` builds during `defaultGraphRebuild` (`graph-cache.ts:150-158`, `source-project.ts:29-32`) is discarded once the graph exists. What duplicates is the per-cache manifest walk under alternating workloads, the two resolvers, and one transient full-workspace `Project` per graph rebuild.
- `scripts/code-intel/source-project.ts:15-23` — `CodeIntelContext` with seven optional fields: `graph`, `graphProject`, `project`, `referenceProject`, `repoRoot`, `resolver`, `sourceFiles`.
- `scripts/code-intel/query-executor.ts:79,112,124` (`context.project`) vs `:146-148` (`context.referenceProject ?? context.graphProject ?? createReferenceProject(...)`) vs `:135,163` (`context.graph ?? buildGraphFromContext(...)`) — the same conceptual dependency, resolved from a different optional field per command, each with a from-disk fallback.
- `scripts/code-intel/source-project.ts:25-32` — `sourceFilesForGraph` picks between `sourceFiles`, `graphProject`, or a freshly built `Project`; the third arm is a full-workspace scan reached by omission, and `graph-cache.ts:152` calls it with `{}` precisely to get that arm.
- `scripts/code-intel/definition-query.ts:24`, `export-query.ts:12`, `graph-queries.ts:45`, `graph-queries.ts:64` all return the five-arm `IntelResult` union (`types.ts:32`), and `references-query.ts:22` carries the same union as `ReferencesQueryResult.results`, while each produces exactly one arm — forcing `query-executor.ts:81` (`results[0]?.kind === "definition" ? … : "unknown"`) and `:137` (`result.kind === "test" ? [result.file] : []`) to narrow again.
- `scripts/code-intel/types.ts:60` — `export type DefinitionResult = Extract<IntelResult, { kind: "definition" }>` and `scripts/code-intel/definition-query.ts:37` (`queryDefinitionsByName`) — the narrow-return pattern already exists and just was not applied to the other five.
- `scripts/code-intel/format.ts:211-217` — `formatResultLine` dispatches on `result.kind`; the seven downstream formatters all take `IntelResult` and open with an unreachable throw: `:219-220`, `:224-225`, `:229-230`, `:234-235`, `:240-241`, `:246-247`, `:254-255`.
- `scripts/code-intel/format.ts:202-209` — `emptyResultLine(header)` recovers the kind via five `header.startsWith(...)` tests against headers `query-executor.ts` built with template literals at `:82`, `:115`, `:152`, `:184`, `:202`.
- `scripts/code-intel/query-executor.ts:35-41` — seven `Extract<ExecutableCliCommand, { kind: … }>` aliases: the target pattern already exists in the sibling file.
- `scripts/logs-audit.ts:1` (`#!/usr/bin/env bun`) declaring `LogsAuditFormat:28`, `LogsAuditOptions:30`, `LogsAuditFindingCheck:36`, `LogsAuditFinding:38`, `LogsAuditFileSummary:46`, `LogsAuditReport:53`, `LogFileReader:58`, and ending in a top-level `if (isCliEntrypoint(import.meta.url))` side effect at `:301-305`.
- `scripts/logs-audit/logs-audit-format.ts:1`, `logs-audit-event-fields.ts:3`, `logs-audit-request-ids.ts:3`, `logs-audit-redaction.ts:6`, `logs-audit-diagnostics.ts:24` — five production `import type … from "../logs-audit.js"`; `logs-audit-diagnostics.ts:21-23` carries the comment "The back-edge exists only in the type graph".
- `scripts/logs-audit/logs-audit-checks.ts` — 11 lines: a comment, `type JsonObject`, `interface ParsedLogRecord`, two re-exports; zero checks. `JsonObject` is re-declared identically at `logs-audit-redaction.ts:8`, `logs-audit-event-fields.ts:7`, `logs-audit-request-ids.ts:7`.
- `scripts/logs-audit/logs-audit-format.ts:14` — `type LogsAuditFinding = LogsAuditReport["findings"][number]`, re-deriving a type that is exported two files away.
- `scripts/logs-audit.ts:129-131` — `parseJsonLine`, a one-line `JSON.parse` wrapper with a single caller at `:162`.

## Proposed direction

Cheapest and lowest-risk first: steps 1-3 are pure type work, step 4 reshapes how
`query-executor.ts` receives its dependencies, step 5 is a file move, and step 6 is the
only one that touches the daemon's cache behaviour.

1. **Narrow the query return types.** Add `Extract<IntelResult, { kind: … }>` aliases in
   `scripts/code-intel/types.ts` next to the existing `DefinitionResult` (`:60`), and
   change `queryDefinition`, `queryExports`, `queryDependents` and `queryTests` to return
   arrays of their single arm. `queryReferences` returns an object, not an array, so the
   field to narrow there is `ReferencesQueryResult.results` (`references-query.ts:22`).
   Narrow arrays stay assignable to `CodeIntelQueryResult.results`, so consumers compile
   unchanged; then simplify `query-executor.ts:81` to `results[0]?.name ?? "unknown"` (the
   empty-array case survives, so the optional chain stays) and `:137` to
   `.map((result) => result.file)`.
2. **Delete the impossible throws in `format.ts`.** With step 1 in place, retype the
   seven formatters (`format.ts:219-255`) to take their specific arm and drop each
   opening `throw`. This is mechanical and the compiler verifies it.
3. **Replace `emptyResultLine`'s header sniffing with the kind.** Pass the command/result
   kind into the empty-line path instead of re-parsing the header string
   (`format.ts:202-209`); the caller in `query-executor.ts` has the kind at hand where it
   builds each header (`:82`, `:115`, `:152`, `:184`, `:202`).
4. **Give `CodeIntelContext` a shape that ties each command to the dependency it reads.**
   Replace the seven-optional bag (`source-project.ts:15-23`) with either a discriminated
   set of command-specific context types or a small resolver object that owns
   graph/project/resolver acquisition and is constructed once. The acceptance test is that
   `query-executor.ts` stops reading a different optional field per command
   (`:79`/`:112`/`:124` vs `:135`/`:146-148`/`:163`), and that a context missing the
   dependency its command needs is a type error rather than a silent full-workspace
   rebuild. Keep the from-disk fallbacks reachable — one-shot CLI runs and
   `defaultGraphRebuild` (`graph-cache.ts:152`, which passes `{}` deliberately) depend on
   them — but make choosing them explicit at the call site instead of a `??` tail.
   Do not treat "`graphProject` supplied without `sourceFiles`" as the invalid
   combination: the daemon supplies exactly that for `defName`
   (`daemon-query.ts:76-82`), and `sourceFilesForGraph` (`source-project.ts:25-32`)
   accepts `graphProject` as a complete alternative to `sourceFiles`. All four daemon
   fills — `graph` (`daemon-query.ts:63-67`), `graphProject` (`:76-82`),
   `referenceProject` (`:83-89`), `project` (`:90-94`) — must still type-check.
5. **Move logs-audit's core types out of the executable.** New
   `scripts/logs-audit/logs-audit-types.ts` holding `LogsAuditFormat`,
   `LogsAuditOptions`, `LogsAuditFindingCheck`, `LogsAuditFinding`,
   `LogsAuditFileSummary`, `LogsAuditReport`, `LogFileReader`, plus the single
   `JsonObject` and `ParsedLogRecord`; re-export from `scripts/logs-audit.ts` if any
   external caller depends on that path. Point all five production back-edges
   (`logs-audit-format.ts:1`, `logs-audit-event-fields.ts:3`,
   `logs-audit-request-ids.ts:3`, `logs-audit-redaction.ts:6`,
   `logs-audit-diagnostics.ts:24`) at the new module, delete the three duplicate
   `JsonObject` declarations and the derived alias at `logs-audit-format.ts:14`, and
   remove the apologetic comment at `logs-audit-diagnostics.ts:21-23` once it is no
   longer true. `logs-audit/logs-audit.test.ts:20` imports runtime symbols from the
   entrypoint and stays as it is. Either rename `logs-audit-checks.ts` to match its
   actual contents or make it the real checks barrel; inline `parseJsonLine`
   (`logs-audit.ts:129-131`) into its one caller at `:162`.
6. **De-duplicate the cache *plumbing*; treat merging the cached payloads as a separate,
   evidence-gated decision.** Land last, on its own branch, in two clearly separated
   parts:

   a. **Structural only, no behaviour change (do this one).** Extract the shared
      manifest-gate — `current` / `computeManifest` / `rebuild` / `repoRoot`, the
      options-defaulting constructor, and the identical `ensure()` body — into one small
      generic (e.g. `ManifestGatedCache<TEntry>`), and let `GraphCache` and `ProjectCache`
      keep their own entry types and their own rebuild functions on top of it
      (`ProjectCache`'s extra `buildReferenceProject` seam stays on the subclass). Also
      fold `graph-cache.ts`'s transient graph `Project` construction and
      `project-cache.ts:82-86`'s `createGraphProject` onto one helper — they build the
      same thing from the same path set. This removes the copy without touching
      invalidation granularity, retained memory, or first-request latency.
   b. **Merging the two caches into one instance is optional and must be justified by
      measurement.** One request touches exactly one cache
      (`daemon-query.ts:46-55`), so a shared manifest only saves work under a workload
      that alternates graph and symbol commands against a warm daemon; a graph-only or
      symbol-only workload would pay *more* under a merged cache, because a symbol-command
      rebuild would then also rebuild the import graph (and vice versa) unless the merge
      keeps per-payload laziness. Measure an alternating warm-daemon workload before/after
      (`docs/guides/code-intel.md` documents the daemon workflow), and only merge if the
      numbers justify it; otherwise stop after (a). If a merge does happen, keep
      `referenceProject`'s lazy construction (`project-cache.ts:65-70`) and the per-bucket
      `projectForFile` lookup (`:61-63`) — those are real behaviour, not duplication.

## Scope / caveats

- **Step 6 is the risky one and must not be bundled with the type work.** This is the
  daemon's hot cache: merging the payloads (step 6b) changes invalidation granularity,
  first-request latency, and the daemon's memory profile. Step 6a is the part that is
  safe by construction. Either way, keep the injectable `computeManifest`/`rebuild` seams
  that both classes expose today — the tests depend on them.
- Step 6b needs a measured alternating-workload number before it is scheduled.
- The two caches are genuinely duplicated in shape, but they are not interchangeable:
  `GraphCache` yields `{graph, manifest, resolver}` and `ProjectCache` yields
  `{graphProject, manifest, projects, resolver, referenceProject?}`. Any shared
  abstraction must be generic over the entry type and preserve both result shapes, not
  force one consumer onto the other's.
- No `MODULE.md` or doc under `scripts/code-intel/` defends the `GraphCache`/`ProjectCache`
  split, but the split does line up with the daemon's own command routing
  (`daemon-commands.ts` graph vs symbol commands, dispatched at `daemon-query.ts:52-53`),
  which is a real reason as far as it goes. Record that reason in a module doc
  (`docs/guides/add-module-doc.md`) as part of step 6a rather than leaving either the
  duplication or the split unexplained.
- Step 1 is a prerequisite for steps 2 and 3; steps 4, 5 and 6 are independent of each
  other and of 1-3.
- The logs-audit half (step 5) shares this leaf's cause — types living on the wrong side
  of the boundary — but nothing else: no shared code, no shared tests. Split it into its
  own item if that schedules better.
- Run focused tests with `bun run test:scripts:file -- <file>` as you go. If any step
  changes code-intel's CLI surface or generated harness data, run `bun run harness:check`
  before committing, and update `docs/guides/code-intel.md` if the documented commands
  or output change.
