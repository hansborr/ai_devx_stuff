# drift:ai check reference

Per-check implementation and calibration rationale for every implemented
check. The authoritative list of check ids, their default/opt-in status, and
what each one reports is the implemented-checks table in the
[README](../README.md); this file explains how each check decides, what it
deliberately does not claim, and where its thresholds came from.

## jscpd resolution for the `duplicates` check

The `duplicates` check shells out to `jscpd`. An explicit `--jscpd-bin <path>`
is **authoritative**: when supplied it is the only candidate, and a missing
override reads as unresolved rather than silently scanning with a different
executable. That matches the explicit-override precedence of `--semgrep-bin` and
`--dolos-bin`, while `duplicates` additionally preflights the path and reports a
skip when it is missing. Without an override, drift:ai resolves the executable
from the **tools checkout** first (its own `node_modules/.bin/jscpd`), then the
target's `node_modules/.bin/jscpd`, so an uninstalled target needs no
`node_modules` of its own — jscpd scans source files and runs with the target as
cwd, keeping finding paths repo-relative. If jscpd resolves nowhere, the
`duplicates` check is **skipped with a reason** on stderr (the other checks still
run); it never crashes or emits a false-positive finding.

The default calibration is `minLines: 8`, `minTokens: 60`, and `mode: mild`.
These values may be overridden under `checks.duplicates`; mode accepts `mild`
or `weak`. The command deliberately passes no jscpd duplication-percentage
`--threshold`: individual clone rows are evidence, while ordinary findings,
tool skips, subprocess failures, blank output, and malformed JSON remain
report-only unless an operator explicitly requests the generic
`--fail-on-findings` experiment. This check is not called by
`sensor:near-duplicates` and has no verify or pre-commit slot.

## The `ghost-files` check: current-scope role families

In `changed` scope, `ghost-files` flags every newly added file that looks like a
near-duplicate of an existing directory peer (`foo-helper.ts` beside `foo.ts`) —
the canonical "did you mean to extend the existing module?" signal.

A whole-tree `--scope current` sweep is noisier: a mature codebase is full of
**intentional role-split families** — `foo-types.ts` / `foo-schema.ts` companions,
or parallel detectors like `duplicate-schemas.ts` / `duplicate-types.ts` /
`duplicates.ts`. These share a stem and so look like ghost siblings, but neither
should have extended the other. In `current` scope only, such a pair is
**suppressed** when the only thing that differs between the two filenames is a
**role-marker token** (`checks.ghost-files.roleMarkerTokens`, default
`type` / `schema` / `model`) or a token the two names already share (e.g.
`coldspots-coldspot` vs `coldspots`). A difference that introduces a genuinely new,
non-marker token — the `util` in `foo-util.ts` vs `foo.ts` — is **not** a role
split and still reports.

This is a **naming-convention heuristic, not a dependency proof**: a suppressed
pair is treated as an intentional role family because its filenames look like a
role split, not because drift:ai verified the two modules are independent. The
suppression is deliberately scoped to `current`; the `changed` pass still surfaces
a freshly added `foo-types.ts` so a new companion gets one look. For a residual
current-state pair the heuristic cannot classify (two distinct modules that happen
to be a near-edit apart), use `checks.ghost-files.currentAllowedPairs`. Each entry
must provide the normalized pair under `files` and a nonblank `rationale` that
states both the present structural reason the modules remain separate and the
condition for removing the exception. Keep ticket names, line deltas, and change
history in Git rather than in this durable metadata. For example:

```json
{
  "files": ["src/widget-helpers.ts", "src/widget.ts"],
  "rationale": "widget-helpers.ts remains the pure calculation seam consumed by widget.ts; remove this exception when those calculations are consolidated or move behind a differently named module."
}
```

The rationale is retained for review and effective-config inspection, but pair
matching continues to use only the normalized `files` tuple.

## The `orphan-files` check (knip adapter)

`orphan-files` surfaces never-imported files by running the target's **own** knip
with the target's **own** config — a pass-through adapter that imposes no opinion
of its own. Findings are stamped `[target-config]` so the verdict is never read as
drift:ai's. It is **opt-in** (knip analyzes the whole project graph on every run,
which is too slow for the routine changed-scope pass): enable it with
`--check orphan-files` or `--check all`; it is not in the no-`--check` default set.

