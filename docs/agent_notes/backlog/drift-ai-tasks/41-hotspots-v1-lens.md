# 41 — Hotspots: first lenses

Status: Done
Track: H (hotspots subcommand)
Size: Medium
Depends on: 40 (history collector + subcommand scaffold)
Blocks: none

> **Landed 2026-05-29.** Both required lenses shipped on task 40's collector.
> Modules: `hotspots-churn.ts` (thresholded top-N: standout ≥2× median, never
> pads), `hotspots-coupling.ts` (symmetric `coOccur/min(revs)`, cross-boundary =
> first-path-segment differs, minSupport 3 + per-node degree cap 5 + sweep cap 40,
> all surfaced in the header), `hotspots-actionability.ts` (shared per-row context:
> authors/agents from commit + `Co-authored-by` trailers, 3 recent subjects, raw
> numbers, copy-paste inspect command, `--baseline` delta tagging). The advisory
> JSON shape moved from a flat `hotspots: []` to `sections: HotspotSection[]`
> (discriminated by lens) so `--lens all` and future lenses compose; brand firewall
> preserved (`kind: "advisory"`, no `findings`/WARN/FIX). New flags: `--top`,
> `--min-support`, `--baseline` (degreeCap/sweepCap surfaced as defaults, not
> flags). Validated read-only on OpenClaw (30d, 15,454 commits, blobless →
> revisions-only): the predicted discord↔config cross-boundary coupling surfaces
> near the top (`extensions/discord/src/config-schema.test.ts ↔
> src/config/zod-schema.providers-core.ts`, 17×); lockfile/CHANGELOG cliques are
> bounded by the degree cap, not filtered; churn top-N is the realistic noisy list
> (CHANGELOG 3678, package.json, pnpm-lock, generated `.sha256`), unfiltered. Musi:
> coupling surfaces `.claude/… ↔ .codex/…`, baseline round-trip tags all `=steady`.
> Durable decisions (sections shape; cross-boundary = first segment; standout
> factor 2; legibility controls vs file classification) are in `LOG.md`.

## Goal

Ship the first two real hotspot lenses — **churn** and **co-change coupling** —
as reductions over task 40's shared collector, with per-row actionability
context. Both lenses are product requirements; implementation order is flexible.

## Background

Read [`01-shared-context.md`](./01-shared-context.md),
[`02-seam-map.md`](./02-seam-map.md), and task 40. Deep rationale:
`../drift-ai-hotspots-brainstorm.md` §1.3 (co-change), §1.8 (actionability),
appendix #2 (OpenClaw numbers).

These lenses are still **git-only** — no complexity engine, no merge commits.
They reduce over the per-commit records task 40 produces and render into the
advisory shape (40's brand firewall: `{ kind: "advisory", hotspots: [...] }`,
banner, legible header). They must obey evidence-not-verdicts (01 §3): no
recommendation, no generated/i18n auto-filtering.

## Required lenses

- **Temporal co-change coupling** — higher ceiling, novel, the brainstorm's
  flagship. Surfaces files that *change together* across commits, especially
  across package boundaries.
- **Churn top-N with context columns** — simple, unimpeachable math that answers
  "what changed a lot recently?" It also proves the collector + actionability
  context plumbing with a count. Led by noisy entries on real repos (see
  OpenClaw), which is exactly the evidence-not-verdicts demo.

Both are useful and should ship. Co-change is the differentiated value: OpenClaw
confirms rich cross-package signal worth surfacing
(`extensions/discord/config-ui-hints ↔ src/config/zod-schema.providers-core`,
23×). Churn is the direct "changed a lot" view users will expect. If an
implementer wants to split the work, either lens may land first as long as the
other remains in this task's required scope.

## Seams to touch

(Anchors from `02-seam-map.md`, verified 2026-05-29 — re-confirm before editing.)

- Task 40's collector module (`scripts/drift-ai/hotspots/history.ts`) and
  subcommand handler — register `--lens coupling` and `--lens churn`.
- `git-changed-scope.ts:99–109` — `isIgnoredPath`: filter every pair *member*
  (and every churn entry) through it. **Only** ignore filtering; no
  generated-file classification (01 §3).
- 40's advisory header/banner/JSON shape (brand firewall) — this lens emits into
  it, never into `DriftFinding`/`CHECK_RUNNERS`.

## What to do

### Co-change coupling

Computation:
- Walk: `git log --no-merges --since=<window> --format=%x00%H --name-only`
  (reuse 40's collector walk; co-change only needs the per-commit **file set**,
  not numstat).
- For each commit whose changed-file set has size `2..K`, increment
  `coOccur[(a, b)]` for every unordered pair and `revs[f]` for every file.
- **Cap K** (skip wide commits as sweeps, e.g. `> 40` files = a rename/format/
  lockfile-bump sweep, not coupling). Surface the cap value.
