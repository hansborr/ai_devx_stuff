# Improvement Suggestions — Harness Presentation Research (2026-06)

## What this is

These suggestions surfaced while researching the harness/context/agentic-engineering
presentation that uses this repo as its case study. They are **not** a fresh audit —
they are the by-products of fact-checking the deck against the codebase, the prior
[harness review](../harness-review-2026-05/), and the task backlog.

They have been **honestly deduplicated**:

- Most "improvement ideas" in the research corpus turned out to be **already shipped**
  (the 43-leaf `drift-ai-next-items` pack is Done; `harness:audit` fusion, the weekly
  `slow-drift.yml` lane, and the `module-doc-paths` + `layer-direction` sensors all
  exist) — those are **not** listed here. Padding this file with shipped work would
  misrepresent the harness as more incomplete than it is.
- A second group are **refinements of already-planned backlog leaves** (Parked tasks).
  They are real open deltas, but they extend an existing plan rather than reveal a new
  gap — each is marked as such.
- A third, smaller group are **genuinely new** — confirmed absent from
  `harness-review-2026-05/`, `harness-review-tasks/`, and
  `ai-harness-prioritized-backlog.md`. These are flagged explicitly.

A recurring caution applies to the lowest-priority items: several "new ideas"
(a `lint:ratchet:trend` graph, a standalone harness scorecard) are **presentation
props, not harness gaps**. Featuring them as "what we'd build next" would undercut the
talk's own restraint thesis (`05-generic-harness-principles.md:280` — ~100 controls is
a *ceiling*, not a starting template). They are kept here only as optional talk-prep,
with that warning attached.

> **Tier legend.** *Already-planned?* — **Shipped-adjacent** (extends a Done lane),
> **Parked task** (a refinement of a specific backlog leaf), **Deck convention**
> (a slide-design fix, not harness work), or **New** (no backlog overlap found).

---

## Priority-ordered table

| # | Title | Priority | Effort | Already-planned? | One-line |
|---|-------|----------|--------|------------------|----------|
| 1 | Standardize the character-live-state stale-doc wording across all slides | High | S | Deck/accuracy fix (sensor = task 20 Done; fix = task 10 Parked) | The deck's strongest live cautionary example is stated inconsistently; lock the exact wording. |
| 2 | Lock one reproducible test-count command before the talk | High | S | New (talk-prep) | Critics gave 3 different counts; lock `~495 product files / ~6,500 cases` to one `rg` command. |
| 3 | Make source-tiering + PROBLEM-vs-CURE caveat a visual deck convention | High | S | Deck convention | Peer-reviewed, vendor-telemetry, and single-anecdote sources currently share equal visual weight. |
| 4 | Aggregate context-budget reporter (sum always-loaded session tokens) | Medium | M | Parked plan (rec M2) | Per-file caps exist; no command sums total always-on context — backs the "budget context like memory" claim. Landed 2026-07-19: `bun run sensor:context-budget`, report-only line in `doctor`. |
| 5 | Add scoped Stryker mutation + survivor summarizer to the weekly drift lane | Medium | M | Parked tasks (25 + backlog item 10) | The lane already runs; fold scoped mutation in and rank survivors for a recurring behavior signal. Landed 2026-07-19: `bun run mutation:survivors` + scoped shared-rules mutation behind `MUSI_SLOW_DRIFT_MUTATION=1` in the weekly lane. |
| 6 | SessionStart/PreCompact rehydration hook to re-seed handoff state | Medium | M | Parked (rec R11 / principle 20) | Handoff is saved at session *end* but never re-injected at *start* — the clearest unshipped principle. |
| 7 | `lint:ratchet:trend` historical debt-curve command | Low | M | New (but a slide prop) | Would draw a live down-and-to-the-right graph; the 12-entry debt log already tells the story for free. |
| 8 | Consolidated harness scorecard of quotable quant facts | Low | M | New (but a slide prop) | One artifact of all quant facts; risks cutting against the anti-doc-rot / don't-add-low-signal discipline. |

---

## Per-item detail

### 1. Standardize the character-live-state stale-doc wording across all slides

**Priority: High · Effort: S (wording only)**