knip resolves from the **tools checkout** first, like jscpd, so the target need
not install knip. The adapter locates the target's knip config by searching known
locations — repo-root `knip.{json,jsonc,ts,js}` / `knip.config.*`, then
`package.json#knip`, then non-root `config/knip.config.*` — rather than assuming
repo-root. Pass `--knip-config <path>` to point at a specific config.

Because a trustworthy "is this file unused?" answer needs the target's resolved
module graph, the check **skips with a reason** (never a finding) when:

- the target has **no `node_modules`** (`code: target-not-installed`) — the common
  foreign-repo case;
- **no target knip config** is found (`code: no-target-config`);
- knip itself is missing from the tools checkout (`code: tool-not-installed`);
- knip exceeds drift:ai's subprocess timeout (`code: tool-timeout`).

A skip is an expected absence, not "the target passed this check". Only a knip run
that actually breaks (cannot spawn, or emits unparseable output) produces a single
diagnostic finding. In `changed` scope the reported orphans are intersected with
the changed set; in `current` scope they are intersected with drift:ai's current
inventory after roots, ignores, file checks, and source-extension filtering.

## The `unused-exports` check (knip adapter)

`unused-exports` is the **symbol-level** companion to `orphan-files`: it surfaces
the knip reachability categories `orphan-files` leaves alone — unused **exports**,
unused **types**, and unused **enum / namespace members**. It is the same
pass-through knip adapter (same config resolution, same `[target-config]`
provenance, the same skip behavior, and the same single-diagnostic behavior on a
broken run), so everything above about config discovery, `--knip-config`, and skips
applies identically. It is **opt-in**: enable it with `--check unused-exports` or
`--check all`.

Each finding carries a category-specific message and a `details.category` tag
(`exports` / `types` / `enumMembers` / `namespaceMembers`), with the symbol name
and `file:line:col` from knip. As with `orphan-files`, this is **evidence, not a
verdict**: the hint points at the fix (remove if dead, or add to the target's knip
ignore config if used in a way knip cannot see) without asserting the symbol is
dead. Which categories appear is entirely the target's knip config's call.

