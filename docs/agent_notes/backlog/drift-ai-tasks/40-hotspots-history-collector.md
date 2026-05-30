# 40 — Hotspots: shared history collector + subcommand scaffold

Status: Done
Track: H (hotspots subcommand)
Size: Medium
Depends on: none (only the existing Git seam)
Blocks: 41 (v1 lens), 42 (further lenses)

> **Landed 2026-05-29.** Modules: `hotspots-history.ts` (collector + parser +
> window/squash guards + blobless `--name-only` fallback), `hotspots.ts`
> (subcommand runner + churn placeholder reduction), `hotspots-format.ts`
> (advisory shape + text/JSON), `subcommand-args.ts` (shared subcommand parser,
> also retrofitted onto `harness-freshness`). Validated read-only on OpenClaw
> (4,134 non-merge commits/14d; `--name-only` fallback on the blobless clone;
> squash guard correctly does not fire) and on Musi. One delta from the task as
> written: the collector detects **blobless partial clones** and falls back to
> `git log --name-only` (revisions exact, line counts disclosed as unavailable) —
> `--numstat` hangs fetching blobs on OpenClaw's `blob:none` clone, which the task
> had not anticipated for hotspots (it only flagged shallow-clone `git diff`).

## Goal

Build the **shared windowed git-history collector** that every hotspot lens
reduces over, plus the `hotspots` subcommand scaffold, its brand firewall, and a
mandatory legible header. This is **the real v1 / foundation of Track H** — not
the lens math. The git-only signals are the value; the collector is what makes
them cheap and faithful. No lens computation lives here (that is 41/42); this
task ships the collector + scaffold + a trivial placeholder reduction (e.g. raw
revision count) only as far as needed to prove the pipeline end-to-end in text
**and** JSON.

Framing to carry through the whole track: **churn × complexity is not a hotspot
lens.** Complexity is covered by the lint-baseline adapter direction from task
30, where `ai_devx_stuff-lint` rules can report it directly. Hotspots stays
git-only: collector + churn, co-change, thrash, fragmentation, and
suppression-churn lenses.

## Background

Read [`01-shared-context.md`](./01-shared-context.md) and
[`02-seam-map.md`](./02-seam-map.md) first. Deep rationale:
`../drift-ai-hotspots-brainstorm.md` §1.2 (the collector), §1.5 (squash), §1.7
(integration), §1.9 (brand firewall/naming), appendix #2 (OpenClaw); and
`../drift-ai-hotspots-subcommand.md` (the original note: locked window decisions,
config shape, open knobs).

Why a **bespoke subcommand**, not a `CheckPlugin`: hotspots has its own *time
axis* (a history window), makes **no recommendation**, and must be
**brand-firewalled** from the trusted findings stream so a fuzzy heuristic can
never lower trust in the precise checks (`suppressions`, `ghost-files`, …). The
existing `harness-freshness` subcommand (seam-map §1, `runner.ts:82`) is the
precedent: a dispatch branch outside the `CHECK_RUNNERS` registry.

Why a *shared* collector: every lens in 41/42 (churn, co-change, thrash,
author/agent fragmentation, suppression-churn) is a different **reduction over
the same windowed commit walk**. Walk once, reduce many. This keeps each lens
cheap and keeps parsing correctness in one place.

## Seams to touch

(Anchors from `02-seam-map.md`, verified 2026-05-29. The source moves —
re-confirm each line before editing.)

- **§5 Git seam** — reuse, do not reinvent:
  - `git-changed-scope.ts:18` — `GitRunner = (args: readonly string[]) => string`
    (the injected runner; the collector takes one, defaults to `defaultGitRunner`).
  - `git-changed-scope.ts:20–22` — `defaultGitRunner` (wraps
    `execFileSync("git", …)`).
  - `git-changed-scope.ts:99–109` — `isIgnoredPath` (segments, prefixes, globs,
    then `DEFAULT_IGNORE_EXTENSIONS`/`DEFAULT_IGNORE_FILES`). **Every collected
    path filters through this and nothing more** (see Out of scope). Note: reuse
    `isIgnoredPath` (path-keyed, takes a single path), **not** `filterScope`
    (`:111–116`, takes `ChangedFile[]`) — the collector's natural shape is a
    path-keyed churn map, not a `ChangedFile[]` (brainstorm §1.6).
- **§1 dispatch** — `runner.ts:81–122` `runDriftAi`; the precedent branch at
  `runner.ts:82–84` (`argv[0] === "harness-freshness"`); the bespoke handler at
  `runner.ts:124–150` (`runHarnessFreshnessSubcommand`, which has **no
  `--format`/`--output` parity** — the wart task 50 fixes).
- **§1 error/exit** — `runner.ts:91–92, 102` (`DriftAiError → exit 2`). The
  subcommand stays report-only: **exit 0**.

New module suggestion: `scripts/drift-ai/hotspots/history.ts` (collector) +
`scripts/drift-ai/hotspots/hotspots-runner.ts` (subcommand handler), mirroring
the `harness-freshness.ts` / `harness-freshness-io.ts` split.

