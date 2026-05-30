# drift:ai — Churn × Complexity Hotspots subcommand (design note)

Status: Design discussion, 2026-05-28. No source changed. Continues the
tools-checkout portability follow-up thread captured in
`drift-ai-improvements.md` (the "2026-05-29" portability update) and
`drift-ai-review/additional-checks-research.md`. The user intends to revisit
this in a future session and then build a v1.

This note exists because the additional-checks research
(`drift-ai-review/additional-checks-research.md:101,185`) **rejected**
"churn × complexity hotspots" (candidate #13) as too slow / advisory / wrong
altitude for the diff sensor. A follow-up discussion re-opened it: the rejection
reasons mostly dissolve once you (a) reimplement the algorithm instead of
adopting `code-maat`, and (b) ship it as a **separate advisory subcommand**
rather than a drift `check`. The user explicitly wants to build it and try it,
accepting that it is a low-signal, judgment-requiring tool.

Cross-references:
- `drift-ai-improvements.md` — the roadmap this slots beside; `harness-freshness`
  is the precedent for a non-`check` subcommand.
- `drift-ai-review/additional-checks-research.md` — original candidate table and
  the "do NOT add" list this note partially revises.
- `scripts/drift-ai/git-changed-scope.ts:18` — the `GitRunner` seam
  (`(args: readonly string[]) => string`, `execFileSync`-backed, fakeable) the
  churn collector plugs into. `isIgnoredPath` / `filterScope` there is the
  ignore filter to reuse.

---

## The product reframe: a subcommand, not a check

**Decision: hotspots is a separate advisory subcommand (sibling to
`harness-freshness`), not a drift `check` and not part of the main report.**

This dissolves the two standing objections from the original rejection, because
they were objections to putting it in the *findings stream*, not to the
capability:

- **"No natural zero / always-emits."** Against the main report's "a clean run
  is meaningful" contract, an analysis that always prints a top-N list is a bug.
  As a standalone advisory subcommand, always-emitting is *correct* — a top-N
  list is supposed to have N items.
- **"Advisory, not located `file:line` findings with FIX hints."** Every drift
  `check` points at a location and a fix. A hotspot points at an *area to look
  at* and supplies no fix. As a subcommand this is honest labeling, not a
  contract mismatch. The low-false-positive trust bar that gates the main report
  **does not apply** here.

The 14-day window (below) also softens the third original objection ("whole-repo
historical = wrong altitude for a diff sensor"): a 2-week churn window is much
closer to drift:ai's diff-sensor altitude than code-maat's quarterly/all-history
default. It does not eliminate it, but the gap is small.

### Who it is for (put this at the top of the eventual user-facing doc)

"Low signal" is the wrong frame — it is **low signal for the person who already
has the context, higher signal at the team/lead altitude.** A solo dev churning
one file knows why ("I'm building that feature"). But pointed at a team of
AI-augmented devs, it surfaces cross-cutting churn **no individual dev can see**,
because each only holds their own slice. Value scales with team size × AI usage.
The output makes **no recommendation** — it points at areas to *check*; the human
supplies the judgment (e.g. "high churn here is fine, it's the feature under
active development" vs "this is whack-a-mole").

---

## Why the "heavy/JVM (code-maat)" rejection was the weakest reason

`code-maat` is Clojure/JAR (needs a JVM), and is a batch log-miner (dump a git
log to a file, feed the JAR). All of that fights the portable Bun tools-checkout
target. **But those are properties of the legacy tooling, not the algorithm.**
The hotspot computation is ~50 lines of pure TS:

1. churn per file from one windowed `git log` (via the existing `GitRunner`);
2. complexity per file from a real engine (see below);
3. normalize each dimension to 0..1, multiply, sort, take top-N.

So "heavy/JVM" is an argument against *adopting code-maat* (which nobody should
do here), not against the check. Reimplement it; do not shell out to a JVM.

---

## The three-lens roadmap

The three use cases the user named are actually three different advisory lenses.
Because it is a subcommand and not findings, lenses can be added incrementally
**without any of them clearing a findings-grade FP bar**:

1. **Lens 1 — churn × complexity ("touched all the time AND complex").** Pure
   `git log` + complexity engine. **This is v1.**
2. **Lens 2 — merge-conflict frequency ("coordination hotspot").** Mine
   `git log --merges -c` (combined diff on merge commits); a non-empty combined
   diff for a file means the merge was not clean there. Tally files across those
   merges → conflict-frequency ranking. Honest caveats: it is a heuristic
   (combined diffs include non-conflict "evil-merge" edits too), and
   **squash-merge repos have no merge commits, so the signal vanishes** — the
   same git-workflow dependence that shapes every churn decision below. Strong,
   otherwise-invisible signal for a merge-heavy multi-dev team.
3. **Lens 3 — thrash / whack-a-mole ("endless back-and-forth").** The most
   interesting lens, because it partially lifts the human-judgment burden
   **without becoming prescriptive** — it separates "actively building" churn
   from "rewriting the same code" churn. Git-only approximations:
   - **High churn + low net line growth** = lots of editing, file isn't growing →
     thrash.
   - **Re-edits of recently-changed lines** (churn revisiting young code) → going
     back and forth.
   - **Revert / "fix" density** (`git log --grep` for reverts; commits undoing
     recent commits) → bug whack-a-mole.

   None of these recommends a fix; they just sort "actively building" away from
   "thrashing." This is the lens that makes the tool feel like "these areas look
   like thrash specifically" rather than "here's some churn, good luck."

Lenses 2 and 3 are **where the team-altitude value probably concentrates**, so
they justify the subcommand's existence — but v1 ships lens 1 to prove the
plumbing.

---

## v1 scope (buildable slice)

- Lens 1 only (churn × complexity).
- Subcommand scaffold, sibling to `harness-freshness`; whole-repo, **not**
  `--scope`-gated (it has its own time axis, orthogonal to the diff-vs-main axis).
- Reuse `isIgnoredPath` / `filterScope` for the churn map (so lockfiles,
  generated clients, snapshots, ignore globs never top the list).
- Legible output line + sparse-history guard (below).
- Report-only, exit 0, like the rest of the tool.

---

## Churn window — decisions (locked)

The window is where signal quality lives, and for a portable tool every knob is
secretly a "how robust is this to the target repo's git workflow / age / cadence"
question.

| Decision | Choice | Why |
|---|---|---|
| Window length default | **14 days** | This is an *AI*-drift sensor; agents compress months of human churn into days. Match the window to the cadence of what you're detecting. 180d (the classic human-team hotspot default) is far too long here. |
| Window type | **Time-window default; commit-count (`--max-commits`) as an option** | Time maps to "recent maintenance pressure" and degrades gracefully on young repos. Commit-count is the escape hatch for AI's *burstiness* — "show me the last working session regardless of calendar" (an agent may do 300 commits over a weekend then nothing for a week). |
| Churn metric | **`revisions` default; `lines` documented alternate** | Revisions (commits touching the file) is the theoretically-correct "frequency/instability" axis and has plenty of range in AI-heavy fine-grained history. `lines` (added+deleted) is the squash-merge-/low-cadence-robust fallback (a squashed PR = 1 revision but still many lines). User had no preference; this is the recommendation. |
| Merge commits | `--no-merges` for counting | Merge numstat otherwise attributes whole-branch churn. |
| Renames | `--no-renames` for v1 | Whole-repo rename-following doesn't generalize (`--follow` is single-path). Slight undercount, documented. The short window *shrinks* this problem — fewer renames fall in 14 days. |
| Sparse-history guard | **widen with a legible note** (not hard-skip) | 14 days is exactly where the churn axis degenerates: a quiet period / squash repo yields revision counts of 1–2, and `churn × complexity` collapses into a disguised complexity ranking. If in-window commits fall below a floor, widen and **report the window actually used** (`60d (widened from 14d: sparse history)`). Skip-vs-widen is bikeshedding; the one thing that matters is the output never misleads about what fed the ranking. |
| Output legibility | **mandatory** | The header must state churn metric, window actually used, commit count, no-merges, and complexity engine — e.g. `hotspots (churn: revisions, 14d, 47 commits, --no-merges; complexity: eslint)`. At 14 days this is not optional: it makes the sparse case visible instead of silently producing garbage. |

Concrete collector invocation (one `GitRunner` call):

```
git log --since=<window> --no-merges --no-renames --format=%x00 --numstat
```

Per path: `revisions` = count of numstat rows mentioning it; `lines` =
Σ(added + deleted), treating `-` binary markers as 0. Filter every path through
`isIgnoredPath`. Normalize churn and complexity each to 0..1 before multiplying
(raw scales differ wildly: small-integer revision counts vs large complexity
sums).

Proposed config shape:

```jsonc
"hotspots": {
  "window": "14d",            // default; time-based
  "maxCommits": null,         // set to use a commit-count window instead
  "churnMetric": "revisions", // | "lines"
  "minCommits": 10,           // sparse-history floor (guess — see open knobs)
  "complexity": "eslint"      // | "ts-morph" (see below)
}
```

---

## Complexity source — decision deferred (eslint vs ts-morph)

- **Indentation/whitespace proxy: rejected.** Too crude to multiply against a
  real complexity number — the proxy's noise dominates the product.
- **ESLint `complexity` (measurement mode):** set the threshold to 0 so *every*
  function reports its number, then parse `--format json`. The user confirmed
  this exact extraction is **already done in-repo by the lint-ratchet system**,
  so it is a proven path. Cost: subprocess + a measurement-only flat config + a
  TS parser able to parse the target's modern TS/TSX (not type-aware, so no
  target tsconfig needed). Re-imports a mild "is the tools-checkout config
  authoritative for this target?" question, but cyclomatic complexity is an
  objective measurement, so it is much softer than for stylistic rules.
- **ts-morph cyclomatic:** `ts-morph` is already a planned dep (near-duplicate
  plugin). Counting branch nodes (`if`/`for`/`while`/`case`/`&&`/`||`/`?:`/
  `catch`) per function is a ~30-line, calibration-free traversal — **not**
  "reimplementing an engine" in the risky sense. Sidesteps the subprocess /
  parser / config-authority friction entirely; TS/JS-only.

**No decision made.** User has no strong preference. Recommended framing
(mirrors the near-duplicate plugin's "ts-morph default, similarity-ts optional"):
pick one as default, keep the other as an opt-in mode. The ratchet precedent
de-risks ESLint; ts-morph is the cheaper integration. Settle next session.

---

## Open knobs to pin down next session

Flagged explicitly for the future revisit — these are the "few more knobs" before
lens 1 (and especially lens 3) is buildable:

1. **`minCommits` floor value.** 10 is a guess. The right value is "enough that
   the top-of-list churn counts aren't all 1–2." Should it be an absolute count,
   or a check on the churn distribution's dynamic range (e.g. require the top
   bucket to be ≥ N× the median)?
2. **Complexity engine default** (eslint vs ts-morph) — see above.
3. **Normalization method.** Min-max vs percentile/rank-normalize before
   multiplying. Percentile is more robust to a single outlier file; min-max is
   simpler. Also: do we multiply normalized values, or plot/rank each axis and
   take the top-right quadrant (Tornhill's visual model)?
4. **Lens 3 (thrash) knobs** — the least-specified lens:
   - "low net growth" threshold: what added/deleted ratio (or net-lines-per-
     revision) flags rewriting vs building?
   - "re-edits of recently-changed lines": needs line-age tracking (`git blame`
     per revision is expensive) — find a cheap approximation or scope it out of
     the first thrash cut.
   - revert/fix detection: message-grep (`revert`, `fix`) is cheap but noisy;
     actual revert-commit detection is cleaner but harder. Pick the FP tolerance.
5. **Lens 2 (conflicts) feasibility spike** — confirm `git log --merges -c`
   combined-diff parsing gives a usable per-file tally, and decide the
   squash-repo behavior (skip-with-reason vs silently empty).
6. **Top-N default** and whether N is fixed or a fraction of repo size.
7. **Output format** — text table for humans; does it also need a JSON mode for
   AI handoff (consistent with the rest of drift:ai)? Likely yes.

---

## Related clarification: the "do NOT add anything lint/knip-gated" rule is target-conditional

Captured here because it came up in the same discussion and revises
`drift-ai-improvements.md:296-302` and
`drift-ai-review/additional-checks-research.md:176-190`.

The "do NOT add complexity / magic-numbers / dead-exports / etc." rationale in
those docs is argued entirely from **Musi's** vantage point ("we already
ERROR-gate these, so a report-only re-implementation is a strictly weaker
duplicate"). That argument is **conditional on the target having those gates.**
For an external pnpm repo with weak or no ESLint/knip config — which is exactly
the portability target — those signals are genuinely uncovered, so the de-dup
logic doesn't hold there.

But the conclusion mostly survives for a better reason the docs understate.
Separate two things the "do NOT add" list conflates:

- **(a) Reimplementing lint rules *inside* drift:ai** as bespoke report-only
  heuristics (a hand-rolled complexity counter, magic-number scanner, etc.).
  Correctly rejected, target-independent: it would be a strictly weaker version
  of ESLint's mature, calibrated, **npm-portable** rules, and would re-incur all
  the calibration they already did — eroding the low-FP trust bar.
- **(b) Orchestrating a portable best-in-class tool as an adapter** and surfacing
  its findings in the one drift report. **This is already in the roadmap** — the
  knip orphan-files adapter (improvements roadmap item 9 / Part D #2) is exactly
  "bring a portable tool, surface it, skip-with-reason when prerequisites are
  absent." The "do NOT add" list does **not** forbid this.

So for under-gated external repos the right move is an **ESLint/knip adapter**
(delegate to the real tool; opt-in baseline config; skip-with-reason when the
target has no usable config / unsupported layout), **not** reimplemented
heuristics. The non-type-aware subset (complexity, magic-numbers, function
length) is the *easiest* to deliver this way — those rules need no target
tsconfig, only a parser. The one real caution (per the adapter policy at
`additional-checks-research.md:149`): a generic tools-checkout config imposed on
a foreign repo is an opinion the target's team never opted into — so it must be
opt-in + skip-cleanly, the same discipline as the knip adapter.

**Doc edit to make when this is promoted:** split the "do NOT add" section into
"do not *reimplement* (target-independent)" vs "*may* orchestrate via adapter,
with care (target-conditional)", and stop justifying the lint/knip exclusion
purely from Musi's gating.
