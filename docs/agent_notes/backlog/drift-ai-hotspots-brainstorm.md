# drift:ai hotspots + adapter policy — blue-sky brainstorm synthesis

Status: Brainstorm synthesis, 2026-05-29. **No source changed.** Produced by a
five-perspective agent team (signal cartography, v1 engineering, adversarial
red-team, adapter architecture, product/consumer) with a deliberate skeptic
seat, then synthesized and **empirically grounded against this repo's own git
history** (appendix). Extends the design discussion captured in
`drift-ai-hotspots-subcommand.md`.

**How to read this.** This is a brainstorm, not a decision. It preserves the
team's disagreements with the existing design note rather than papering over
them, because the disagreements are the high-value output. The user intends to
revisit before building v1; Part 3 lists the genuine open forks for that revisit.

Cross-references (all under `docs/agent_notes/backlog/`):
- `drift-ai-hotspots-subcommand.md` — the design note this stress-tests (the
  three-lens roadmap, locked churn-window decisions, open knobs, and the
  target-conditional "do NOT add" clarification).
- `drift-ai-improvements.md` — the roadmap this slots into; the `CheckPlugin`
  registry + `CheckOutcome` union (Part B/roadmap items 6, 9), and the
  "Explicitly do NOT add" paragraph (lines ~296–302) the adapter thread revises.
