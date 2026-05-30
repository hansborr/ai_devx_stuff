# 42 — Hotspots: further lenses (incremental checklist)

Status: Done
Track: H (hotspots subcommand)
Size: Large (a checklist of sub-lenses — pick **one at a time**, ship
incrementally; this is not a single PR)
Depends on: 40 (history collector + subcommand scaffold)
Blocks: none

> **Landed 2026-05-29.** Completed the remaining git-only lenses:
> `fragmentation` (distinct authors plus `Co-authored-by` trailer hands),
> `suppression-churn` (own `git log -G'eslint-disable|@ts-'` content pass), and
> `thrash` (low net-growth repeated edits with young-file, fix/revert, and
> test-churn overlays). `--lens all` now emits all five sections. One validation
> delta: blobless partial clones cannot safely run the v4 content scan, so
> suppression-churn skips with a clear reason when line/blob content is
> unavailable. OpenClaw read-only validation: fragmentation surfaces the expected
> high-author files (authorHands 48 on `src/agents/.../attempt.ts`; distinct
> hands are higher when trailers are counted), while thrash and
> suppression-churn disclose blobless limitations instead of hanging.

## Goal

Add the remaining **git-only** hotspot lenses, each as a separate sub-task layered
on task 40's collector. Each lens is a different reduction over the same windowed
walk; a file appearing in **multiple** lens sections is the loud,
cross-validated signal.

Task 41 now ships both first lenses (`churn` and `coupling`). This task adds the
rest. They can be picked in any order; see "lens ordering" below.

## Background

Read [`01-shared-context.md`](./01-shared-context.md),
[`02-seam-map.md`](./02-seam-map.md), task 40, and task 41 (shared
actionability + advisory shape). Deep rationale:
`../drift-ai-hotspots-brainstorm.md` §1.4 (lens roadmap), §1.6 (resolved knobs),
appendix #2 (OpenClaw).

Every lens here obeys the same contracts: report-only, advisory brand firewall
(40), evidence-not-verdicts (no recommendation, no generated/i18n auto-filter —
01 §3), and the shared actionability columns + thresholded list length from 41.
All hotspot lenses are git-only. The former churn × complexity v5 is closed as
won't-do because lint-baseline adapters own complexity-rule findings directly.

## Seams to touch

(Anchors from `02-seam-map.md`, verified 2026-05-29 — re-confirm before editing.)

- Task 40 collector (`scripts/drift-ai/hotspots/history.ts`): per-commit records
  incl. numstat, author, co-author/trailer lines, subject. Each lens is a
  reducer registered under a `--lens <name>` value.
- `git-changed-scope.ts:99–109` `isIgnoredPath` — path filtering only (01 §3).
- v4 reuses the temporal angle of the existing `suppressions` check
  (seam-map §2, `report-builder.ts:86–94`) — but as a `git log -G` history scan,
  not the diff scanner.

## What to do (sub-lenses)