## What to do

### 1. The windowed collector

One windowed `git log` walk via the existing `GitRunner`, parsed into typed
per-commit records: commit hash, author, author-date, committer-date, subject,
co-author/trailer lines, and per-file `{ path, added, deleted }`. Use
`--no-merges` (merges double-count and distort every churn signal). Lenses in
41/42 reduce over these records; this task only needs the records + one trivial
placeholder reduction.

#### Parsing caveats (LOAD-BEARING — keep verbatim in the implementation)

These are correctness traps in `git log --numstat`, not style notes:

- **`--format=...%x00 --numstat` layout.** A pretty-format line is emitted, then
  a `%x00` (NUL) line acts as the **commit boundary marker**, then a **blank
  line**, then the numstat rows. **Parse line-wise**, not by naive splitting:
  - a NUL-only line = commit boundary → start a new record;
  - empty lines → skip;
  - everything else → a numstat row, **tab-split** into `added \t deleted \t
    path`.
  Do **not** `split("\t")` the whole blob and index positionally.
- **Binary files emit `-\t-\tpath`.** Treat each `-` as **0 lines changed**, but
  still **count the file as a revision** (it changed in that commit). A binary
  edit is a real touch; only its line counts are unknown.
- **`--no-renames` is load-bearing for PARSER CORRECTNESS.** With rename
  detection on, git emits arrow-forms in the path column —
  `path/{old => new}/file` and `{old => new}` — which **corrupt any
  `split("\t")[2]`-style path parse**. Pass `--no-renames` and **document why**
  inline, so a future "follow renames across history" feature does not silently
  re-enable rename detection and break the parser. (If follow-renames is ever
  wanted, it needs a real arrow-form parser, not a flag flip.)

#### Path filtering

Filter every collected path through `isIgnoredPath` (`git-changed-scope.ts:99`).
That is the **only** filtering: the existing universal ignore defaults
(`DEFAULT_IGNORE_EXTENSIONS`/`DEFAULT_IGNORE_FILES`) plus the user's `ignore`
config. **Do NOT add generated-file / codegen / i18n detection.** That is the
evidence-not-verdicts contract (01 §3): auto-classifying "ignorable" files on an
arbitrary target is an unwinnable, unportable calibration treadmill. Show the
realistic (sometimes noisy) result; the reader discounts their own noise.

#### Sparse-history widen-with-note guard

If the in-window commit count is below a floor, **widen the window and REPORT
the window actually used** in the header — never silently. Header form:
`window: 60d (widened from 14d: sparse history, 9 commits < floor 30)`. The
collector returns the *effective* window so the header is honest.

#### Squash detection (reuse the sparse-guard machinery)

A squash-merge workflow makes `revisions` lie (each squashed file appears once).
Heuristic: a **high ratio of single-revision files** in-window. On detection,
either **auto-switch the churn metric to `lines`** (sum of added+deleted, which
survives squashing) **or skip-with-reason**, and **report which** in the header.
Reuse the same "report the adaptation" plumbing as the sparse guard.
**Counterexample to bake into the test/docs:** OpenClaw is near-linear (19
merges / 15,858 non-merge commits in 30d), so `revisions` is faithful there —
the squash guard must **not** misfire on linear history. Use OpenClaw as the
"does not trigger" fixture case.

#### Mandatory legible header

Every hotspots run (text and JSON) emits a header stating, at minimum:
- churn metric in use (`revisions` | `lines`, and whether it was auto-switched);
- window actually used (with widen note if applicable);
- commit count in window;
- `--no-merges` (commits are non-merge);
- no complexity engine; complexity belongs to lint-baseline adapters, not
  hotspots.

This header is part of the brand firewall (see below), not decoration.

### 2. Subcommand scaffold

- Dispatch: add an `argv[0] === "hotspots"` branch in `runDriftAi`
  (`runner.ts:81–122`), mirroring the `harness-freshness` branch
  (`runner.ts:82–84`). Route to a `runHotspotsSubcommand` handler analogous to
  `runHarnessFreshnessSubcommand` (`runner.ts:124–150`).
