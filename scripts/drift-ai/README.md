# drift:ai — portable AI-drift sensor

`drift:ai` is a **report-only** code-quality sensor that flags patterns AI coding
agents tend to introduce: copy/paste duplicates, suspicious sibling modules
(`foo-helpers.ts` beside `foo.ts`), over-narration in comments, and newly added
lint/type suppressions. Opt-in checks deepen the sweep: knip adapters
(`orphan-files`, `knip-duplicates`, `unused-exports`), ts-morph structural checks
(`import-cycles`, `layer-direction`, `near-duplicates`, and the `duplicate-*`
value/shape family), plus `module-doc-paths` (stale module-doc file references)
and `commented-out-code` (tombstoned code blocks) — the implemented-checks table
below is the authoritative list. Findings are evidence for a human by default:
normal reports exit `0`, usage/config errors exit `2`, and `--fail-on-findings`
is the explicit opt-in gate that exits `1` when findings exist.
`--fail-on-runtime-cycles` is a narrower opt-in gate for the runtime
import-cycle floor: it exits `1` only on import-cycles findings that are not
labeled type-only (see the `import-cycles` section).

## Quickstart: scan an external repo

If you have never run drift:ai before and just want to point it at another repo,
these four steps are the whole path. The deeper sections below explain the model
and every flag; this is the minimum to get a report.

1. **Clone this repo once as your "tools checkout" and install its deps.** Only
   this checkout needs Bun and the implementation tools (`jscpd`, `knip`,
   `ts-morph`); the repo you scan installs nothing.

   ```sh
   git clone <this-repo-url> drift-ai-tools
   cd drift-ai-tools
   bun install
   ```

2. **`cd` into the target repo** — the repo you want to scan. drift:ai uses the
   current directory as its anchor: scanner output, config discovery, and Git
   operations all resolve from here, so finding paths come out repo-relative. The
   target only needs to be a Git repo; it can use any package manager, or have no
   `node_modules` at all.

   ```sh
   cd /path/to/target-repo
   ```

3. **Run a whole-tree audit**, pointing `--root` at the target's source
   directories (repeat `--root` per directory). Use `--scope current` for a
   foreign repo: it audits the working-tree inventory rather than a git diff.

   ```sh
   bun /path/to/drift-ai-tools/scripts/drift-ai.ts --scope current --root src
   ```

   This runs the default check set (`duplicates`, `ghost-files`, `comments`, and
   `suppressions`) and exits `0` — findings are evidence to read, not a failing
   gate. `suppressions` is diff-only, so in `current` scope it skips with a
   printed reason; the other three audit the inventory.

4. **Turn on the opt-in checks when you want a deeper sweep.** `--check all`
   adds every opt-in check: the whole-project adapters (knip pass-through
   categories, import cycles, server layer direction, near-duplicates, the
   `duplicate-*` family) plus `module-doc-paths` and `commented-out-code`; checks
   that need a resolver or a vendored tool the target lacks skip with a printed
   reason instead of crashing.

   ```sh
   bun /path/to/drift-ai-tools/scripts/drift-ai.ts --scope current --root src --check all
   ```