- Filter every pair member through `isIgnoredPath`.
- **Score** `coOccur / min(revs[a], revs[b])` (symmetric "they almost always
  move together"), or asymmetric `coOccur / revs[a]` ("when a changes, b
  usually does too"). Surface which.
- **Require `coOccur ≥ minSupport`** — drop pairs that co-changed only a handful
  of times (noise).
- **Cross-boundary pairs sort to the top**: pairs whose top path segments differ
  (e.g. `extensions/discord/…` vs `src/config/…`) are the loud signal; rank them
  above same-directory pairs.

**Two MANDATORY legibility controls (OpenClaw-validated, repo-agnostic):** raw
co-change on OpenClaw yields **~65k pairs** and an **i18n locale clique** (every
locale file co-changes with every other locale file, producing a dense
all-pairs blob that swamps the top-N). The lens MUST therefore enforce **both**:

1. **Min-support threshold** (`coOccur ≥ minSupport`) — cuts the long tail of
   incidental pairs.
2. **Per-node degree cap** — cap any single file's co-change *degree* (the number
   of distinct partners it contributes to the top-N), so one barrel/config/
   locale that pairs with everything cannot drown the list. After the cap, that
   file contributes at most its top-`d` partners.

These are **structural legibility controls, NOT generated-file classification** —
they work the same on any repo and never name a file as "ignorable". The locale
clique is *controlled* (capped), still visible, not filtered away. (01 §3 holds.)

Expected on OpenClaw: the discord↔config coupling (`23×`) surfaces near the top
as a cross-boundary pair; the locale clique is bounded by the degree cap rather
than dominating.

### Churn top-N with context columns

Top-N files by churn metric (40's `revisions` or `lines`), each row carrying the
full actionability context below. Expect a realistic noisy top-N on OpenClaw
(`CHANGELOG.md`, lockfile, i18n) — **do not auto-filter**; show it, and say so in
docs so readers expect it (the evidence-not-verdicts demo). This is mostly
plumbing on top of 40.

### Actionability (applies to both lenses — brainstorm §1.8)

Every hotspot row carries enough context to act without a second tool:
- **Top authors/agents** for the file/pair in-window (from 40's author +
  co-author/trailer parse — trailers let you attribute *agents*).
- **3 most-recent commit subjects** touching it.
- **The RAW numbers behind any score** (`coOccur=23, revs[a]=31, revs[b]=40`
  for a pair; `revisions=208` for churn) — never just a normalized score. The
  reader supplies judgment; give them the inputs.
- **A copy-paste inspect command** (e.g.
  `git log --oneline -- <path>` or `git log -- <a> <b>`).
- **`--baseline <prev.json>` delta framing.** Given a prior advisory JSON, tag
  rows `↑NEW`, `↑↑+5` (climbed), `=steady`, etc. This needs persisted JSON, so
  **JSON is the substrate** — the text view is rendered from the same data.
- **Thresholded list length.** When the distribution is flat (no file/pair stands
  out), say **"no clear hotspots this window"** and show **fewer or zero** rows.
  **Never pad to N.** A short or empty list is a faithful answer.

## Open decisions

- **`minSupport` default** (coupling). Too low → 65k-pair noise; too high → only
  the obvious pairs. Start small (e.g. `3`) and tune against OpenClaw's known
  pairs; surface the value in the header.
- **Per-node degree cap default** (coupling). Start modest (e.g. `5` partners/node)
  so the locale clique is bounded without hiding a genuinely central file;
  surface the value.
- **Symmetric vs asymmetric score** (coupling). Symmetric
  `coOccur/min(revs)` reads as "move together"; asymmetric `coOccur/revs[a]`
  reads as "a drags b". Recommend symmetric for v1 (simpler to explain); note
  the asymmetric variant for a later overlay.
- **Sweep cap K** (coupling). Default ~40 files/commit; surface and tune.

## Locked decisions

- **Both churn and coupling ship.** They answer different questions and are both
  part of the hotspot product shape. Implementation order is not product
  sensitive.
- **No complexity engine in this task.** Complexity signals are covered by
  lint-baseline adapters, not hotspots.

## Testing

- **Unit tests on fixture log output** (injected `GitRunner` fake, no `vi.mock`):
  - **Coupling**: pair-counting, `minSupport` filtering, per-node degree cap, the
    sweep cap K, cross-boundary sort. Include a small "locale clique" fixture
    (N files all co-changing) and assert the degree cap bounds each node's
    contribution rather than letting the clique dominate. Include a clean
    cross-boundary pair and assert it sorts to the top.
  - **Churn**: top-N selection, thresholded-length behavior (flat distribution →
    "no clear hotspots", zero/few rows, no padding).
  - **Actionability**: assert raw numbers + inspect command present per row;
    `--baseline` delta tagging against a prior fixture JSON.
- **Live (read-only) on OpenClaw** (`/home/node/tmp/openclaw`; `git log` works):
  - Coupling: expect the `extensions/discord/config-ui-hints ↔
    src/config/zod-schema.providers-core` coupling (`23×`) near the top as a
    cross-boundary pair; expect the i18n locale clique to be **controlled by the
    degree cap**, not dominating the top-N.
  - Churn: expect a realistic noisy top-N (CHANGELOG/lockfile/i18n) and confirm
    nothing is auto-filtered.
  - Keep OpenClaw read-only.
- Run the existing drift-ai vitest suite before/after.

## Out of scope

- Thrash, author/agent fragmentation, and suppression-churn lenses (all task 42).
- Any complexity engine or churn × complexity lens; complexity belongs to
  lint-baseline adapters.
- Generated/i18n auto-filtering — min-support + degree-cap are structural
  legibility controls, not file classification (01 §3).
- The collector itself, the subcommand scaffold, and the brand firewall (task
  40 — this lens consumes them).
