# drift:ai — portable AI-drift sensor

`drift:ai` is a **report-only** code-quality sensor that flags patterns AI coding
agents tend to introduce: copy/paste duplicates, suspicious sibling modules
(`foo-helpers.ts` beside `foo.ts`), over-narration in comments, and newly added
lint/type suppressions. Opt-in adapters add an `orphan-files` check (a knip
adapter) that surfaces never-imported files and an `import-cycles` check
(ts-morph) that surfaces circular imports. The opt-in `near-duplicates` check
uses ts-morph to find AST-similar functions with renamed variables or reordered
statements. Findings are evidence for a human by default: normal reports exit
`0`, usage/config errors exit `2`, and `--fail-on-findings` is the explicit
opt-in gate that exits `1` when findings exist.

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

| Flag                  | Use                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `--scope changed`     | Default. Diff against `--base main` (or `origin/main`) plus untracked files.                                |
| `--scope current`     | Audit the current working tree inventory. Use this for imported/polluted repos or whole-repo sweeps.        |
| `--check <id>`        | Run one or more checks. Repeat the flag for multiple checks.                                                |
| `--check all`         | Run every implemented check, including the slower opt-in adapters.                                          |
| `--root <path>`       | Limit `current` scope to one or more roots; repeatable. Rejected in `changed` scope.                        |
| `--config <path>`     | Load a specific config. Without it, `drift-ai.config.json` at the target repo root auto-loads when present. |
| `--format text\|json` | Select human-readable or machine-readable output.                                                           |
| `--include-scope`     | With JSON, include the full considered-file scope; otherwise JSON keeps only `scopeCount`.                  |
| `--output <path>`     | Write the primary report to a file.                                                                         |
| `--chunk-dir <path>`  | Also write AI-handoff chunks plus `manifest.json`; `--chunk-size` defaults to 75.                           |
| `--fail-on-findings`  | Keep report rendering, but return exit `1` when findings exist.                                             |

Implemented checks:

| Check             |             Default? | What it reports                                                    | Notes                                                                                                         |
| ----------------- | -------------------: | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `duplicates`      |                  Yes | Copy/paste duplicate blocks                                        | Uses `jscpd`; skips cleanly if the executable cannot be resolved.                                             |
| `ghost-files`     |                  Yes | Suspicious sibling modules such as `foo-helper.ts` beside `foo.ts` | Uses filename tokens and directory peers; configurable allow-pairs for known-good current-state siblings.     |
| `comments`        |                  Yes | Over-narrated files with high comment-to-code ratios               | Honors `checks.comments.excludePrefixes`.                                                                     |
| `suppressions`    | Yes in changed scope | Newly added `eslint-disable` / `@ts-*` suppressions                | Diff-only; skipped in `current` scope with a reason.                                                          |
| `orphan-files`    |               Opt-in | Never-imported files from the target's knip config                 | Adapter finding provenance is `[target-config]`; skips when the target cannot support a trustworthy knip run. |
| `import-cycles`   |               Opt-in | Circular import components                                         | Uses ts-morph/TypeScript resolution; type-only cycles are labeled.                                            |
| `near-duplicates` |               Opt-in | AST-similar function clones missed by exact duplicate detection    | Default engine is in-process ts-morph; findings carry `[drift-baseline]` provenance.                          |

Subcommands:

| Command                              | Purpose                                                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `bun run drift:ai hotspots`          | Advisory git-history lenses (`churn`, `coupling`, `fragmentation`, `suppression-churn`, `thrash`); not a trusted finding stream. |
| `bun run drift:ai harness-freshness` | Musi-only docs freshness check for `docs/ai-harness.md` against `docs/guides` and backtick paths.                                |

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
cd /home/node/tmp/openclaw
bun /workspace/worktrees/exploration/scripts/drift-ai.ts --scope current \
  --root src --root packages --root apps --root extensions --root ui --root config
```

This runs to exit `0` with repo-relative finding paths (e.g.
`src/agents/...`). Run `bun <tools-checkout>/scripts/drift-ai.ts --help` for the
full flag list (`--format text|json`, `--output`, `--check`, `--config`,
`--chunk-dir`/`--chunk-size`, `--jscpd-bin`, `--knip-config`, `--tsconfig`).

### jscpd resolution for the `duplicates` check

The `duplicates` check shells out to `jscpd`. drift:ai resolves the executable
from the **tools checkout** first (its own `node_modules/.bin/jscpd`), then the
target's `node_modules/.bin/jscpd`, so an uninstalled target needs no
`node_modules` of its own — jscpd scans source files and runs with the target as
cwd, keeping finding paths repo-relative. Pass `--jscpd-bin <path>` to point at a
specific executable for odd or hoisted layouts. If jscpd resolves nowhere, the
`duplicates` check is **skipped with a reason** on stderr (the other checks still
run); it never crashes or emits a false-positive finding.

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
- knip itself is missing from the tools checkout (`code: tool-not-installed`).

A skip is an expected absence, not "the target passed this check". Only a knip run
that actually breaks (cannot spawn, or emits unparseable output) produces a single
diagnostic finding. In `changed` scope the reported orphans are intersected with
the changed set; in `current` scope they are intersected with drift:ai's current
inventory after roots, ignores, file checks, and source-extension filtering.

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
already the target. Target selection is owned by
[task 11](../../docs/agent_notes/backlog/drift-ai-tasks/11-target-cd-wrapper.md).

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
commit subjects, the **raw** numbers behind any score, and a copy-paste
`git log` inspect command. Pass `--baseline <prev.json>` (an earlier advisory
JSON) to tag each row `↑NEW` / `↑+N` / `↓-N` / `=steady` vs the prior run. (If the
baseline measured churn with a different metric — e.g. a squash run recorded
`lines` — the churn deltas are omitted and the header says so, since the scores
are not comparable.)

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

## Musi-only subcommands

`harness-freshness` is intentionally Musi-specific. It checks
`docs/ai-harness.md` against `docs/guides`, so it remains a separate subcommand
and is not part of the portable default check surface. The underlying function
already accepts `harnessPath` and `guidesDir` options if another repo ever needs
to call it directly, but no portable CLI flags are wired for that layout today.
Like `hotspots`, it runs on the shared subcommand arg parser, so it honors
`--format text|json` and `--output`.

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

For maintainers, the full backlog and the contract's rationale live in
[`docs/agent_notes/backlog/drift-ai-tasks/`](../../docs/agent_notes/backlog/drift-ai-tasks/00-index.md)
(start with `01-shared-context.md`).