**Rationale.** `packages/server/src/services/character-live-state/MODULE.md:75` still
asserts "`index.ts` is the public facade only," but `index.ts` was deleted to satisfy
the `no-barrel` rule. The sensor built to catch exactly this drift
(`drift:ai module-doc-paths`) **was shipped** but is deliberately kept off the default
changed-scope loop (`scripts/drift-ai/module-doc-paths-check-config.ts:21` —
`runByDefault: false`), and the one-line doc fix is still **Parked**
(`harness-review-tasks/10`, verified `Status: Parked`). So the drift it was built to
catch is **still live**.

**Connection to the talk.** This is the deck's single best, un-cherry-picked proof of
*both* halves of the cautionary tale: (a) a stale doc an agent acts on is worse than no
doc, and (b) "build-without-collect" — a sensor you don't run in the loop doesn't
protect you. It anchors the onboarding-payoff theme's honesty beat (slide 16).

**The exact wording to use everywhere** (the inconsistency risk is that some drafts
imply the sensor doesn't exist, which reads as self-contradictory on the deck's own
build-without-collect example):

> "The sensor was built and shipped, but kept off the default changed-scope loop
> (`runByDefault: false`), and the one-line doc fix is still Parked — so the drift it
> was built to catch is still live."

**Dedup note.** Not a backlog item — a **presentation-accuracy fix**. The underlying
`module-doc-paths` sensor shipped via the `drift-ai-next-items` pack (the standalone
diagnostics tasks 20–24 read `Status: Parked` only because `00-index.md` marks them
"Superseded -> next-items", i.e. delivered through that pack, not abandoned); the
`scripts/drift-ai/module-doc-paths-check.ts` artifact is present on disk. The one-line
doc fix itself is `harness-review-tasks/10`, still genuinely **Parked**.

**Suggested first step.** Re-check the file and task status at talk time. If someone
fixes the doc before the talk, reframe the slide from "open wound" to "we found it and
fixed it" — either framing lands, but they require different wording.

---

### 2. Lock one reproducible test-count command before the talk

**Priority: High · Effort: S (one `rg` command + speaker note)**

**Rationale.** The drafts and corpus carried three different counts — 481, 623/624, and
an inflated 8,300. Verified live in this repo: **495 product vitest files** (54 shared /
175 server / 266 client), and **~6,500 product test cases**. The corpus's 8,300
conflated scripts/meta tests and is wrong for "product." For a
talk whose whole credibility move is "real numbers from a real repo," a single figure a
fact-checker in the room can disprove undermines everything.

**Connection to the talk.** Backs the test-suite theme (slides 11–13), specifically the
"~495 product test files / ~6,500 cases, engineered for the edit loop" claim.

**Dedup note.** **New** — pure talk-prep, no harness or backlog overlap. (This was
verified independently here: `495` product files.)

**Suggested first step.** Pick the exact `rg` glob you will show on the slide, run it at
talk time, and put the literal command in the speaker notes so the number is
reproducible on stage. Present "~495 product test files / ~6,500 product cases" and only
use broader all-test counts when *explicitly* scoping "all test files including scripts
and meta."

---

### 3. Make source-tiering and the PROBLEM-vs-CURE caveat a visual deck convention

**Priority: High · Effort: S (slide-template convention)**

**Rationale.** This is the evidence critic's single most important fix. Peer-reviewed
numbers (CMU +30%/+41%, IEEE-ISTAS +37.6%, the 304K-commit study, Veracode 45%, METR's
RCT) currently sit on the same bullet line as vendor telemetry (Faros, GitClear, DX) and
single-team anecdotes (OutSight 100%/4%, Phoenix 45→5%, Morph 22-vs-1) with no
confidence marker — so weaker sources borrow the rigorous sources' authority. Separately,
the rigorous data measures the **disease** (entropy/defects without guardrails) while the
data for the **cure** (lint/tests/harness) is mostly vendor/single-author. Naming that
distinction out loud is the deck's most important honesty move, and it is currently
invisible to the audience.

**Connection to the talk.** Applies to the two consolidated stats slides — the front
stakes slide (slide 4) and the back ROI/amplifier slide (slide 18) — and to the
lint-opener (slide 8).

**Dedup note.** **Deck convention**, not harness work.

**Suggested first step.** Add a persistent tier marker wherever sources of different
tiers share space — `peer-reviewed` / `vendor telemetry (directional)` /
`single-team anecdote` — plus one visible line on slides 4 and 8:
> "This data measures the **problem**; guardrails are the proposed, high-confidence /
> low-cost **fix** — not a proven silver bullet."
> And one line acknowledging that nearly every foundational source (Anthropic, Chroma,
> Factory, Bhattacharya) is commercially interested — "but they converge across
> competitors, which is the signal."