**`@deprecated` tombstone overlay.** When a symbol knip reports unused is also
annotated `@deprecated` in its own JSDoc/declaration trivia, the same finding gains
`details.deprecated: true`, names the annotation in its message ("…is marked
@deprecated and never imported…"), and uses a stronger removal hint. The two
signals together — a tombstone the author already marked, plus the target's own
reachability verdict that nothing uses it — make it a high-confidence removal
candidate. This is still an **overlay, not a new verdict**: knip's
target-configured reachability provenance is unchanged, and the `@deprecated` half
is local annotation evidence. Detection is AST-exact (the declaration knip points
at must carry the tag) and conservative — a missing location, unreadable file, or
a position that resolves to no named declaration leaves the row un-flagged, and a
container's `@deprecated` never bleeds onto its members (or vice versa). drift:ai
does **not** hunt for `@deprecated` symbols knip considers reachable; the overlay
only rides rows knip already surfaced.

Single-check runs request only the needed knip `--include` categories
(`files` for `orphan-files`; symbol categories for `unused-exports`;
`duplicates` for `knip-duplicates`). When multiple whole-project knip checks are
selected, including under `--check all`, they request the selected category
superset so knip is **spawned once** and each selected adapter parses from the
same report.

## The `knip-duplicates` check (knip adapter)

`knip-duplicates` surfaces knip's `duplicates` issue category: duplicate export
aliases in a single module, such as `export const alias = original` or
`export default original` next to the original named export. It is **not** source
clone detection; drift:ai's existing `duplicates` check owns copy/paste blocks
via jscpd.

It uses the same pass-through knip adapter as `orphan-files` and `unused-exports`
(same config discovery, `[target-config]` provenance, skip behavior, and
single-diagnostic behavior on a broken run). Enable it with
`--check knip-duplicates` or `--check all`.

Each finding carries `details.category: "duplicates"`, a `details.symbols` list,
and the duplicate export count. The hint points either to consolidating redundant
aliases or ignoring intentional public-API compatibility aliases in the target's
knip config.

## The `import-cycles` check (ts-morph)

`import-cycles` surfaces circular imports — a near-zero-false-positive defect AI
agents introduce routinely (split a module, the new child re-imports its parent).
It builds the module graph **in-process with ts-morph's TypeScript resolver**, so
the target needs no `node_modules` of its own and no extra tool dependency. It is
**opt-in** (building the whole graph is whole-project work): enable it with
`--check import-cycles` or `--check all`.

It is a config-honoring structural adapter: it resolves the target's own tsconfig
**path aliases** so monorepo and aliased imports are followed correctly. By default
each file is resolved against its **nearest** `tsconfig.json` (so per-package alias
maps work without a single global config); pass `--tsconfig <path>` to force one
config for the whole graph. Findings are stamped `[target-config]`.

Each reported cycle is one finding anchored on the first file, with the rest of the
strongly-connected component in `relatedFiles`. **Type-only cycles** (formed solely
by `import type` / `export type` edges) are reported but **labeled** as not a
runtime defect (`details.typeOnly: true`) — evidence, not a verdict — while genuine
runtime cycles are reported unlabeled. A barrel's fan-out is never collapsed into
noise: only a genuine back-edge through the barrel counts as a cycle.

Because a cycle graph is only trustworthy if imports resolve, the check **skips
with a reason** (never a finding) when no tsconfig governs the files
(`code: no-target-config`) or when resolution is too partial to trust — naming
whether the target is uninstalled (`code: target-not-installed`) or the tsconfig
looks wrong (`code: resolution-too-partial`). Unlike a graph tool that needs the
target installed, alias/relative imports resolve offline, so an uninstalled target
with tsconfig path aliases is still reported on (validated against OpenClaw). In
`changed` scope only cycles touching a changed file are reported; in `current`
scope every cycle in the graph is surfaced.

**Gating on runtime cycles.** `--fail-on-runtime-cycles` turns the check into a
floor for CI/lint composites (Musi wires it into `scripts/lint.sh` and
`scripts/lint-changed.sh` as the "import cycles" lane): the run exits `1` when
any import-cycles finding is **not** labeled type-only — genuine runtime cycles
and the could-not-build-graph diagnostic both count — and also when the check
**skips**, because a gate that never inspected the graph must fail closed
rather than certify zero runtime cycles. Type-only cycles keep rendering as
report-only evidence and never trip the gate. The gate applies to whatever the
run reports, so pair it with `--scope current` for a whole-graph floor (as
Musi's lint lanes do); in `changed` scope only cycles touching a changed file
are reported, so the gate narrows with them. The flag requires
`--check import-cycles` (or `--check all`); without that the run is rejected as
a usage error rather than silently gating nothing. A red gate explains itself
on stderr (runtime cycles found vs failed closed on a skip) in addition to the
findings' FIX hints.

## The `layer-direction` check (ts-morph)

`layer-direction` surfaces resolved reverse imports across configured source
layers. The rules are repo policy supplied by config, not built in: each entry
under `checks.layer-direction.rules` bans imports from one path prefix into
another — `{ id, sourceLayer, sourcePrefix, targetLayer, targetPrefix, hint }`,
where the layer labels are free strings used in the finding prose — and
`checks.layer-direction.allowedEdges` lists explicit directional
`[source, target]` file-pair exceptions. The **built-in default is zero rules**,
per the config-discovery contract above: a foreign target never inherits Musi's
server topology. Musi's own two rules (`packages/server/src/utils/` must not
import `packages/server/src/services/`; `packages/server/src/services/` must not
import `packages/server/src/routers/`) and its two allowed test-fixture edges
live in the committed `drift-ai.config.json`. The check reuses the same
TypeScript module graph as `import-cycles`, so relative imports and tsconfig
path aliases are resolved before the rules run.

An empty result is never silently authoritative: a run with zero rules
configured skips with an explicit notice (instead of reporting an empty "OK"),
and a configured rule whose prefixes match zero files in the module graph is
named on stderr rather than passing as a clean layering verdict.

Findings name the source file, the resolved target file (`details.targetFile`),
the source/target layers, and whether the edge is type-only. Type-only reverse
imports are still reported as architecture coupling evidence. Findings are
stamped `[drift-baseline]`, and the check is **opt-in** until field runs prove the
rules are low-noise: enable it with `--check layer-direction` or `--check all`.

The check shares the import graph skip behavior: no tsconfig or a too-partial
graph becomes a skip with a reason, not a finding.

## The `near-duplicates` check (ts-morph)

`near-duplicates` catches same-shaped function clones plus small exact function
clones. The unchanged fuzzy tier fingerprints function AST structure with
identifiers normalized, keeps its 8-line/45-token floors and `0.85` threshold,
and compares only functions in a similar token-count band. Alongside it, the
report-only exact tier preserves parser token kind and text, uses 3-line/15-token
floors under `scripts/**` and `eslint-rules/**`, verifies full sequences after
hash bucketing, and unions the tiers by both functions' occurrence ranges.

This is a drift-authored measurement threshold, so findings are stamped
`[drift-baseline]`. It needs no target `node_modules` when using the default
ts-morph engine. It is **opt-in** because it compares functions across the
project: enable it with `--check near-duplicates` or `--check all`. In `changed`
scope only pairs touching a changed file are reported; in `current` scope every
pair is surfaced, sorted by `lines * similarity`.

The exact tier is deliberately absent from `sensor:near-duplicates`: after
scoped single-walk optimization its C3 timing and bucket caps pass, but it still
adds 535 identities absent from the fuzzy baseline. Those identities require
one-at-a-time review rather than bulk grandfathering, so initial baseline growth
still blocks enforcement. Reproduce the evidence with `bun run
sensor:near-duplicates:benchmark -- --samples 5`. Equality groups above 100
functions or total projections above 50,000 pairs produce a bounded diagnostic
finding instead of truncating or certifying clean.

Advanced: a target config may set `checks.near-duplicates.engine` to
`"similarity-ts"` to use the optional Rust binary (`cargo install similarity-ts
--version 0.5.0 --locked`). If that binary is not on `PATH`, the check skips with
`code: tool-not-installed` rather than emitting a finding. Both engines scan the
same filtered inventory: drift's ignore config, `excludeGlobs`, configured
`sourceExtensions`, and `.d.ts` exclusion are resolved once, and similarity-ts
receives that explicit file list as positional paths rather than the raw roots —
so it never reaches ignored, excluded, unsupported-extension, or declaration
files.

The adapter supports **similarity-ts 0.5.0** and invokes `--no-types` so stdout
contains only the function-similarity section. Under this pinned contract,
`minTokens` is the effective function-size floor and configured `minLines` does
not reach the similarity-ts engine. Version 0.5.0 gives its optional `min_lines`
argument a default and discards it whenever `min_tokens` is present, falling
back to three lines while retaining the token floor. This is the pre-existing
effective behavior, preserved deliberately so this adapter hardening does not
retune detection or move the near-duplicates baseline; the adapter omits the
inert explicit `--min-lines` argument. The pinned tool still emits its misleading
both-arguments warning because its own default makes `min_lines` present.

The complete accepted text grammar is the fixed run and function headers. A
valid zero-pair result can then be the no-source-files sentinel in place of the
checking header:

```text
Analyzing code similarity...
=== Function Similarity ===
No TypeScript/JavaScript files found in the specified paths.
```

This occurs when the filtered inventory is non-empty but contains only configured
additional extensions that similarity-ts does not parse. The other zero-pair
form follows the checking header:

```text
Analyzing code similarity...
=== Function Similarity ===
Checking <positive integer> files for duplicates...

No duplicate functions found!
```

The pair form instead carries the declared pair count, 60-character rule, and
score-first three-line records (blank separator lines are allowed):

```text
Analyzing code similarity...
=== Function Similarity ===
Checking <positive integer> files for duplicates...
Found <positive integer> duplicate pairs:
------------------------------------------------------------
Similarity: <percent>%, Score: <score> points (lines <min>~<max>, avg: <average>)
  <path>:<start>-<end> <function name>
  <path>:<start>-<end> <function name>
```

Empty or blank-only stdout is not a valid 0.5.0 response. Every non-blank line
must belong to the complete selected form, and the declared pair count must
match the records; otherwise the check reports an analyzer diagnostic with a
bounded stdout excerpt instead of a clean empty scan. The adapter passes neither
function filter option, so it rejects the filter-only zero-pair sentinel that
0.5.0 can print only after applying one of those filters.

This contract is derived from the vendored Cargo registry sources at
`similarity-ts-0.5.0/src/main.rs:11-214` (CLI, size-floor resolution, and section
selection) and
`similarity-ts-0.5.0/src/check.rs:108-232,354-386` (sentinels, headers, records,
and unconditional within-/cross-file collection). Upgrade the pin and adapter
together; incompatible presentation changes fail closed.

## The duplicate value checks (ts-morph)

`duplicate-literals` and `duplicate-constants` are opt-in exact-value checks over
the same filtered source inventory as the other drift-authored structural checks.
They are evidence, not verdicts: a group says the value is repeated, not that a
particular occurrence is wrong.

`duplicate-literals` skips raw numeric literals by default because tiny values
such as `0`, `1`, and `2` can dominate the report. Enable numeric literal groups
only when you want that signal:

```json
{
  "checks": {
    "duplicate-literals": {
      "includeNumbers": true,
      "minNumberDigits": 3
    },
    "duplicate-constants": {
      "minNumberDigits": 3
    }
  }
}
```

`minNumberDigits` is a source-text triviality floor. It strips a leading sign,
underscores, and the decimal point before counting digits; non-decimal literal
forms count their base digits. Strings keep the existing `minLength` filter.

## The `module-doc-paths` check

`module-doc-paths` is the module-doc counterpart to `harness-freshness`: it
validates backtick **file** references inside `MODULE.md` / `*-MODULE.md` notes so
a renamed or deleted file leaves a visible trail in the doc that points at it. It
is **opt-in** and report-only; enable it with `--check module-doc-paths` or
`--check all`. It scans every module doc under the configured roots regardless of
`--scope`, since a path can go stale from a source change far from the doc itself.

It checks **path existence only** — exported symbols named in prose are out of
scope. A token is treated as a reference only when it is a multi-segment relative
path (contains `/`) ending in a known file extension; that filter keeps
`identifier.member` prose (`character.get`, `socket.broadcast`), bare filenames,
directory references, and `@scope/pkg` specifiers out of the stream. Fenced code
blocks are ignored.

Resolution is deliberately **multi-base**, because MODULE.md authors anchor paths
differently: the module's own directory (`./auth-middleware.ts`), a shared sibling
under the parent (`entries/entry-dialog.tsx`), the package `src`/package root
(`utils/foo.ts`, `src/test/mock-trpc.tsx`), or the repo root
(`docs/CONCURRENCY.md`). A reference is fresh when it resolves under **any**
candidate base, and `.js`/`.jsx` specifiers also try their `.ts`/`.tsx` source.
`./` and `../` references are anchored to the module directory only. This favors
precision (few false positives) over recall: a path that has genuinely drifted but
also happens to exist under another base is not flagged. If a particular doc's
reference style still produces noise, exclude the whole doc with
`checks.module-doc-paths.excludeGlobs`.

## The `commented-out-code` check

`commented-out-code` is the refactor-residue counterpart to `comments`: the
`comments` check flags files where prose crowds out code, while this one flags a
**tombstoned code block** left behind in comments. It is **opt-in** and report-only;
enable it with `--check commented-out-code` or `--check all`.

It collects each run of consecutive **pure-comment** lines (`//` lines or the body
of a `/* … */` block, with a leading `*` JSDoc decoration stripped), and flags a
run of at least `minLines` (default `3`) only when the stripped text **parses
cleanly as operative code** — a declaration, control-flow statement, call,
assignment, `import`/`export`, etc. The clean-parse gate is what separates
commented-out code from prose: ordinary sentences and JSDoc do not parse as
statements, and a block that contains only bare identifiers or string literals is
not flagged. This favors **precision over recall** — an unbalanced fragment that
does not parse is left alone rather than guessed at.

Each finding names the line range, the line count, the first operative construct
(evidence for why it reads as code), a first-line preview, and a short snippet hash
in `details`; the whole block is never dumped into text output. It is **evidence,
not a verdict**: the row says the block _appears_ to be commented-out code, never
that the code is unreachable or safe to delete. Tune the block-size floor with
`checks.commented-out-code.minLines` (minimum `2`) and drop whole path prefixes
with `checks.commented-out-code.excludePrefixes`.

## Field-run calibration records

Record a calibration run before promoting a prototype/advisory lens, making an
opt-in check default-on, materially changing thresholds, or tuning a noisy
default-on check. A useful record names the exact command, repo/commit/date,
config source, scope, roots, checks, raw findings by check, reviewed
true/false/uncertain counts, top false-positive classes, timing/cost evidence,
and the recommended action: keep opt-in, keep default-on, tune, promote, demote,
or split follow-up.

The reusable template and first Musi current-scope baseline live in
[`docs/agent_notes/finished_work/drift-ai-field-run-calibration.md`](../../../docs/agent_notes/finished_work/drift-ai-field-run-calibration.md).