- **Whole-repo, not `--scope`-gated.** Hotspots has its own time axis; it does
  not reuse `changed`/`current` scope. (It does reuse `isIgnoredPath` and the
  user's `ignore` config for path filtering.)
- **Report-only, exit 0** — same contract as the rest of drift:ai (01 §1).
- **Text + JSON from day one**, via the **shared arg parser** (see §3). Ship a
  trivial placeholder reduction (raw revision count per file, top-N) just to
  exercise text + JSON; real lenses are 41/42.

### 3. Shared arg parser + fix the harness-freshness wart (cross-ref task 50)

`runHarnessFreshnessSubcommand` currently does bespoke arg handling with **no
`--format`/`--output` parity** (seam-map §1, `runner.ts:124–150`). Introduce a
**shared subcommand arg parser** (`--format text|json`, `--output <path>`, and
the universal `--config`) and:
- build `hotspots` on it from day one; and
- **retrofit `harness-freshness` onto the same parser**, eliminating the
  second-class-surface wart. Coordinate with **task 50** (which owns the
  harness-freshness retrofit / subcommand-surface unification) so the parser is
  introduced once, not twice. If 50 lands first, build on its parser; if this
  lands first, 50 consumes the parser this task introduces. Note the dependency
  explicitly in both files.

### 4. Brand firewall (three independent layers — brainstorm §1.9)

The whole point of a subcommand is that hotspots is **never** confused with a
trusted finding. Enforce all three:

1. **Vocabulary.** JSON top level is `{ "kind": "advisory", "hotspots": [ … ] }`
   — **never** the `findings` shape, never `WARN`/`FIX`, never the
   `DriftFinding` type. Text uses "hotspots", not "WARN check: … / FIX: …".
2. **Invocation.** Reachable **only** via `drift:ai hotspots`. **Never** folded
   into `--check all` or the default report. There is no `hotspots` entry in
   `DriftCheckId`/`ALL_CHECKS`/`CHECK_RUNNERS`.
3. **Framing.** The mandatory header (§1) **plus** a one-line banner:
   *"Areas to check, not defects. drift:ai makes no claim these are problems."*

### 5. Naming

`drift:ai hotspots --lens churn|coupling|thrash|all`. This task wires the
`--lens` flag and the dispatch table; it ships only a placeholder reduction
behind it. `churn` is the natural placeholder name for the trivial reduction;
`coupling`/`thrash`/etc. land in 41/42.

## Open decisions

- **Window default.** The subcommand note locks **14d** (AI-cadence reasoning;
  agents compress months of human churn into days, so 180d — the classic
  human-team hotspot default — is far too long). The brainstorm's knob #1 prefers
  a **dynamic-range gate over an absolute `minCommits` floor**: widen the window
  until the rank-N file has churn ≥ ~3× the median churn of the in-window touched
  set (cap at a `maxWindow`, e.g. 180d), keeping only a tiny absolute backstop
  (`commits ≥ 5`) to avoid running on a near-empty repo — because the note's own
  intent ("top-of-list counts aren't all 1–2") is a *distribution* property, not
  a commit count. **Present both; do not force-resolve.** Recommendation: ship
  14d as the documented default *with* the sparse-history widen-with-note guard
  (§1) as the dynamic backstop — they compose (start at 14d, widen until the
  dynamic-range gate is met or `maxWindow`, always report the effective window).
- **Primitive: time window vs commit count.** A `--since=<window>` time window is
  the natural git primitive and matches the AI-cadence framing; a
  `--last <N commits>` primitive is more stable across bursty repos.
  Recommendation: time window primitive with the commit-count *floor* as the
  widen trigger — gets both behaviors from one knob. Surface the choice.

## Testing

- **Unit-test the parser against fixture `git log` output** via an **injected
  `GitRunner` fake** (DI pattern, no `vi.mock` — 01 §4). Fixtures must cover:
  - the `%x00`/blank-line layout (NUL boundary, skipped blanks, tab-split rows);
  - binary `-\t-\tpath` rows (0 lines, still a revision);
  - the `--no-renames` assumption (a fixture containing an arrow-form to prove
    the parser is run with `--no-renames` and would mis-parse without it —
    documents the dependency);
  - sparse-history widen path (assert the reported effective window);
  - squash detection: a high single-revision-ratio fixture (triggers) **and** a
    linear-history fixture modeled on OpenClaw (does **not** trigger).
- **Header**: assert text + JSON both carry metric / effective-window / commit
  count / `--no-merges` / banner; assert JSON top level is
  `{ kind: "advisory", hotspots: [...] }` and contains **no** `findings` key.
- **Live (read-only) validation:**
  - **OpenClaw** (`/home/node/tmp/openclaw`): `git log` cuts work (commit
    metadata present in the shallow clone). Confirm the collector parses a
    ~15k-file / high-velocity repo without choking and that the widen/squash
    guards behave (squash guard does **not** trigger — linear history). Expect
    churn to reach the documented range (max ~208 revisions/30d confirms the
    collector produces real signal). Keep OpenClaw read-only — no installs/edits.
  - **Musi**: run the subcommand end-to-end (`bun scripts/drift-ai.ts hotspots
    --format json`); confirm exit 0, valid advisory JSON, legible header.
- Run the existing drift-ai vitest suite before/after (01 "How to test").

## Out of scope

- Any specific lens math — co-change, thrash, fragmentation, suppression-churn
  (tasks 41 and 42). This task ships the collector + scaffold + a trivial
  placeholder reduction only.
- Any complexity engine or churn × complexity lens; complexity is covered by
  lint-baseline adapters, not hotspots.
- Generated/codegen/i18n auto-detection (forbidden by 01 §3 — `isIgnoredPath` +
  user `ignore` only).
- `--scope`/`changed`/`current` integration — hotspots is whole-repo by design.
- A `--repo <path>` flag (deferred program-wide per 01).