This is a checklist task (01-shared-context's checklist variant): the sub-lens
boxes below **are** the what-to-do. Pick one, ship it, repeat. Each gets its own
section in the advisory output (a file appearing in several sections is the
signal). Each box leads with a **Consumes:** line naming the exact task-40
collector field(s) it reduces over, so each sub-lens is pickable standalone —
and so the one seam distinction that matters (v4 needs its *own* git pass, it
does **not** reduce over the collector) is impossible to miss.

### v2 — Thrash (one lens, overlay columns)

**Consumes:** task-40 collector's numstat `net_lines` (added − deleted, per file)
+ each file's **first-in-window commit age** (for the young-file overlay). No
extra git pass; all from the collector's per-commit records.

"Edited a lot but not growing" — code being reworked, not built. One lens with
overlay columns, not several lenses:
- **Net-growth core**: `net_lines / revisions` below a small threshold ⇒
  editing-not-growing (lots of churn, little net change). This is the primary
  signal.
- **Young-file overlay**: flag files *created* in-window that are already heavily
  thrashed/abandoned — ties to the existing **ghost-files** intuition ("created
  then thrashed"). Cheap: derive age from the first in-window commit touching the
  file.
- **Revert/fix tiebreaker**: message-grep for `revert`/`fix`/`hotfix` subjects
  on the file — **advisory only, accept false positives** (a tiebreaker among
  already-thrashy files, never a standalone flag).
- **Test-vs-source ratio**: how much of the churn is test files vs source.
- **SCOPE OUT** the expensive `git blame` line-age signal — it is
  `O(commits × file-size)` and does not pay for itself. Use the **cheap
  young-file overlay** (first-in-window-commit age) instead.

### v3 — Author / agent fragmentation

**Consumes:** task-40 collector's **author** field + **co-author/trailer** fields
(per commit). No extra git pass; no numstat needed. No complexity engine, no
merge commits.

Count **distinct hands per file in-window**: distinct authors **plus** distinct
co-author/trailer identities (trailers let you count **agent** hands
specifically). This is the **squash-robust replacement** for
merge-conflict-frequency (which dies under squash-merge; see Out of scope).
Needs **no complexity engine and no merge commits**.

**OpenClaw says this may be the single strongest git-only signal of the whole
run:** author fragmentation max = **48 distinct authors/file**. A file touched by
48 people is *definitionally invisible to any one of the 48* — exactly the blind
spot drift:ai exists to surface. **CONSIDER promoting v3 ahead of v2 thrash**
(see lens ordering). It is cheap (author + trailer parse already in 40's
records), low-FP, and high-value.

### v4 — Suppression-churn hotspots

**Consumes:** NOTHING from task 40's collector. **This sub-lens adds its OWN
second git walk** — task 40's collector does numstat + author + subject +
trailers, **not** a content scan, so it has no signal about which lines gained or
lost a suppression. v4 needs a separate pass (`git log -G'eslint-disable|@ts-'`
or `-S` for exact strings) to find files that churn suppressions. State this seam
distinction loudly so a picker does not assume the collector already carries it.
(It still reuses 40's window resolution, `isIgnoredPath`, header, and advisory
shape — only the *data source* is a new git pass.)

`git log -G` (or `-S`) for files **repeatedly gaining/losing**
`eslint-disable` / `@ts-expect-error` / `@ts-ignore` / `@ts-nocheck` in-window.
A file that keeps adding and removing suppressions is fighting its own types/lint.
Cheap, low-FP, and the **most "drift:ai-flavored"** hotspot — it extends the
existing `suppressions` check (seam-map §2) onto the **temporal** axis (the
existing check is point-in-time on the diff; this is "how often over the window").

### Per-lens output

Each lens renders its own **section** in the advisory output (40's shape +
41's actionability columns + thresholded length). The cross-lens payoff is that
a file surfacing in **multiple** sections is the loud, cross-validated signal —
make that easy to see (e.g. a small "also in: thrash, fragmentation" annotation,
if cheap).

## Open decisions

- **Lens ordering.** The original roadmap order is v2→v3→v4, but OpenClaw argues for
  **v3 author/agent fragmentation FIRST** (max 48 authors/file — arguably the
  strongest, cheapest, lowest-FP git-only signal; no merge commits, no engine).
  **Recommendation: ship v3 first, then v4 suppression-churn (also cheap,
  low-FP, on-brand), then v2 thrash.** Surface this; the numbers support
  reordering.
- **v2 net-growth threshold** and **v3/v4 window** — tune against live repos;
  surface in the header.

## Locked decisions

- **No v5 churn × complexity lens.** Complexity is already covered by the
  `ai_devx_stuff-lint` baseline adapter from task 30, so a hotspot complexity
  lens would be redundant and fuzzier than the direct lint result.

## Testing

- **Per sub-lens, unit-test the reducer on fixture `git log` output** (injected
  `GitRunner` fake, no `vi.mock`):
  - v2: net-growth math, young-file overlay (age from first in-window commit),
    revert/fix message-grep tiebreaker (assert it only re-ranks, never flags
    alone), test-vs-source ratio.
  - v3: distinct-author counting and distinct co-author/trailer counting
    (assert agent trailers are counted as distinct hands).
  - v4: `git log -G` parse for suppression add/remove churn over the window.
- **Live (read-only) on OpenClaw** (`/home/node/tmp/openclaw`; `git log` works):
  - **v3 fragmentation**: expect max **~48** distinct authors/file — the headline
    validation cut. Keep OpenClaw read-only.
  - v2/v4: sanity-check the reducers produce plausible sections.
- Run the existing drift-ai vitest suite before/after each sub-lens.

## Out of scope

- **Merge-conflict-frequency as a standalone lens** — superseded by v3
  (fragmentation), and it has a **fatal squash dependence** (squash-merge erases
  the conflict signal). Do not build it.
- **Standalone cadence / AI-signature lenses** — these are useful as
  **window-sizing** inputs (cadence) and **attribution overlays** (AI-signature
  on rows), **not** as their own top-level lenses. Fold them in as overlays, not
  sections.
- The collector, subcommand scaffold, brand firewall, and shared actionability
  layer (tasks 40 and 41 — this task consumes them).
- Generated/i18n auto-filtering (01 §3).