- `drift-ai-review/additional-checks-research.md` — the original rejection of
  churn×complexity (candidate #13) and the "Explicitly do NOT add" list +
  general adapter policy the adapter thread revises.
- `drift-ai-review/ux-reporting.md` — the existing reporting UX (JSON scope
  bloat, no findings summary, chunk mislabel, the `harness-freshness`
  second-class-surface wart L1) the product lens builds on.
- `drift-ai-review/code-quality.md` — why `harness-freshness` is kept *outside*
  the `CheckPlugin` registry (High-2, Med-1); the DI seams new code should fit.
- `drift-ai-review/standalone-extraction.md` — the portability target, the
  jscpd bin-resolution split, and the adapter "open questions" the adapter
  thread answers.
- Code seams: `scripts/drift-ai/git-changed-scope.ts:18` (`GitRunner`),
  `:99`/`:111` (`isIgnoredPath`/`filterScope`); `scripts/drift-ai/runner.ts:82`
  (the `harness-freshness` subcommand-dispatch precedent);
  `scripts/drift-ai/duplicates-runner.ts:51` (the existing jscpd adapter
  precedent); `scripts/lint-ratchet/eslint-runner.ts` (the in-repo ESLint
  extraction — heavier than the note implies).

---

## Executive summary — the five shifts that would change the design note

1. **Churn×complexity is the wrong v1.** Three independent perspectives, plus
   the empirical run, converge: it is the *lowest* team-altitude signal, it
   bundles the *only* portability-hostile dependency (a complexity engine), and
   on a real repo it collapses into a complexity ranking that ESLint already
   gates. "Ship lens 1 to prove the plumbing" is a tell — the plumbing is the
   git-history collector, which a *git-only* lens proves better and cheaper.
2. **The real v1 is the history collector (call it v0), not any lens.** One
   windowed `git log` walk → typed per-commit records behind the `GitRunner`
   seam, with `isIgnoredPath` filtering, the sparse-history widen-with-note
   guard, and the mandatory legible header. Every lens is a reducer on top.
   Reframe the roadmap around "build the collector once."
3. **Temporal co-change coupling is the missing flagship signal** — git-only,
   survives squash-merge, maximally embodies the "no individual dev can see it"
   thesis, and the empirical run surfaced genuinely non-obvious pairs even at
   thin support. It is absent from the note's three lenses and is the strongest
   candidate to *be* the value proposition.
4. **For the adapter thread, reframe the boundary around verdict/threshold
   ownership, not "reimplement vs adapt."** The durable rule: *delegate the
   verdict, not just the engine.* This independently fell out of both the
   adapter architect and the skeptic, and it cleanly resolves every blur case
   the original distinction left open.
5. **Run the kill-criterion experiment before building anything** (the skeptic's
   #1 ask) — but on a repo that matches the use case. We ran the cheap version
   against *this* repo (appendix), and it surfaced docs + lint tooling with a
   near-flat code-churn axis. **That result is not probative**: this is a *solo*
   project, which is precisely the low-signal case the value thesis predicts, so
   the "surprise test" is trivially (and expectedly) failed — the solo dev
   already knew they had been living in lint/harness tooling, and a solo repo has
   no coordination signal for the tool to surface. The experiment therefore
   validated the **mechanics** (the collector works; ignore-filtering is
   load-bearing; churn dynamic range is the live question), not the **value**.
   The value test has to be run on a multi-dev, AI-heavy repo — which we
   subsequently did (OpenClaw, appendix #2), and there the git-only signals come
   back **rich and non-degenerate** (author-fragmentation up to 48 hands/file;
   real cross-package co-change couplings), which is the first concrete evidence
   the value thesis holds where it claims to. See §1.11.

---

# Part 1 — The hotspots subcommand

## 1.1 The biggest shift: v1 should not be churn × complexity

The note picks churn×complexity as v1 while *admitting* "lenses 2 and 3 are
where the team-altitude value probably concentrates" and that lens 1 ships "to
prove the plumbing." The team reads that admission as the design defect, for
four reasons that stack:

- **It is the lowest team-altitude signal in the space.** "This file is big and
  changes a lot" is the *most* visible-to-an-individual fact here — any dev who
  works in `monster-form-fields.tsx` already knows it is hot and complex. The
  subcommand's entire justification ("surfaces what no single dev sees") is
  *least* true of lens 1.
- **It bundles the one portability-hostile dependency the whole roadmap avoids.**
  Every lens needs the git collector; only lens 1 *also* needs a complexity
  engine (ESLint subprocess + measurement config + parser, or ts-morph). So lens
  1 is not the minimal plumbing proof — it is the minimal git plumbing *plus*
  the single most foreign-repo-hostile subsystem in the design.
- **The multiply degenerates exactly where the note runs it.** On a 14-day
  window the churn axis frequently collapses to 1–2 (the note concedes this), so
  `churn × complexity` becomes a disguised complexity ranking — and cyclomatic
  complexity is already ERROR-gated by ESLint in Musi
  (`additional-checks-research.md` candidate #5). You would have reinvented a
  weaker, report-only version of an existing gate.
- **The empirical run is suggestive on this repo** (appendix, cut 3): restricted
  to application source, the *maximum* churn in 14 days is 4 revisions, with the
  bulk at 2–3 — so the churn axis has little separating power and the product is
  dominated by complexity alone. Caveat: this is a solo repo whose recent code
  activity was light (the fortnight's effort went into lint/harness tooling), so
  a busier multi-dev repo would likely show more code-churn range; treat this as
  illustrative of the *degeneracy mode*, not proof it always degenerates.

**Recommendation.** Make the v1 lens **git-only**. Two viable choices:
co-change coupling (§1.3, highest novelty/value) or a churn-only "most-churned
files" list *with context columns* (§1.8, lowest risk). Demote churn×complexity
to a late, optional, complexity-engine-dependent lens that the git-only lenses
may make unnecessary.

## 1.2 The real v1 is the history collector ("v0")

The note budgets lens 1 as "~50 lines of pure TS" and treats the lens as the
unit of work. The team's strong consensus: the unit of work is the **collector**,
and it is the larger, riskier, shared piece. Build it once:

- One `GitRunner` call per signal family (the seam at `git-changed-scope.ts:18`,
  `execFileSync`-backed and fakeable exactly like the existing scope tests).
- Parse into typed per-commit records. **Parsing caveats the note omits** (from
  the v1 engineer, verified against the repo):
  - `--format=%x00 --numstat` emits a NUL-only line, then a blank line, then the
    numstat rows. A naive `split(" ")` breaks on the blank-line artifact;
    parse line-wise (NUL-only line = commit boundary, skip empties, tab-split the
    rest).
  - Binary files emit `-\t-\tpath`; treat `-` as 0 for the `lines` metric, but
    they still count as a `revision` — so **filter through `isIgnoredPath`
    before counting** (the appendix shows why: unfiltered, binaries/docs/tooling
    dominate). Scope note: `isIgnoredPath` is *only* the existing universal
    defaults (`node_modules`, lockfiles, images, `dist/`, …) plus the user's
    `ignore` config. The tool does **not** — and deliberately should not — try to
    detect generated files or otherwise guess what is "ignorable" on an arbitrary
    target. That is unwinnable per-repo calibration and an imposed opinion on
    foreign repos; the human reading the top-N already has that context and
    discounts their own generated/irrelevant files. Ship the universal defaults +
    config, then show what you find.
  - `--no-renames` is **load-bearing for parser correctness**, not just an
    accounting choice: with rename detection on, numstat emits
    `path/{old => new}/file.ts` arrow-forms in the path field that would corrupt
    a `split("\t")[2]` parser. Document it so a future "let's follow renames"
    change does not silently break parsing.
- Apply the sparse-history widen-with-note guard and the mandatory legible
  header here, in the collector, so the degenerate case is visible from the
  first lens onward.

Reframing the roadmap around the collector also reframes the cost: the cheap,
shippable proof-of-value is **collector + churn-only top-N + honest header**,
with no complexity engine and no second subsystem.

## 1.3 New signal: temporal co-change coupling (the missing flagship)

Not in the note's three lenses; the signal cartographer's top pick and the
team's strongest "new idea." Pairs of files that change together far more often
than chance — *especially across module/package boundaries* — is the textbook
"no individual dev sees this" signal: each dev knows "I edit A and B together,"
but only the aggregate reveals "across the whole team, every touch of
`auth/session.ts` drags `client/api-client.ts` — there is an undeclared
contract here." It is exactly the failure AI amplifies (it edits the file in
front of it plus the one call site it can see, scattering a logical change).

Computation (one `GitRunner` call):
```
git log --no-merges --since=<window> --format=%x00%H --name-only
```
Per commit with 2..K files (cap K, e.g. skip >40-file commits as sweeps/renames),
increment `coOccur[(a,b)]` and `revs[f]`; filter both members through
`isIgnoredPath`; score = `coOccur / min(revs[a], revs[b])` (or the asymmetric
confidence `coOccur / revs[a]`); require `coOccur ≥ minSupport` to kill the long
tail. Cross-boundary pairs (differing top path segments) sort to the top as the
higher-signal subset.

Why it is a better v1 than churn×complexity: git-only (zero target dependency),
**survives squash-merge** (a squashed PR is one big file set that still yields
real pairs; the big-commit cap guards giant squashes), degrades *correctly* on
sparse history (fewer pairs clear `minSupport`, the list shrinks honestly — a
natural-zero for free), and produces output a lead actually reacts to.

**Empirical caveat (appendix, cut 4):** at 14 days on this repo, co-change
support is thin (top pairs co-occur only 2×, 38 commits touched 2–40 code
files). It *did* surface a couple of genuinely non-obvious couplings
(`client/src/lib/trpc.ts ↔ server/src/trpc/trpc.ts` cross-package;
`monster-defenses-fields.tsx ↔ monster-form-fields.tsx`), but confident ranking
needs either a longer window or a higher-cadence/larger team — which is the
"value scales with team size × AI usage" thesis *and* the skeptic's "you may not
have the audience yet" caution, both confirmed at once.

## 1.4 Revised lens roadmap

The team's proposed re-sequencing (supersedes the note's three-lens order):

| Stage | Lens | Engine | Why here |
|---|---|---|---|
| **v0** | History collector | git only | The real foundation; all lenses are reducers on it. Ship with the sparse guard + legible header. |
| **v1** | **Co-change coupling** (cross-boundary view as a sort key) — *or* churn-only top-N with context columns (§1.8) if co-change support proves too thin on target repos | git only | Highest team-altitude value, zero target dependency, survives squash. Proves the *real* plumbing better than lens 1. |
| **v2** | **Thrash**, as one lens with overlay columns: net-growth core + young-file overlay + revert/fix tiebreaker + test-vs-source ratio | git only | The note's lens 3, but unified into one ranked view rather than three parallel sub-ideas. Young-file overlay ties back to the existing `ghost-files` check ("created then thrashed/abandoned"). |
| **v3** | **Author/agent fragmentation** (distinct hands / co-author trailers per file in-window) | git only | The **squash-robust replacement for the note's lens 2**: same coordination-hotspot value without depending on merge commits existing. Trailers let you count *agent* hands. |
| **v4** | Suppression-churn hotspots (files repeatedly gaining/losing `eslint-disable`/`@ts-`) | git only (`git log -G`) | Cheap, low-FP, extends the existing `suppressions` check temporally — the most "drift:ai-flavored" hotspot. |
| **v5 (optional)** | Churn × complexity | + complexity engine | Add the engine *only* once the git-only lenses have earned the subcommand its trust. May never need to ship. |
| Defer/skip | Merge-conflict frequency (lens 2 — superseded by v3, fatal squash dependence); resist-stabilizing & ownership/bus-factor (need multi-window history 14d can't supply); cadence & AI-signature as *standalone* lenses (use them as window auto-sizing and an attribution overlay instead). |

## 1.5 Squash-merge: the default config can lie (target-dependent)

The note acknowledges squash kills lens 2 but under-weights its effect on lens 1.
The skeptic's sharpest correct point: on a squash-merge repo (the dominant modern
GitHub workflow), an entire feature branch collapses to one commit, so the
*default* `revisions` metric becomes ~uniform (every file in a PR = 1 revision).
The note's `lines` metric is documented only as an *alternate*, so **the default
configuration is wrong for the most common modern workflow.**

This repo is a *merge*-workflow repo (appendix: 131 merge commits in 14d), so the
`revisions` axis retains range here and the squash failure does not bite — which
is exactly why it is easy to miss and why a portable tool pointed at an unknown
repo must handle it. (Note: those 131 merges are *solo* branch-merges, not
multi-dev coordination events — so they do **not** mean lens 2 would find a real
coordination signal here; see §1.11.) **Recommendation:**
detect squash-y history at runtime (high ratio of single-revision files) and
either auto-switch to `lines` or skip-with-reason, reusing the sparse-history
guard machinery. This must be in v1 or the default misleads on first contact.

## 1.6 Resolved open knobs

The note's seven open knobs, with the team's recommendations (engineering lens,
cross-checked by the skeptic). Confidence noted.

| # | Knob | Recommendation | Rationale | Conf |
|---|---|---|---|---|
| 1 | `minCommits` floor | **Replace the absolute floor with a dynamic-range gate**: widen the window until the rank-N file has churn ≥ ~3× the median churn of the in-window touched set (cap at a `maxWindow`, e.g. 180d). Keep a tiny absolute backstop (`commits ≥ 5`) only to avoid running on a near-empty repo. | The note's own intent ("top-of-list counts aren't all 1–2") is a *distribution* property, not a commit count. An absolute `10` is too low for this repo (521 commits) and too high for a quiet target. | Med-High |
| 2 | Complexity engine default | **`ts-morph` default; ESLint as an opt-in mode.** | ESLint on a foreign repo is a config-authority *and* binary-resolution problem (the in-repo ratchet at `scripts/lint-ratchet/eslint-runner.ts` resolves eslint from the *target's* `node_modules`, writes a generated flat config, manages a cache — heavyweight, not a thin shell-out). ts-morph is in our deps, in-process, calibration-free (syntactic branch-node count), needs no target tsconfig. The "ratchet already does this" point de-risks the *opt-in* mode, not the default. | High |
| 3 | Normalization + combine | **Percentile/rank-normalize each axis, then multiply.** Do not adopt the visual top-right-quadrant model for a CLI. | Min-max is dominated by a single outlier (one runaway-churn or huge file rescales the axis and crushes a 1000+-file repo's signal toward 0). Percentile is outlier-robust and makes the axes commensurable. Multiply preserves the "AND" semantics; a CLI top-N is inherently a scalar ranking, so combine to a scalar. | High |
| 4 | Lens 3 (thrash) knobs | Post-v1. When built: low-net-growth = `net_lines / revisions` below a small threshold (cheap, from numstat); **scope out** `git blame`-based "re-edits of young lines" (O(commits × file-size), will dominate runtime — use the cheap young-file overlay instead); revert/fix = message-grep as a *tiebreaker* only, not a headline (accept the FP rate since it is advisory). | There is no cheap git-only line-age signal; the strong thrash signal is the expensive one. Don't let it block v1. | Med |
| 5 | Lens 2 (conflicts) spike | Worth a spike **gated on step 0: `git log --merges \| wc -l`** — skip-with-reason if merge commits are rare/absent rather than emitting a misleading near-empty tally. Predicted low-yield on squash targets. Likely superseded by v3 (author/agent fragmentation) anyway. | The git-workflow fragility is *fatal*, not merely degrading, for lens 2. | Med |
| 6 | Top-N default | `min(20, ceil(0.02 × in-window touched files))`, floor 10, hard cap ~30; expose `--top`. Allow a *short or empty* list when the distribution is flat (see §1.8 move 4). | Fraction-of-*touched*-files (not total repo) is the right denominator; past ~20–30 rows nobody reads. | Med-High |
| 7 | Output format | **Ship both from day one**: default text table + `--format json`, mirroring the main report's `formatText`/`formatJson` split. JSON must carry raw churn, raw complexity, percentiles, product score, and the resolved header metadata. | Consistency + the two highest-value consumption paths (quarter-over-quarter diff, agent-as-router) are JSON-only. See §1.8/§1.9. | High |

Additional engineering defects flagged (detail in the v1-engineer thread):
- **Compute complexity only over the churned set, not whole-repo** — bound the
  expensive axis by the cheap one. This is the single most important perf
  decision; the note's prose leans toward whole-repo complexity.
- **`isIgnoredPath`, not `filterScope`, is the reuse target** — the collector's
  natural shape is a path-keyed map, not `ChangedFile[]`.
- **Internal contradiction to resolve:** the note's "normalize to 0..1 then
  multiply" prose sits in/near the *locked* section while open knob #3 says
  normalization is undecided. Resolve to percentile and move it out of "locked."

## 1.7 Integration: follow the harness-freshness precedent, not the registry

Ship hotspots as a bespoke `argv[0] === "hotspots"` branch (like
`harness-freshness` at `runner.ts:82`), **not** gated on the `CheckPlugin`
registry. `code-quality.md` High-2 explicitly keeps `harness-freshness` outside
the registry because it is a distinct subcommand with its own finding type and
formatter; hotspots is the same shape (distinct subcommand, no `file:line`+FIX
finding, its own output). It should reuse the *leaf utilities* (the `GitRunner`
seam, `isIgnoredPath`, and — per `code-quality.md` Med-1 — a shared
finding/line renderer + header helper), but it is its own pipeline. This means
v1 does **not** block on the registry refactor.

## 1.8 Actionability: how a no-recommendation tool still drives action

The note is firm (correctly) that hotspots makes *no recommendation*. The
product lens's core warning: a bare ranked list of paths + scores is *ignorable*,
because judging each row is expensive. The fix is not a recommendation — it is to
**co-locate the cheap context that makes the human's judgment fast**, all free
from the same `git log` the collector already runs:

1. **Context-per-row.** Each hotspot ships with: top authors/agents
   (`claude×14, hans×6` — the single highest-value column, since multi-distinct-
   author churn *is* the "no individual sees it" signal made visible); the 3 most
   recent commit subjects (lets a human infer "feature" vs "fix-fix-fix"
   instantly); the *raw* numbers behind the score (never just the normalized
   product); and a copy-paste inspect command. This is the bridge to action
   without recommending one.
2. **"What changed since last run" (delta) framing.** Static top-N is low-signal
   on the Nth run (the lead already saw it last week). A `--baseline <prev.json>`
   diff turns the recurring health pass into "here's what's *newly* hot"
   (`↑ NEW`, `↑↑ +5`, `= steady`) — the single biggest lever against being tuned
   out. This requires a persisted JSON baseline, so JSON is the *substrate*, not
   a nice-to-have.
3. **Section by lens, not one blended number** (once lenses 2/3 land). A file
   appearing in multiple sections is the loud signal.
4. **Thresholded list length, not fixed N.** When the churn distribution is flat
   (top ≈ median), say "no clear hotspots this window" and show fewer/zero rows
   rather than padding to N. A short/empty list is *more* trustworthy than a
   forced top-10 of noise — the closest hotspots can get to the main report's
   "a clean run is meaningful" virtue.

The principle: **the tool supplies the evidence, the human supplies the verdict.**
Non-prescriptive *and* actionable. (See the appendix for why this matters: on
this repo's raw churn list, the *context* is what would let a human instantly
discount the docs/tooling rows.)

This principle extends to **noise filtering**, not just recommendations: the tool
does not try to detect generated files, codegen output, or other "ignorable"
files beyond the existing universal ignore defaults + the user's `ignore` config
(§1.2). Auto-classifying what is ignorable on an arbitrary repo is an unwinnable,
unportable calibration treadmill — and it is precisely the context the reader
already holds. The same verdict-ownership logic as the adapter thread (§2.1)
applies: a generated-file taxonomy is a drift:ai opinion imposed on a foreign
repo. Show what you find; let the reader discount their own noise.

## 1.9 Output, brand firewall, and naming

drift:ai's equity is "if it is in the report, it is a trustworthy, located,
low-FP finding." Hotspots is the opposite (always-emits, no location precision,
no FP bar, no fix). If a user ever parses a hotspot *row* as a *finding*, the
trust brand erodes. **Co-locate as a subcommand (discoverability, shared infra,
the harness-freshness precedent), but firewall the brand in the output, three
ways:**

- **Vocabulary firewall:** never "findings"/`WARN`/`FIX`. JSON carries
  `"kind": "advisory"` and a `"hotspots"` array (not `"findings"`), so a consumer
  cannot confuse the shapes.
- **Invocation firewall:** reachable only as `drift:ai hotspots`, never folded
  into a default or `--check all` run.
- **Framing firewall:** the mandatory header + a closing "areas to check, not
  defects" banner are brand protection, not just UX.

**Do not** fold it into the `CheckPlugin` registry (its `ran|skipped` contract is
defined around the findings model hotspots rejects). **Do** fix the
`harness-freshness` second-class-surface wart (`ux-reporting.md` L1): hotspots
gets first-class `--format`/`--output` from day one via the *shared* parser, and
harness-freshness should be retrofitted onto the same parser so there is one, not
three.

**Naming:** keep `hotspots` as the umbrella verb (industry-standard, Tornhill
lineage), with lenses as a dimension: `drift:ai hotspots --lens
churn|coupling|thrash|all`. Avoid per-lens subcommands (fragments
discoverability) and avoid any verdict-implying name (`risks`, `smells`,
`problems`).

The single product persona caveat worth carrying: **an autonomous agent is only
a valid consumer as a *router*, not an actor** — it can read the JSON and scope
the *trusted* drift checks to the top hotspots, but it cannot supply the org
judgment the no-recommendation stance reserves for humans, so it must never be
told "fix the hotspots."

## 1.10 The skeptic's kill-criteria (gate before building v1)

Do **not** build v1 as specified if any of these hold:

1. **The surprise test fails.** Run the algorithm on real history; if the top-N
   contains zero files a knowledgeable maintainer did not already know were hot
   *and then acted on*, it is a vanity metric. (We ran the cheap version on
   *this* repo — see §1.11 / appendix — and it surfaced docs/tooling, the known.
   But **this repo cannot run the surprise test**: it is a solo project, the
   exact low-signal case the thesis excludes, so a failed surprise test here is
   guaranteed and meaningless. The test only discriminates on a multi-dev,
   AI-heavy repo where "what no individual dev can see" is a real category. Run
   it there before committing.)
2. **The valuable lenses don't survive a paper spike.** If a quick thrash /
   co-change run on real history is *also* just-the-known, there is no
   concentrated value anywhere in the roadmap.
3. **The squash default can't be made non-lying in v1** (§1.5).
4. **The audience doesn't exist yet.** The value thesis is "team size × AI
   usage." If the first user is the solo/small-team-scanning-a-foreign-repo case
   that is the stated portability target, build it when the team exists, and
   validate criterion 1 on *that team's* repo.

The cheapest alternative that captures most of the churn value (and *is* the
criterion-1 experiment) is a ~10-line shell snippet (appendix). Spend its one
second before spending the subcommand's several days.

## 1.11 Empirical grounding

We ran the kill-criterion experiment against this repo's last 14 days. **Caveat
that frames everything below: this is a solo project**, i.e. the low-signal case
the value thesis explicitly excludes. So these results validate the *mechanics*
of the collector and the live engineering questions (ignore-filtering, churn
dynamic range), but they say **nothing about value** for the intended
team-altitude audience — the surprise test cannot even run on a solo repo. Full
numbers in the appendix; the load-bearing (mechanics-level) results:

- **Unfiltered churn top-20 = docs + lint/harness tooling** (`STATUS.md`,
  `LOG.md`, `NEXT.md`, `lint-ratchet.baseline.json`, `eslint.config.js`, lint
  scripts, `package.json`). On a foreign repo without tuned ignores, this is the
  noise the tool would lead with. (Musi's config ignores `docs/`, which would
  strip the worst of it. This is **not** an argument that the tool must get
  cleverer about filtering an untuned foreign target — per §1.2 it ships the
  universal defaults + the user's `ignore` config and otherwise lets the reader
  discount their own docs/tooling. The reader of *this* list instantly knows
  `STATUS.md` is a notes file.)
- **Code-only churn has almost no dynamic range** (max 4 revisions/14d, bulk
  2–3). churn×complexity on real code ≈ complexity ranking ≈ already
  ESLint-gated. This is the strongest empirical strike against lens 1 as v1.
- **Co-change found a few non-obvious pairs** (cross-package trpc coupling; the
  monster-form cluster) but at thin 14d support — promising shape, needs scale.
- **131 merge commits / 14d**, but they are *solo* branch-merges (no second
  developer, no conflicts), so they keep the `revisions` axis from looking
  squash-flat *without* implying lens 2 has any real coordination signal to find
  here. The merge-vs-squash mechanics and the coordination signal are separate
  things; this repo has the former and not the latter.

---

# Part 2 — The adapter policy thread ("do NOT add" is target-conditional)

## 2.1 Reframe the boundary: verdict ownership, not reimplement-vs-adapt

The note splits the old rule into "do not reimplement (target-independent)" vs
"may orchestrate via adapter (target-conditional)." The adapter architect and the
skeptic independently converged on a sharper, blur-proof framing:

> **Delegate the verdict, not just the engine.** An adapter is allowed only when
> it (1) runs a tool the target could run itself, (2) using thresholds and config
> the target authored or the tool published — never a verdict drift:ai invented —
> and (3) skips-with-reason rather than substituting a drift:ai opinion when the
> tool or a trustworthy config is absent.

The discriminating question is **who owns the verdict/threshold**, not whether the
detection is hand-rolled or shelled-out. Three tests classify any candidate:
detector authorship (drift:ai vs an ecosystem tool), calibration provenance
(drift:ai-invented threshold vs the tool's/target's), and **target-independent
reproducibility** — could the target get the *same* finding by running the
upstream tool themselves? The third test is the trust keystone: a finding a
reviewer can reproduce in one command (`npx knip --reporter json`) has an
external oracle; a bespoke heuristic that only drift:ai emits has none, which is
how a report-only sensor loses trust.

This framing dissolves the blur cases the original distinction left open:
- A "wrapper" that runs ESLint but supplies drift:ai's own `complexity: max 8` →
  reimplementation (drift:ai owns the threshold), engine borrowed or not.
- A tool run under a drift:ai-authored baseline config on a foreign repo →
  reimplementation in disguise (the *config* is the invented verdict).
- Reading one rule's output while ignoring the target's own config (which may
  have disabled it) → re-enabling a rule the target opted out of = FP by
  construction.

## 2.2 The two tiers + config-authority precedence (the crux)

The note's "opt-in + skip-cleanly" is **necessary but not sufficient**: an
imposed baseline config emits findings calibrated to someone else's taste, and
"opt-in" is a one-time consent the user forgets they granted on every later run.
Split into two tiers:

- **Tier 1 — pass-through (safe).** Run the *target's own* configured tool;
  surface its findings. Zero imposed opinion. This is what the knip orphan-files
  precedent actually is.
- **Tier 2 — imposed baseline (dangerous).** Apply a drift:ai baseline config
  when the target has none. Off by default; behind an explicit
  `--adapter-baseline=<tool>` flag; **every finding stamped as drift:ai's
  opinion, not the target's** (`configSource: "drift-baseline"`).

Config-authority precedence ladder (first that exists wins):
1. Explicit `--<tool>-config <path>` (user authority).
2. Target-local config discovered in the target repo (target authority).
3. drift:ai baseline — **only** if `--adapter-baseline=<tool>` is set; findings
   provenance-stamped.
4. Otherwise → **skip** (`code: no-target-config`). *This is the default.*

Invariant: opting into a baseline never overrides a config the target actually
wrote (target-local always wins). The default behavior on a foreign repo is
*skip cleanly with a reason*, never *emit findings under an opinion the target
didn't choose*.

## 2.3 The ESLint-subset inversion (sharpest disagreement with the note)

The note says the non-type-aware ESLint subset (complexity, magic-numbers,
function-length) is "the *easiest* to deliver this way [as an adapter]." Both the
adapter architect and the skeptic flag this as **inverted**: those are precisely
the contested-taste, threshold-driven rules with the highest FP load
(`no-magic-numbers` is rated Med FP even in-repo). On an under-gated target —
the exact portability case — delivering them as findings means drift:ai authors
*both* rule-selection and thresholds (blur #1 + #2 at once). They are "easiest to
deliver, riskiest to trust."

**Reclassify them:** allowed only (a) as a *metric* in the hotspots subcommand
(measurement mode, threshold 0, no verdict), or (b) as a findings-adapter *only
when the target's own ESLint already enables the rule* (drift:ai reads the
target's threshold). **Never** a default findings adapter on a repo with no
config.

The durable line: **structural/cross-file adapters (knip orphan-files with
target config, madge/import-x cycles as verdict-free facts) = good; single-file
taste-threshold adapters = no.** This preserves drift:ai's actual differentiator
(it sees cross-file things single-file linters can't).

## 2.4 Adapter-candidate catalog

| Candidate | Surfaces | Target config to honor? | Verdict + trust protection |
|---|---|---|---|
| **knip — orphan/unused *files*** | files imported nowhere | Yes (entry points define "orphan") | **good — only with target config**; hard-skip `no-target-config` otherwise. Re-states research candidate #3's "Maybe" in target-conditional terms (the redundancy framing was Musi-specific). |
| **madge `--circular --json`** | import cycles | partial (needs target tsconfig aliases) | **good** (roadmap "add first"). Cycles are verdict-free facts — no threshold to mis-import; gate on resolving aliases + labeling type-only edges. |
| **eslint-plugin-import-x `no-cycle`** | import cycles | inherits target resolver | **good** (alternative to madge; already a dep). Pick one. |
| **dependency-cruiser** | cycles **+ layering rules** | yes (the ruleset *is* the config) | **good only for the cycle subset / for repos that ship their own config**. A drift:ai-authored layering ruleset on a foreign repo is blur #2. Use madge for portable cycles. |
| **ESLint complexity/magic-numbers/function-length** | per-function metrics | yes (the crux) | **risky (findings) / no (default-on)** — see §2.3. Metric in hotspots, or findings only when the target enables the rule. |
| **similarity-ts** (Rust/cargo) | near-duplicate functions | none (threshold is drift:ai's) | **good as opt-in high-fidelity mode**; measurement-ish like jscpd; conservative ≥0.85 + min-lines floor; skip-clean when binary absent (ts-morph in-process path is the default, and is *not* an adapter — it lives by the low-FP bar directly). |
| knip unused *exports* / deps; tsc typecheck | dead exports, type errors | yes | **no** — the target's own knip/build already owns these; report-only surfacing is a weaker duplicate. |
| gitleaks / trufflehog | secrets/PII | yes | **no** — a *security* gate (fail-the-build), wrong category. The one "do NOT add" item needing no re-justification. |

## 2.5 ENOENT should skip, not emit a finding (a correction to the jscpd precedent)

The existing jscpd adapter (`duplicates-runner.ts`) turns a missing binary into a
`DriftFinding` WARN. Under the `CheckOutcome` model, a *missing tool on a foreign
repo* is an **expected absence** → `status: "skipped"`, not a finding — otherwise
a pnpm target shows a "finding" on every run and the "clean run is meaningful"
contract erodes. Distinguish: missing tool = skip; tool that *ran and
crashed/produced unparseable output* = a single diagnostic finding. This is a
deliberate behavior change to make when generalizing jscpd into the registry
(flag it for the A4 skip-reason work in `ux-reporting.md`).

Also worth noting: jscpd and similarity-ts are **measurement-ish adapters** (no
target config to honor; thresholds unavoidably drift:ai-authored, tolerable
because duplication has no "target standard"), whereas knip/ESLint/madge are
**config-honoring adapters** (target authority must win). The config-authority
precedence (§2.2) applies only to the second group — don't apply "skip when no
target config" to jscpd.

## 2.6 For Musi itself, the original rule stands unrevised

The skeptic's important scoping point: the revision is **target-conditional**.
For Musi (which *has* the ESLint/knip gates), a drift:ai adapter that re-runs
them is slower, report-only (a weaker gate than the existing ERROR-gating), and
redundant with `bun run lint`/`sensor:knip` — `additional-checks-research.md`'s
"strictly weaker duplicate" verdict still holds. The doc edit should be framed as
a *target-conditional addition* for under-gated external repos, **not** a
softening of the Musi-side prohibition. And bound the ambition: cap the adapter
set at the structural, genuinely-cross-file tools (knip orphan-files, madge
cycles), so drift:ai stays a sharp AI-drift sensor rather than becoming a slow,
less-trustworthy meta-linter.

## 2.7 The doc edit to make on promotion

The adapter architect drafted ready-to-drop-in replacement prose for the
"Explicitly do NOT add" section (it replaces both
`additional-checks-research.md` lines ~176–190 and the parallel paragraph in
`drift-ai-improvements.md` lines ~296–302), splitting it into:
- **Category 1 — Do NOT reimplement (target-independent):** hand-rolled
  complexity/length/magic-number/dead-export/unused-import heuristics;
  inconsistent-naming & large-diff (no low-FP tool *and* drift:ai authors the
  verdict — doubly disqualified). Re-justified from the no-external-oracle trust
  argument, **not** from Musi's gating.
- **Category 2 — May orchestrate via adapter, with care (target-conditional):**
  knip orphan-files (with target config), madge/import-x cycles, similarity-ts
  (opt-in) — each with its care condition, plus the hard caution on imposed
  config (default = skip).
- **Still excluded outright:** secrets (wrong category), churn×complexity & other
  *metrics* (no verdict → belong in the hotspots subcommand, never a check or
  adapter — citing this note), lockfile drift (ignored by design).

The full prose is preserved in the adapter-architect thread of this brainstorm;
drop it in verbatim when this is promoted.

---

# Part 3 — Open forks for the revisit (the team did not resolve these)

1. **Is hotspots worth building at all, or is it a `git log` wrapper?** The
   skeptic's bottom line was "don't build v1 as specified — run the
   kill-criterion experiment first." The empirical run (§1.11) is **not even a
   yellow flag** — it ran on a solo repo, which the thesis already concedes is
   low-signal, so it cannot speak to value either way. We then ran it on a real
   target — OpenClaw, a multi-dev AI-augmented TS/pnpm monorepo (appendix #2) —
   and the git-only signals came back rich and individually-invisible (48-author
   files; cross-package hidden contracts). That **meets the prerequisite for
   value** the solo repo could not, and leans the question toward "worth building"
   for the git-only lenses. **Still needed for a verdict:** a knowledgeable
   maintainer of such a repo confirming the top rows get *acted on*, not just
   that they are structurally interesting — the one thing an outside analyst
   cannot judge.
2. **v1 lens: co-change coupling vs churn-only-with-context.** Co-change is the
   higher-ceiling, more-novel signal but needs scale to be confident (thin at
   14d here). Churn-only-with-context is lower-risk and proves the collector +
   context columns. **Both beat churn×complexity as v1; pick between them.**
3. **Does the team-altitude audience exist for the first ship?** The value thesis
   needs team size × AI usage; the stated portability target is solo-scanning-a-
   foreign-repo. These are in tension. Build now (for Musi's own multi-agent
   history) or wait for the audience?
4. **Window primitive for the *code* axis.** 14d is tuned to AI cadence, but the
   code-only churn axis was near-flat at 14d on this repo. Does the code-level
   signal want a longer default window than the docs/tooling churn does? Should
   the window be commit-count-based (burstiness) by default rather than the
   escape hatch?
5. **Adapter scope ceiling.** Cap at structural cross-file adapters (knip/madge),
   or allow the broader "single drift report orchestrates everything" ambition?
   The skeptic argues the cap protects the brand; the roadmap leans toward the
   single report.
6. **Tier-2 imposed-baseline config: ship it at all?** Even with per-run
   provenance stamping, is an imposed-baseline mode worth the trust risk, or
   should drift:ai be Tier-1-only (pass-through the target's own config, else
   skip)?

---

# Appendix — empirical run (this repo, last 14 days, 2026-05-29)

Read-only `git log` analyses run to ground the kill-criterion. Commands are the
cheap-alternative the skeptic proposed; treat as a smoke test, not the tool.

**Cut 1 — unfiltered churn top-N (revisions, 14d, `--no-merges`):** dominated by
`docs/agent_notes/STATUS.md` (175), `LOG.md` (173), `NEXT.md` (126),
`lint-ratchet.baseline.json` (90), then lint-followups docs, `eslint.config.js`
(55), lint-ratchet scripts, `package.json` (40), harness config. **Conclusion:**
without tuned ignores, the list leads with docs + lint/harness machinery — the
churn of meta-work, not feature code; the "you already knew this" failure mode.

**Cut 2 — squash detection (per-file revision distribution):** 441 files at 1
revision, 328 at 2, 115 at 3, tailing to a handful at 12–16. 521 no-merge
commits, **131 merge commits**, 1074 distinct files touched. **Conclusion:** this
is a *merge*-workflow repo (so `revisions` is not squash-flattened) — but the
131 merges are solo branch-merges, **not** coordination events, so lens 2 has no
real signal to find here regardless. 72% of files have ≤2 revisions, confirming
the dynamic-range concern (only the top ~20–40 separate).

**Cut 3 — code-only churn (`packages/**/src/**.{ts,tsx}`, non-test):** the
*maximum* is 4 revisions (`harness-diagnostics.ts`, `spellcasting.ts`,
`map-canvas-overlays.tsx`), with the bulk at 3 and 2. **Conclusion:** the
code-only churn axis has almost no separating power at 14d → churn×complexity
collapses to a complexity ranking (already ESLint-gated). Strongest strike
against lens 1 as v1.

**Cut 4 — co-change coupling feasibility (code pairs, commits touching 2–40 code
files):** 38 qualifying commits, 210 distinct files; top pairs co-occur only 2×.
Surfaced a genuinely cross-package coupling
(`client/src/lib/trpc.ts ↔ server/src/trpc/trpc.ts`) and a same-feature cluster
(`monster-defenses-fields.tsx ↔ monster-form-fields.tsx`) among low-support
noise. **Conclusion:** promising signal shape — it found non-obvious couplings —
but support is too thin at 14d on a single repo; confident ranking needs a longer
window or a higher-cadence/larger team, exactly as the value thesis predicts.

---

# Appendix #2 — empirical run on the *right kind of target* (OpenClaw, 2026-05-29)

The user supplied `github.com/openclaw/openclaw` as a test repo, and it turns out
to be **nearly the ideal drift:ai target**: a TypeScript/pnpm monorepo
(`packages/` + `apps/`, 15,507 `.ts` files), **AI-augmented** (`CLAUDE.md`,
`AGENTS.md`, `.agents/`; it uses oxlint, not ESLint), and **massively
multi-developer** (53,957 commits, **2,394 distinct authors** over ~6 months, 456
merges). This is the team-size × AI-usage regime the value thesis is *about* — so
unlike appendix #1, this run can actually speak to value. (Caveat on my judgment:
I can assess whether the output is *structurally rich and individually-invisible*;
I cannot judge whether a specific OpenClaw maintainer would be *surprised and
act* — that needs an insider.)

All cuts are git-only (`--name-only`, blobless clone), 30-day window: 15,879
no-merge commits, 8,394 distinct source files touched (`.ts/.tsx/.mts`, excluding
tests, `.d.ts`, generated, and i18n locales).

**Cut A — churn dynamic range (the solo-repo contrast):** max **208** revisions;
**18 files ≥50 revs, 169 files ≥20**; 3,341 of 8,394 files at exactly 1 rev.
Versus the solo repo's *code* max of **4**. **Conclusion:** the churn axis has
enormous separating power here, so churn-based lenses do **not** degenerate — the
"disguised complexity ranking" failure of §1.1 was *solo/low-activity-specific*,
not universal. (Correction to carry: don't over-generalize the solo degeneracy.)
Top clean churn: `extensions/codex/.../run-attempt.ts` (208),
`src/agents/pi-embedded-runner/run/attempt.ts` (141), `.../run.ts` (117),
`src/config/schema.help.ts` (89), `extensions/telegram/.../bot-message-dispatch.ts`
(76).

**Cut B — author fragmentation (the standout signal):** single source files
touched by **20–48 distinct authors in 30 days** — `pi-embedded-runner/run/attempt.ts`
(48), `codex/.../run-attempt.ts` (45), `run.ts` (40), `agent-runner-execution.ts`
(33), `openai-transport-stream.ts` (31). **Conclusion:** this is a strong,
squash-robust coordination signal that is *definitionally invisible to any one of
the 48 contributors* — the clearest empirical instance of the "no individual dev
can see it" thesis. It validates the signal-cartographer's author/agent
fragmentation lens (roadmap v3) and is arguably the single most compelling
git-only signal of the whole run. It needs **no** complexity engine and **no**
merge commits.

**Cut C — co-change coupling (real hidden contracts + the noise tail):**
- *Tight same-area coupling:* `config/schema.help.ts ↔ config/schema.labels.ts`
  (50×, conf 0.82) — two halves of one schema that always move together (a
  "missing abstraction?" prompt).
- *Cross-package hidden contracts (the flagship value):*
  `extensions/discord/config-ui-hints.ts ↔ src/config/zod-schema.providers-core.ts`
  (23×, conf 0.79, CROSS) and `↔ bundled-channel-config-metadata.generated.ts`
  (22×, CROSS) — change the core config schema and you must touch the Discord
  extension's UI hints. A dev working only in `extensions/discord` *or* only in
  `src/config` would never see this. This is exactly the coupling §1.3 predicted.
- *Noise tail (and what to do about it — NOT auto-filter):* the i18n locale files
  move in lockstep (`ar.ts ↔ id.ts ↔ pt-BR.ts ↔ …`, all ~22×, conf 0.71 — add one
  key, touch 10 locales), and `*.generated.ts` files rank high in raw cuts. The
  tool should **not** try to detect and exclude these itself — chasing every
  flavor of generated/ignorable file is an unwinnable, unportable calibration
  treadmill, and it is exactly the human-context the reader already has ("that's
  our locales / our codegen — skip it"). The tool reuses the *existing* universal
  ignore defaults + the user's `ignore` config and stops there; beyond that it
  shows what it finds and the reader discounts. The only tool-side option worth
  considering is a purely *structural*, repo-agnostic one — capping a single
  file's co-change degree so one barrel/config that pairs with everything cannot
  drown the list — and even that is optional legibility, not noise-classification.

**Cut D — monorepo concentration:** churn spreads across many dirs (`src/agents`
5,159 revs, `src/gateway` 1,980, `src/plugins` 1,791, `extensions/codex` 1,489,
`src/auto-reply` 1,274, `extensions/discord` 1,256, `src/config` 1,131, …).
`src/agents` dominates (~2.5× the next) but it is not pathological. **Conclusion:**
the skeptic's monorepo concern (one hot package swamps the list) is *present but
manageable* — a per-package/per-top-dir normalization or a package column would
sharpen it, not a blocker.

**Overall conclusion.** On the kind of repo the thesis targets, the **git-only**
lenses produce rich, non-degenerate, individually-invisible output — the
prerequisite for value the solo repo categorically could not meet. The two
strongest signals are **author/agent fragmentation** (Cut B) and **cross-package
co-change** (Cut C), neither of which is the note's proposed v1 (churn ×
complexity) — reinforcing §1.1's recommendation to lead with a git-only lens.
Generated-file and i18n-lockstep noise is real but is **not the tool's problem to
solve**: the reader recognizes and discounts it (see §1.2). The remaining gap to a
true value verdict is an insider's "did we act on it?", which only an OpenClaw
maintainer can close. Notably, OpenClaw uses **oxlint, not ESLint**,
which further supports the ts-morph complexity default (knob #2): a portable tool
cannot assume an ESLint install on the target.

---

# Appendix — where the per-perspective detail lives

This synthesis compresses five agent analyses. The fuller reasoning (tables,
computation sketches, ready-to-drop-in prose) is preserved in the brainstorm
transcript; if promoted, the highest-value extracts to carry forward are:
- Signal cartographer — the ranked signal catalog (15 signals scored on
  team-altitude × low-FP × portability) and the co-change/thrash/fragmentation
  computation sketches.
- v1 engineer — the open-knob decision table, the collector-parsing caveats
  (NUL/blank-line, binary markers, `--no-renames` correctness), and the minimal
  v1 slice.
- Red team — the attack list with severities + neutralizers, and the kill-criteria.
- Adapter architect — the three classification tests, the `ExternalAdapter`
  contract sketch (preflight gates, skip-reason taxonomy, provenance in
  `details`), the candidate catalog, and the full replacement prose for §2.7.
- Product/consumer — the personas + moment-of-use + concrete actions, the
  actionability moves, and the text/JSON output mocks.