Add `--format json --output report.json`, or `--chunk-dir <dir>` to emit
AI-handoff chunks. Run the entrypoint with `--help` for the full flag list. If
the target ships its own `drift-ai.config.json`, its `roots` are used and you can
drop `--root`; otherwise see [Config discovery](#config-discovery) and the
[starter config](#starter-config).

### Compact multiple reports for agent triage

Downstream triage — reducing drift / Semgrep / Dolos JSON reports into one
ranked review queue, swarm packets, and collected verdicts — is the
`drift:triage` module's job; see
[`scripts/drift-triage/MODULE.md`](../drift-triage/MODULE.md) for the
workflow and contracts.

### Optional: Semgrep community-rule scan

`--check all` does **not** run Semgrep. Semgrep is a separate prototype advisory
subcommand because rule choice and rule licensing belong to the operator. drift:ai
does not distribute Semgrep rules or write Semgrep config into the target repo,
but it can run useful third-party/community rules that you install or explicitly
select.

The fastest no-vendoring path is a live Semgrep Registry pack. It is mutable and
not reproducible, so both network and license consent are explicit:

```sh
cd <target-repo>
bun <tools-checkout>/scripts/drift-ai.ts semgrep-candidates --root src \
  --registry-pack p/default \
  --allow-live-registry \
  --allow-rule-license Semgrep-Rules-License-1.0
```

For reproducible local scans, install the Semgrep engine in the tools checkout,
clone a permissively licensed third-party/community rules repo yourself, and point
drift:ai at that local rule file or directory:

```sh
cd <tools-checkout>
python3 -m venv .tools/semgrep/.venv
.tools/semgrep/.venv/bin/pip install semgrep==1.165.0
git clone https://github.com/<org>/<permissive-rules-repo> .tools/semgrep/rules/<rules-repo>

cd <target-repo>
bun <tools-checkout>/scripts/drift-ai.ts semgrep-candidates --root src \
  --semgrep-config /abs/path/to/tools-checkout/.tools/semgrep/rules/<rules-repo>/<rules.yml> \
  --rule-license MIT
```

See the [Semgrep candidate setup](docs/prototype-subcommands.md#the-semgrep-candidates-prototype-subcommand)
for manifests, license gates, absolute-path guidance, and JSON output.

## Main report quick reference

Run it inside Musi with the package script:

```sh
bun run drift:ai
```

Run it from a tools checkout against another repo by changing into the target
repo and invoking this checkout's entrypoint:

```sh
cd <target-repo>
bun <tools-checkout>/scripts/drift-ai.ts --scope current --root src
```

Primary flags:

| Flag                       | Use                                                                                                                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--scope changed`          | Default. Diff against `--base main` (or `origin/main`) plus untracked files.                                                                                                                                            |
| `--scope current`          | Audit the current working tree inventory. Use this for imported/polluted repos or whole-repo sweeps.                                                                                                                    |
| `--check <id>`             | Run one or more checks. Repeat the flag for multiple checks.                                                                                                                                                            |
| `--check all`              | Run every implemented check, including the slower opt-in adapters.                                                                                                                                                      |
| `--root <path>`            | Limit `current` scope to one or more roots; repeatable. Rejected in `changed` scope.                                                                                                                                    |
| `--config <path>`          | Load a specific config. Without it, `drift-ai.config.json` at the target repo root auto-loads when present.                                                                                                             |
| `--format text\|json`      | Select human-readable or machine-readable output.                                                                                                                                                                       |
| `--include-scope`          | With JSON, include the full considered-file scope; otherwise JSON keeps only `scopeCount`.                                                                                                                              |
| `--output <path>`          | Write the primary report to a file.                                                                                                                                                                                     |
| `--chunk-dir <path>`       | Also write AI-handoff chunks plus `manifest.json`; `--chunk-size` defaults to 75.                                                                                                                                       |
| `--fail-on-findings`       | Keep report rendering, but return exit `1` when findings exist.                                                                                                                                                         |
| `--fail-on-runtime-cycles` | Gate on runtime import cycles only (requires `--check import-cycles` or `all`): exit `1` on any import-cycles finding not labeled type-only, or when the check skips (fails closed). Type-only cycles stay report-only. |

Implemented checks:

| Check                 |             Default? | What it reports                                                    | Notes                                                                                                                                                                                                                                                |
| --------------------- | -------------------: | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `duplicates`          |                  Yes | Copy/paste duplicate blocks                                        | Uses `jscpd`; skips cleanly if the executable cannot be resolved.                                                                                                                                                                                    |
| `ghost-files`         |                  Yes | Suspicious sibling modules such as `foo-helper.ts` beside `foo.ts` | Uses filename tokens and directory peers; configurable allow-pairs for known-good current-state siblings. In `current` scope, established role-split families are suppressed (see below).                                                            |
| `comments`            |                  Yes | Over-narrated files with high comment-to-code ratios               | Honors `checks.comments.excludePrefixes`.                                                                                                                                                                                                            |
| `commented-out-code`  |               Opt-in | Tombstoned code blocks left behind in comments                     | Flags consecutive comment runs that parse cleanly as operative code; `checks.commented-out-code.minLines` / `excludePrefixes`. Evidence only — it does not call the code dead.                                                                       |
| `suppressions`        | Yes in changed scope | Newly added `eslint-disable` / `@ts-*` suppressions                | Diff-only; skipped in `current` scope with a reason.                                                                                                                                                                                                 |
| `module-doc-paths`    |               Opt-in | Stale backtick **file** references in `MODULE.md` / `*-MODULE.md`  | Path existence only (symbols in prose are out of scope); resolves across candidate bases, so it favors precision over recall. Scans every module doc under the roots regardless of scope.                                                            |
| `orphan-files`        |               Opt-in | Never-imported files from the target's knip config                 | Adapter finding provenance is `[target-config]`; skips when the target cannot support a trustworthy knip run.                                                                                                                                        |
| `knip-duplicates`     |               Opt-in | Duplicate export aliases from knip                                 | Same knip adapter as `orphan-files` (`[target-config]`, identical skips). Separate from jscpd `duplicates`, which reports source clone blocks.                                                                                                       |
| `unused-exports`      |               Opt-in | Unused exported symbols/types/enum & namespace members from knip   | Same knip adapter as `orphan-files` (`[target-config]`, identical skips); each finding is tagged `details.category`, and a symbol that is also `@deprecated` gains `details.deprecated`. Shares a single knip spawn with other selected knip checks. |
| `import-cycles`       |               Opt-in | Circular import components                                         | Uses ts-morph/TypeScript resolution; type-only cycles are labeled.                                                                                                                                                                                   |
| `layer-direction`     |               Opt-in | Server `utils`/`services` reverse layer imports                    | Uses the resolved TypeScript graph; starts with `utils -> services` and `services -> routers` bans. Findings carry `[drift-baseline]` provenance.                                                                                                    |
| `near-duplicates`     |               Opt-in | AST-similar function clones missed by exact duplicate detection    | Default engine is in-process ts-morph; findings carry `[drift-baseline]` provenance.                                                                                                                                                                 |
| `duplicate-types`     |               Opt-in | Repeated interface/type-literal property shapes                    | Exact ts-morph structural hashes over non-function type shapes; filters tiny shapes with `minProps`. Findings carry `[drift-baseline]` provenance.                                                                                                   |
| `duplicate-schemas`   |               Opt-in | Repeated object-schema key shapes                                  | Exact ts-morph structural hashes over `<receiver>.object({...})` chains; filters tiny schemas with `minKeys`. Findings carry `[drift-baseline]` provenance.                                                                                          |
| `duplicate-literals`  |               Opt-in | Repeated literal values across files                               | Exact ts-morph grouping. Strings are length-filtered; raw numbers are skipped unless `includeNumbers` is enabled.                                                                                                                                    |
| `duplicate-constants` |               Opt-in | Module-level constants sharing the same literal value              | Exact ts-morph grouping. Short strings and trivial numeric values are filtered before grouping.                                                                                                                                                      |

Subcommands:

| Command                                    | Purpose                                                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run drift:ai coverage-evidence`       | Prototype coverage-artifact evidence from configured `coverage.artifacts`; not a trusted finding stream and never runs tests.                                       |
| `bun run drift:ai coverage-unused-exports` | Prototype overlay of a supplied knip unused-exports report onto `coverage.artifacts`; flags covered-but-unused conflicts, never a deletion verdict.                 |
| `bun run drift:ai env-branches`            | Prototype env/define stale-branch predictions under a configured `envDefine` matrix; candidate leads, never findings or branch deletions.                           |
| `bun run drift:ai clone-candidates`        | Prototype MinHash/LSH function clone candidates with ts-morph agreement and sibling-naming overlay evidence; not a trusted finding stream.                          |
| `bun run drift:ai dolos-candidates`        | Prototype fragment-level clone candidates from the external Dolos engine; opt-in (missing binary is an expected absence).                                           |
| `bun run drift:ai semgrep-candidates`      | Prototype Semgrep candidate groups from operator-supplied, license-gated rule sources; opt-in (missing binary or blocked rule source is an expected absence).       |
| `bun run drift:ai ownership`               | Prototype bounded-history file ownership / DOA archaeology; emits owner concentration, recency, co-author, and agent-hand evidence.                                 |
| `bun run drift:ai test-orphaning`          | Prototype bounded-history source/test orphaning; flags source files that churned without their inferred tests moving with them, never a verdict.                    |
| `bun run drift:ai birth-size-delta`        | Prototype bounded-history path-birth size deltas; compares birth/current bytes, effective LOC, and a branch-points complexity overlay, never a refactor verdict.    |
| `bun run drift:ai class-construction`      | Prototype class-construction evidence for classes with no direct construction signal; optional unused-export report correlation, never a deletion verdict.          |
| `bun run drift:ai hotspots`                | Advisory git-history lenses (`churn`, `coupling`, `fragmentation`, `suppression-churn`, `thrash`); not a trusted finding stream.                                    |
| `bun run drift:ai coldspots`               | Advisory git-history lenses (`coldspot`, `stale-markers`); `coldspot` considers files touched in the effective git window.                                          |
| `bun run drift:ai harness-freshness`       | Musi-only docs freshness check for `docs/ai-harness.md` against `docs/guides` and backtick paths.                                                                   |
| `bun run drift:ai config`                  | Read-only inspection of the effective drift:ai config (source, repo root, roots, source extensions, default/implemented checks); runs no checks and writes nothing. |

### Per-check timing

Every report records the wall-clock each check took, skips included (a cheap skip
reads as `0ms`). Text output adds a `timing:` line under the summary; JSON adds
`checkTimings` (one `{ check, durationMs }` per dispatched check, in run order)
and `totalDurationMs` (their sum). Durations are whole milliseconds, so a
sub-millisecond check reads as `0ms`.

This is **evidence only** — timing never changes the exit code, finding order, or
severity. Use it to decide whether a check is cheap enough to run by default. The
fields are additive (report schema v4); a tolerant reader can ignore them, while a
strict reader must accept the new version.

### Field-run calibration records

Record a calibration run before promoting a prototype/advisory lens, making an
opt-in check default-on, materially changing thresholds, or tuning a noisy
default-on check. A useful record names the exact command, repo/commit/date,
config source, scope, roots, checks, raw findings by check, reviewed
true/false/uncertain counts, top false-positive classes, timing/cost evidence,
and the recommended action: keep opt-in, keep default-on, tune, promote, demote,
or split follow-up.

The reusable template and first Musi current-scope baseline live in
`docs/agent_notes/finished_work/drift-ai-field-run-calibration.md`.

### Portable JSON report contract

`--format json` is the **portable report contract** for downstream/foreign-repo
consumers: a `DriftReport` with a top-level `schemaVersion` (`DRIFT_SCHEMA_VERSION`),
optional `details`/`provenance` on findings, machine-readable `code` on skips, and
`scope` only when `--include-scope` is passed. Its shape is pinned by golden
fixtures in `fixtures/report-contract.*.json` (see `report-contract.test.ts`):
adding, removing, renaming, or reordering a key fails that test until the fixtures
are regenerated with `UPDATE_DRIFT_CONTRACT=1`, so schema changes stay deliberate.
Additive optional fields plus a documented `schemaVersion` bump remain allowed.

This JSON report is the only portable surface. The Musi-internal
`HARNESS_DIAGNOSTICS_OUTPUT` sidecar (`HarnessDiagnostics`) is a separate,
harness-facing envelope — not part of the foreign-repo contract — and depends on
the shared schema and Musi control ids, so do not treat it as the portable shape.

This document is the **tools-checkout contract**: how to run drift:ai from a
shared checkout of this repo against _another_ Git repository. If you only ever
run it inside Musi (`bun run drift:ai`), you do not need any of this — that path
is already wired up.

## The model: tools checkout vs. target repo

drift:ai is designed to be run from a **tools checkout** (a clone or worktree of
this repo) against a separate **target repo**:

- The **tools checkout** supplies the implementation: the `drift-ai.ts` entry, its
  source, and its dependencies (`jscpd`, `knip`, and `ts-morph`). **Bun is the
  tool runtime** — the script runs under Bun.
- The **target repo** supplies only the source being scanned. It can use any
  package manager and does **not** adopt Bun.

The split exists so a target repo never has to install drift:ai's own
dependencies just to be scanned.

### Locating the tools checkout

The tools checkout is an ordinary clone/worktree of this repository. No special
install location is required — you invoke drift:ai by **absolute path** to its
entry script:

```sh
bun /abs/path/to/tools-checkout/scripts/drift-ai.ts ...
```

### Installing implementation deps (once)

Run `bun install` **in the tools checkout** once after cloning. That brings in
the implementation tools and libraries (`jscpd`, `knip`, `ts-morph`, and their
dependencies). The target repo installs nothing on drift:ai's behalf.

```sh
cd /abs/path/to/tools-checkout
bun install
```

## Invocation

The canonical form: `cd` into the target repo so scanner output and config
discovery are anchored there, then run the tools-checkout entry by absolute path.

```sh
cd <target-repo>
bun <tools-checkout>/scripts/drift-ai.ts --scope current --root <src-dir> [--root <src-dir> ...]
```

`--scope current` audits the working tree. `current` scope scans the roots you
pass via `--root` (or the `roots` listed in the target's `drift-ai.config.json`,
if it has one). For a foreign repo without a config, pass `--root` explicitly.

Validated example (the OpenClaw monorepo, a pnpm + oxlint TypeScript repo):

```sh
cd <path-to>/openclaw
bun <tools-checkout>/scripts/drift-ai.ts --scope current \
  --root src --root packages --root apps --root extensions --root ui --root config
```

This runs to exit `0` with repo-relative finding paths (e.g.
`src/agents/...`). Run `bun <tools-checkout>/scripts/drift-ai.ts --help` for the
full flag list (`--format text|json`, `--output`, `--check`, `--config`,
`--chunk-dir`/`--chunk-size`, `--jscpd-bin`, `--knip-config`, `--tsconfig`).

### jscpd resolution for the `duplicates` check

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

### The `ghost-files` check: current-scope role families

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
to be a near-edit apart), use `checks.ghost-files.currentAllowedPairs`.

### The `orphan-files` check (knip adapter)

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

### The `unused-exports` check (knip adapter)

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

### The `knip-duplicates` check (knip adapter)

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

### The `import-cycles` check (ts-morph)

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

### The `layer-direction` check (ts-morph)

`layer-direction` surfaces resolved reverse imports across Musi's server source
layers. It starts with two report-only rules: files under
`packages/server/src/utils/` must not import `packages/server/src/services/`, and
files under `packages/server/src/services/` must not import
`packages/server/src/routers/`. It reuses the same TypeScript module graph as
`import-cycles`, so relative imports and tsconfig path aliases are resolved before
the rule runs.

Findings name the source file, the resolved target file (`details.targetFile`),
the source/target layers, and whether the edge is type-only. Type-only reverse
imports are still reported as architecture coupling evidence. Findings are
stamped `[drift-baseline]`, and the check is **opt-in** until field runs prove the
rules are low-noise: enable it with `--check layer-direction` or `--check all`.

The check shares the import graph skip behavior: no tsconfig or a too-partial
graph becomes a skip with a reason, not a finding. The current allowlist contains
only the known test fixture edge
`packages/server/src/utils/character-mapping.test.ts ->
packages/server/src/services/character-create.ts`.

### The `near-duplicates` check (ts-morph)

`near-duplicates` catches same-shaped function clones that token/exact clone
detection can miss: renamed variables, a tweaked signature, or independent
statements moved around. It fingerprints function AST structure with identifiers
normalized, compares only functions in a similar token-count band, and requires
conservative minimum lines/tokens plus a default similarity threshold of `0.85`.

This is a drift-authored measurement threshold, so findings are stamped
`[drift-baseline]`. It needs no target `node_modules` when using the default
ts-morph engine. It is **opt-in** because it compares functions across the
project: enable it with `--check near-duplicates` or `--check all`. In `changed`
scope only pairs touching a changed file are reported; in `current` scope every
pair is surfaced, sorted by `lines * similarity`.

Advanced: a target config may set `checks.near-duplicates.engine` to
`"similarity-ts"` to use the optional Rust binary (`cargo install
similarity-ts`). If that binary is not on `PATH`, the check skips with
`code: tool-not-installed` rather than emitting a finding. Both engines scan the
same filtered inventory: drift's ignore config, `excludeGlobs`, configured
`sourceExtensions`, and `.d.ts` exclusion are resolved once, and similarity-ts
receives that explicit file list as positional paths rather than the raw roots —
so it never reaches ignored, excluded, unsupported-extension, or declaration
files.

### The duplicate value checks (ts-morph)

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

### The `module-doc-paths` check

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

### The `commented-out-code` check

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

### Why `cd` into the target (and no `--repo` flag)

The target repo is the subprocess **cwd**, which keeps scanner output
repo-relative and lets config discovery and Git operations resolve from the
target. Executables still resolve from the tools checkout. The documented `cd`
flow is the supported MVP; no wrapper is planned.

A true `--repo <path>` flag is **deferred** because it needs one coherent policy
for every place drift:ai currently relies on cwd:

- **Git command cwd**: `git diff`, `git ls-files`, and repo-root discovery must
  run inside the target, not the tools checkout.
- **Config auto-discovery root**: with no `--config`, discovery must search the
  target repo, not this checkout's Musi-specific `drift-ai.config.json`.
- **`--output` base**: relative output paths must resolve relative to the target
  repo, unless the user gives an absolute path.
- **`--chunk-dir` base**: chunk output must follow the same target-relative rule
  as `--output`.
- **`--root` validation**: configured and CLI roots must be resolved and checked
  against the target repo boundary.
- **Subprocess cwd**: `jscpd` and future subprocess-backed checks must run with
  the target as cwd so emitted paths stay repo-relative.

The `cd <target-repo>` form satisfies all six by construction because cwd is
already the target. A `--repo` wrapper stays deferred; if target-selection work is
revived it is tracked in the
[drift:ai backlog archive](../../docs/agent_notes/finished_work/drift-ai-next-items.md).

## Target assumptions

These are the load-bearing portability constraints. A target repo:

- **is a Git repo** — drift:ai resolves the repo root via
  `git rev-parse --show-toplevel`;
- **may use pnpm, npm, yarn, or bun** — any package manager, or none;
- **does NOT need Bun installed** — Bun is the _tool_ runtime, in the tools
  checkout, not a target dependency;
- **may have no `node_modules` installed at all** — checks that need a resolver or
  a vendored binary skip cleanly with a reason rather than crashing (this is the
  _common_ foreign-repo case; OpenClaw had nothing installed);
- **may be a shallow / blobless clone** — `current` scope still works. If
  `changed` scope cannot diff because history or objects are unavailable,
  drift:ai exits with a clear error instead of surfacing a raw git crash.

## Config discovery

Config is discovered from the **target repo** (the cwd), not the tools checkout:

- With no `--config`, drift:ai looks for `drift-ai.config.json` at the **target
  repo root**. If absent, it falls back to built-in defaults (universal ignore
  segments like `node_modules`/`dist`/`build`, etc.).
- `--config <path>` loads an explicit file, resolved relative to the cwd (the
  target repo).

The `drift-ai.config.json` committed **in this repo** is **Musi's own config**
(its source roots, its ghost-file allow-pairs). It is **not** a default applied to
other repos — a foreign target gets the built-in defaults unless it supplies its
own config.

### Starter config

A target repo can start from a generic example and adapt it. A copyable
[`drift-ai.config.example.json`](../../drift-ai.config.example.json) lives at the
repo root. Copy the fields that fit your target and delete roots or globs that do
not apply.

Any example config is an **illustrative starting point**, not an authoritative
default. drift:ai's built-in defaults (universal ignores, etc.) are the real
defaults; the example just shows the shape and common knobs.

Top-level `coverage.artifacts` is an evidence-source list for prototype coverage
surfaces. Each entry is read-only and has a repo-relative artifact path plus a
free-text label such as `unit`, `e2e`, or `prod`; artifacts are kept separate in
output and are never silently unioned.

### The `config` subcommand (read-only inspection)

`config` answers "what config will drift:ai actually use here?" before you run a
scan. When a sweep skips files or runs unexpected checks, it confirms which config
was auto-discovered, which roots are in effect, and what defaults were filled in —
without having to run the whole report first.

```sh
cd <target-repo>
bun <tools-checkout>/scripts/drift-ai.ts config
bun <tools-checkout>/scripts/drift-ai.ts config --config drift-ai.config.json
bun <tools-checkout>/scripts/drift-ai.ts config --format json --output effective-config.json
```

It is **strictly read-only**: it loads and normalizes config exactly as a scan
would (same auto-discovery, same `--config` override), then renders the result. It
runs no checks and **never creates, rewrites, or normalizes a config file on
disk** — generating a `drift-ai.config.json` is deliberately out of scope.

Like the other subcommands it anchors discovery to the **target** repo (the cwd's
`git --show-toplevel`), not the tools checkout, so the reported roots and repo
root describe the repo you are scanning. The output names:

- the **config source** — `default` (no file; built-in defaults), `auto-discovered`
  (`drift-ai.config.json` at the target root), or `explicit` (a `--config` path);
- the **repo root** used for discovery;
- the **roots** and **source extensions** (built-in extensions plus any
  `additionalSourceExtensions`) the scan would consider;
- the **default check set** (a no-`--check` run) and the **implemented check set**
  (everything `--check all` enables).

Text output is a concise summary; `--format json` carries the full effective
config (ignore rules, per-check config, `coverage`, `envDefine`) under a
`kind: "config-inspection"` envelope. That envelope is intentionally **not** the
portable `DriftReport` (`--format json` on a scan) nor a `kind: "advisory"` row, so
a consumer can tell an inspection from a scan or an advisory at a glance.

## The `hotspots` subcommand (advisory)

```sh
cd <target-repo>
bun <tools-checkout>/scripts/drift-ai.ts hotspots \
  [--lens churn|coupling|fragmentation|suppression-churn|thrash|all] [--window 14] \
  [--top 20] [--min-support 3] [--baseline <prev.json>] [--format text|json] [--output <path>]
```

`hotspots` is a **report-only advisory** over a windowed `git log` walk — areas
that change a lot, surfaced as evidence for a human to weigh. It is **not** a
finding and is deliberately firewalled from the trusted checks:

- It is reachable **only** via `drift:ai hotspots` — never folded into
  `--check all` or the default report, and there is no `hotspots` check id.
- Its JSON top level is `{ "kind": "advisory", "sections": [...] }` — never the
  `findings` shape, never `WARN`/`FIX`. Each section is one lens.
- Every run prints a legible header (lens, window, commit count, churn metric,
  and a "not defects" banner) plus the complexity disclaimer — complexity is a
  lint-baseline concern, not a hotspot lens.

Lenses (`--lens`, default `churn`; `all` fans out to every implemented lens):

- **`churn`** — top files by churn (`revisions`, or `lines` on a squash repo). A
  _thresholded_ list, not a fixed top-N: a file shows only if it stands out (≥2×
  the in-window median); a flat distribution prints "no clear hotspots this
  window" and **zero** rows rather than padding to N.
- **`coupling`** — files that change together (co-change). Symmetric score
  `coOccur / min(revs)`. **Cross-boundary** pairs (different top path segment)
  sort to the top as the louder signal. Two structural legibility controls keep
  the list readable on large repos (they are **not** file classification):
  `--min-support` (default 3) drops the long tail, and a per-node degree cap (5)
  bounds how many partners any one file (a barrel/lockfile/locale) can
  contribute, so a clique stays _bounded but visible_, never auto-filtered. Wide
  commits (> 40 files) are skipped as sweeps.
- **`fragmentation`** — files touched by many distinct hands in-window: commit
  authors plus distinct `Co-authored-by` trailer identities, which surfaces agent
  hands in the same count. Default threshold is 3 distinct hands.
- **`suppression-churn`** — its own `git log -G'eslint-disable|@ts-'` pass for
  files that repeatedly gain or lose lint/type suppressions over the window.
  Default threshold is 2 suppression-changing commits.
- **`thrash`** — files with repeated edits but low net growth, with overlay
  columns for young-in-window age, fix/revert subject count (a tiebreaker only),
  and test-vs-source churn ratio. It needs line counts, so blobless checkouts
  report that the lens cannot compute instead of guessing.

Every hotspot row carries the cheap context that makes a human's judgment fast:
top authors/agents (from commit + `Co-authored-by` trailers), the 3 most-recent
commit subjects, regex commit-intent labels over those displayed subjects
(`fix`, `refactor`, `scaffold`, `generated`, `update`, or `unknown`), the **raw**
numbers behind any score, and a copy-paste `git log` inspect command. Intent
labels are overlay context only; they do not create rows or gates. Pass
`--baseline <prev.json>` (an earlier advisory JSON) to tag each row `↑NEW` /
`↑+N` / `↓-N` / `=steady` vs the prior run. (If the baseline measured churn with
a different metric — e.g. a squash run recorded `lines` — the churn deltas are
omitted and the header says so, since the scores are not comparable.)

Behavior worth knowing:

- **Whole-repo**, not `--scope`-gated; it has its own time axis. It reuses
  `isIgnoredPath` + your `ignore` config for path filtering and **nothing more**
  (no generated/codegen/i18n auto-detection — evidence, not verdicts, so the
  top-N can look noisy; you discount your own lockfiles/changelogs).
- **Window** defaults to 14 days (AI cadence). Sparse history widens the window
  automatically up to 180 days and **says so** in the header.
- **Churn metric** is `revisions` by default; on a suspected squash-merge
  workflow (most files single-revision in-window) it auto-switches to `lines` and
  discloses the switch.
- **Blobless partial clones** (`--filter=blob:none`) have no blob content, so the
  walk falls back to `git log --name-only`: revision counts stay exact, but
  per-file line counts are reported as unavailable (the header says so).

## Prototype advisory lane (heavy/experimental lenses)

Heavy, noisy prototype lenses are indexed in this README but documented in
focused files so the supported quick-reference stays skimmable:

- [Prototype advisory contract](docs/prototype-contract.md) defines the
  `kind: "advisory"`, `lane: "prototype"` envelope, partial-run disclosures,
  caps, prerequisites, and no-findings firewall.
- [Prototype subcommands](docs/prototype-subcommands.md) covers
  `clone-candidates`, `dolos-candidates`, `semgrep-candidates`,
  `coverage-evidence`, `coverage-unused-exports`, `env-branches`, `ownership`,
  `test-orphaning`, `birth-size-delta`, and `class-construction`.
- [Prototype calibration infrastructure](docs/prototype-calibration.md) covers the
  bounded full-history helper, clone/dead-code corpora, sibling naming classifier,
  and class-construction inventory.

Prototype subcommands are not check ids, are not included in `--check all`, and
never emit `DriftFinding` rows. Treat their output as review leads until a lens
earns promotion.

## Musi-only subcommands

`harness-freshness` is intentionally Musi-specific. It checks
`docs/ai-harness.md` against `docs/guides`, so it remains a separate subcommand
and is not part of the portable default check surface. The underlying function
already accepts `harnessPath` and `guidesDir` options if another repo ever needs
to call it directly, but no portable CLI flags are wired for that layout today.
Like `hotspots`, it runs on the shared subcommand arg parser, so it honors
`--format text|json` and `--output`.

## Musi-only `HarnessDiagnostics` sidecar

Set `HARNESS_DIAGNOSTICS_OUTPUT=<path>` and drift:ai also writes a shared
`HarnessDiagnostics` envelope to that path. This is opt-in and **Musi-only**: it
exists so the broader harness (`harness:audit`, fusion lanes) can consume drift
results without parsing the text report or the drift-specific JSON.

```sh
HARNESS_DIAGNOSTICS_OUTPUT=reports/drift-diagnostics.json bun run drift:ai
```

How it differs from `--format json`:

- `--format json` is the **portable** report surface: the full `DriftReport`
  (scope, enabled/skipped checks, every finding) for any target repo. The sidecar
  is a **projection** onto the shared schema — drift findings become `warn`
  entries, skipped checks become `info` entries (so an absent check is never read
  as a clean pass), and enabled-but-clean checks emit nothing.
- The sidecar's `control` ids resolve in Musi's `harness.controls.json`, so it is
  meaningless against a foreign target; for foreign repos use `--format json`.
- On a successful write, native stdout and any `--output` / `--chunk-dir` files
  are unchanged; the sidecar is written in addition to them. An unset or empty
  value writes nothing. An unwritable path or a failed schema validation is a
  CLI/tool error (exit `2`), never a drift finding: the run then reports that
  tool error (so a stdout-bound report is replaced by the error message, while
  any `--output` / `--chunk-dir` files written before the failure survive). The
  report-only exit contract (`0`, or `1` only under `--fail-on-findings` /
  `--fail-on-runtime-cycles`) is otherwise preserved.

## Updating

When drift:ai's dependencies change, re-run `bun install` **in the tools
checkout**. Nothing in any target repo changes — targets never depend on
drift:ai's implementation deps.

## Known gaps (tracked)

The contract above is the _supported_ behavior. A few pieces are still being
brought fully in line with it:

- **Additional portable checks.** More plugin-style checks and adapter skip
  reasons are tracked in the backlog; the current default surface stays limited
  to checks that can run usefully across arbitrary TypeScript repos.

For maintainers, the drift:ai task pack is complete; its archive summary and the
contract's rationale live in
[`docs/agent_notes/finished_work/drift-ai-next-items.md`](../../docs/agent_notes/finished_work/drift-ai-next-items.md)
(the individual leaves, including `01-shared-context.md`, are in git history before
the pack folder was removed).