---

### 4. Aggregate context-budget reporter (sum always-loaded session tokens)

**Priority: Medium · Effort: M**

**Rationale.** The deck claims "we budget context like memory," but the repo can only
*partly* back that with a number today. Per-file caps exist and are enforced
(`scripts/doc-length-policy.sh`: AGENTS.md 250, CLAUDE.md 250, DECISIONS.md 400, etc.),
but **no command sums the always-loaded per-session context** (AGENTS.md + CLAUDE.md +
any auto-injected blocks). A small reporter would turn an assertion into a demoable
figure and would also be a real governance tool: it lets you "optimize the set, not each
item in isolation" before adding any new always-on feedforward.

**Connection to the talk.** Strengthens the onboarding-payoff theme (slide 15, "context
budgeted like memory") and the context-engineering framing (attention budget / "smallest
set of high-signal tokens").

**Dedup note.** **Parked plan** — maps exactly to **meta-recommendation M2** in
`harness-review-2026-05/03-recommendations.md:414` ("Sum the net per-session context
cost") and `00-overview.md:148`. M2 is a *governance recommendation with no tooling yet*
— attribute it to M2, not as a fresh idea. The per-file caps exist; the aggregate
summing reporter does **not** (verified). Genuinely open.

**Suggested first step.** Write a thin script that tokenizes the always-loaded set and
prints a single total against the AGENTS.md-cap discipline; wire it into `doctor` as a
report-only line so it never gates.

---

### 5. Add scoped Stryker mutation + a survivor summarizer to the weekly drift lane

**Priority: Medium · Effort: M**

**Rationale.** Behavior confidence is the repo's self-declared weakest sensor axis
(`docs/ai-harness.md` **Current Gaps**). The captured Stryker baseline (70.25% score, 258 survivors
over 1,438 mutants on `packages/shared/src/rules`, 16 of 66 shared files) is a one-time
audit, not a recurring signal — survivor counts never trend. The scheduled lane that
*could* carry a recurring behavior signal **already runs** (`slow-drift.yml`,
`cron '23 9 * * 1'`, calling `harness:audit`). The open delta is two-fold: (a) fold
*scoped* mutation into that lane, and (b) summarize/rank survivors by file/rule-area so a
reviewer or agent gets a triage list instead of a raw report.

**Connection to the talk.** Directly supports the "coverage is theater / mutation is the
proof-of-work" slide (slide 13) and the "report mutation score, not coverage %" takeaway.
It is the honest next step *after* the slide acknowledges the sensor is in-progress.

**Dedup note.** **Parked task** — adding mutation *to* the existing lane is
`harness-review-tasks/25` (verified `Status: Parked`). It depends on task 24 (the basic
scheduled slow-drift lane), which is **shipped**: `00-index.md` marks task 24
"Superseded -> next-items 14", and the artifacts are live on disk (`slow-drift.yml`
`cron '23 9 * * 1'`, `scripts/slow-drift-audit.sh`, `scripts/harness-audit.ts`). So the
lane is **not** half-built — frame this as "the next extension of a lane we already run,"
not "finishing an incomplete lane." The survivor summarizer is
`ai-harness-prioritized-backlog.md` item 10 (unbuilt). Note the documented DB-isolation
collision (`STRYKER_MUTATOR_WORKER` vs `VITEST_POOL_ID`) that must be solved before
server-service scope.

**Suggested first step.** Land the survivor summarizer first (item 10) — it is the
cheaper half and gives the talk a ranked list to show — then attach scoped shared-rules
mutation to the weekly lane behind `break: null` (report-only, never a gate).

---

### 6. SessionStart/PreCompact rehydration hook to re-seed handoff state

**Priority: Medium · Effort: M**

**Rationale.** This is the cleanest **genuinely-unshipped** principle in the corpus and
it directly serves the talk's central thesis ("the agent has no memory, so the codebase
must carry orientation"). The repo preserves handoff state at session *end* (a Stop
hook), but does **not** re-inject load-bearing state at session *start* or after
compaction. Verified: no `SessionStart` or `PreCompact` hook exists on disk
(`.claude/settings.json`, `scripts/ai-hooks/`). A SessionStart (and Claude PreCompact)
hook on the shared `scripts/ai-hooks` boundary that injects a bounded handoff status
block would close the loop.

**Connection to the talk.** The strongest forward-looking item for the closing
"where to start / what's next" slide (slide 20) — honest roadmap content that reinforces
the "new hire with no memory" framing rather than claiming the system is complete.

**Dedup note.** **Parked** — maps to **R11**
(`harness-review-2026-05/03-recommendations.md:227`, "SessionStart/PreCompact
rehydration hook + JSON handoff status block") and generic principle 20. Present as
**planned-not-novel** on slide 20 only; do **not** spawn a separate future-work slide.

**Suggested first step.** Spec the bounded JSON handoff block (branch, last failing
gate, timestamp, open task) per R11 and add the SessionStart hook on the existing
`scripts/ai-hooks` boundary so both Claude and Codex runtimes get it.

---

### 7. `lint:ratchet:trend` historical debt-curve command

**Priority: Low · Effort: M**

**Rationale.** The lint ratchet drives selected debt monotonically down, but there is no
command that emits the count-of-findings curve over git history. A `lint:ratchet:trend`
that walks `git log` of `lint-ratchet.baseline.json` and prints total findings per commit
would produce a literal down-and-to-the-right graph from real history.

**Connection to the talk.** It would make the ratchet slide (slide 10) more vivid — but
that is exactly the problem: it is a **slide prop, not a harness gap**. The 12-entry
append-only `lint-ratchet.debt-log.jsonl` (every entry a *retirement*) already tells the
monotonic-improvement story for free, and reading one line aloud is more memorable than a
generated chart.

**Dedup note.** **New** but optional — verified that only `lint:ratchet:summary`
(current totals) and `lint:ratchet:update` exist; no `:trend` (confirmed absent in
`package.json` and `scripts/`). Do **not** pitch it as a harness deficiency on any
slide; featuring it undercuts the talk's restraint thesis.

**Suggested first step.** Only build it if you specifically want a live graph on stage;
otherwise screenshot the existing debt log and skip this.

---

### 8. Consolidated harness scorecard of quotable quant facts

**Priority: Low · Effort: M**

**Rationale.** The strongest quantitative talk facts (18 rules; ~200 type-assertion
markers across ~100 files; 49 governed disables; 230-row coverage map; 108 controls;
~480 test files / ~6,500 cases; 70.25% mutation baseline) are computed ad hoc across many
scripts. A single generated `harness-scorecard.md` would make the "low-debt,
fully-governed" claim a durable, re-runnable artifact.

**Connection to the talk.** It would back the lint and system themes with one screen —
but it risks cutting **against** the talk's own anti-doc-rot / don't-add-low-signal
surfaces discipline (slide 17's Promotion Rule), and every component already prints its
own total.

**Dedup note.** **New as a standalone artifact**, but it **partially overlaps** the
already-shipped `harness:audit` fusion consumer. Note: `ai-harness-prioritized-backlog.md`
item 11 ("Scheduled slow harness report") is *already shipped* as `harness:audit` +
`slow-drift.yml`, so this scorecard is a *different* aggregation idea, not item 11. If
built at all, scope it as a thin row inside the existing coverage map or `harness:audit`
summary — **not** a new top-level document.

**Suggested first step.** If desired for the talk, fold three or four headline counts as
a summary block into the existing `harness:audit` output rather than creating a new file.

---

## Honesty footer: what is deliberately NOT here

To avoid overstating the harness's gaps, the following corpus "improvement ideas" were
checked and **excluded as already shipped** (do not present them as future work):

- `harness:audit` fusion consumer over the shared `HarnessDiagnostics` Zod envelope (R9).
- Weekly scheduled `slow-drift.yml` drift lane (R10) — the "build-without-collect" fix.
- `drift:ai module-doc-paths` and `layer-direction` sensors (R1/R12) — both registered
  and shipped (the *doc fix* and *default-loop promotion* remain open; see item 1).
- The full 43-leaf `drift-ai-next-items` pack (Done).
- The pointer-style 41-line AGENTS.md under a hook-enforced 250-line cap, the generated
  108-control manifest with `harness:check`, the symmetric lint ratchet, and the
  self-correcting lint messages — all live.

The remaining genuinely-open, substantive items are #4 (M2 context reporter), #5
(mutation-into-existing-lane + survivor summarizer), and #6 (R11 SessionStart
rehydration). Items #1–#3 are presentation-accuracy/convention fixes, and #7–#8 are
optional slide props that should not be framed as harness deficiencies.
