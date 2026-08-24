# Orchestration Plan — Code Quality Audit 2026-08-01

Status: living plan + state ledger for the audit. Update the
[state ledger](#state-ledger) and commit at every session boundary.

Revision note: reviewed pre-launch by a three-seat panel (GPT, Grok, Fable),
then by a second review round (codex re-review); this version folds in both.
Consciously declined in round two: no formal JSON Schema yet (the
orchestrator validates structurally; a schema file may be added in Phase 1
if validation disputes arise), no per-shard identity in banked coverage (the
fanout is an internal lane mechanism), and no prompt hashes (prompts and
addenda are committed — git is the prompt record). Phase 5's full two-half
reject audit is retained deliberately: the owner chose heavy scale, and that
split has caught real promotions before. Review raw output is not retained —
the plan is the record.

## Owner decisions (recorded 2026-08-01 — do not re-litigate)

1. **Standalone + dedup.** This pack stands alone next to
   `code-quality-2026-07-25`. That pack's remaining work and `CONSTRAINTS.md`
   are exclusion inputs to every lane; genuinely new findings in
   already-covered areas remain allowed.
2. **Full re-sweep with gap weighting.** Everything is in scope again, with
   fresh lenses (organization, idiom, new-contributor friendliness). Extra
   weight goes to what the last audit never read: `scripts/drift-ai/` module
   bodies, `scripts/codemods/` implementations, `harness.controls.json`
   internals, most of `docs/` — plus code changed since the last audit's pin.
3. **drift-ai is a hotspot *finder*, not a special target.** Phase 1 runs
   `bun run drift:ai` to surface areas worth extra sweep attention. The
   drift-ai codebase itself is an ordinary audit subject like everything else.
4. **Heavy scale.** Nine wave-1 codex lanes, a bounded wave 2, Fable
   verification of every candidate cluster, and direction review of every
   surviving candidate.
5. **Feature proposals are in scope**, owned by lane 08 and held to their own
   evidence standard (see [Feature findings](#feature-findings)).
6. **Multi-session.** Session 1 (2026-08-01) delivered the plan. All docs
   land on branch `feat/cq-2026-08-audit-plan` (branched from `8ab48f723`);
   commit at every phase boundary so any session can die safely.
7. **Codex does the wide reading; Fable does the judging.** Codex lanes are
   cost-effective breadth and report severity/size only as *hints*.
   Authoritative severity/size, dedup rulings, direction calls, and leaf
   authoring belong to Fable-family agents.

   **Amended 2026-08-03 (owner decision — this supersedes the Fable clauses
   of decisions 4 and 7).** Fable 5 usage was exhausted partway through
   Phase-4 authoring (r38, 143 of 203 leaves). Every remaining role — audit,
   judging, direction, authoring, and checking — runs on codex. What survives
   is **role separation, not model separation**: no consult judges its own
   output, and promoter, judge, author, and checker are always distinct
   dispatches. The hint-vs-authority split in the finding contract is
   unchanged; only the family holding the authority seat moves.

## Deliverable

An evidence pack in the 2026-07-25 format: `00-index.md` scheduling rules and
generated leaf-catalog routing, `LEAVES-*.md` catalog pages,
`AUDIT-SUMMARY.md` (lenses + coverage honesty),
`CONSTRAINTS.md` (rulings made during triage), and `NN-<slug>.md` leaves where
every claim carries `path:line` at the audit pin or a measured count. Leaves
are proposals for a future tech-debt line of work — the audit itself changes
no source. A `BUGS-HANDOFF.md` note survives finalization if lanes tripped
over suspected bugs (input to a later `/code-review`, not part of the pack's
own queue).

**Audit lenses:** maintainability, readability, organization/layout, idiom,
naming, duplication, layering, dead weight, hacky/unusual constructs,
new-contributor friendliness, DX, and useful-feature opportunities.
`comment` findings mean *misleading or drifted* comments only — stylistic
comment archaeology was the prior pack's dedicated lens and is not re-run.
**Copyability** (harness lanes): judged as "could an outside repo adopt this
piece with at most one file of Musi-specific coupling?"
**Explicitly not:** bug hunting and security review (owned by `/code-review`
and `/security-review`). Lanes that trip over a suspected bug record it in
`bugsSideList` and move on.

## Pins

Two SHAs, recorded in the [state ledger](#state-ledger) at Phase-1 launch and
used by every wave:

- **`AUDIT_TARGET_SHA`** — the commit every citation is pinned to. The audit
  branch only accretes pack docs, so the checkout's source tree stays
  identical to this pin; if that ever stops being true (rebase, source
  commit), dispatch lanes from a detached worktree at the pin instead.
- **`PRIOR_AUDIT_SHA` = `883d48bf`** — the 2026-07-25 pack's evidence pin;
  baseline for churn metrics (`git log 883d48bf..AUDIT_TARGET_SHA`), never a
  citation target.

## Lane ownership matrix

The wave-1 authority for "who reports what". A lane that notices something
outside its rows adds a one-line pointer to its coverage record — not a
finding. Test-shaped findings belong to lane 06 everywhere; docs-drift to
lane 07; cross-package patterns and features to lane 08.

| Lane | Owns |
|---|---|
| 01 harness-core | `scripts/` flat top-level files (facades: `doctor.sh`, `worktree-db.sh`, `sensor-*`, `suppression-*`, seed/db utilities, …), `scripts/{lib,git,harness,verify*,ai-hooks,drift,fixtures,harness-audit}/`, `scripts/data/`, `.husky/`, `harness.controls.json`, `scripts/land.sh`, gate env plumbing, `.github/workflows/`, `.github/hooks/`, agent adapter trees (`.claude/`, `.codex/`, and siblings) |
| 02 analyzers | `scripts/drift-ai/`, `scripts/drift-triage/`, `scripts/logs-audit/`, `scripts/code-intel*` + `scripts/code-intel/`, root `drift-ai.config.json` + `drift-ai.config.example.json` |
| 03 server | `packages/server/src/` (minus tests), `packages/server/prisma/` (schema, migrations, seeds), `packages/server/scripts/`, package config surface |
| 04 shared | `packages/shared/src/` (minus tests), package config surface |
| 05 client | `packages/client/src/` (minus tests), package config surface |
| 06 tests | all `*.test.*`/`*.spec.*`/`*.test-helper.*` and shared fixtures across packages and `scripts/`, `scripts/tests/` (the shell-smoke substrate), `e2e/`, vitest configs, `playwright.config.ts`, package-level Stryker configs |
| 07 docs-dx | `docs/` in full, MODULE.md coverage, `AGENTS.md`/`CLAUDE.md`, READMEs, package.json script surface as UX, root configs (`tsconfig*.json`, `knip.config.ts`), `.devcontainer/` + docker/SQL setup, per-worktree dev DX |
| 08 cross-cutting | repo-wide patterns whose evidence spans at least two other lanes' areas; new-contributor tripwires; all `feature` findings |
| 09 lint-machinery | `eslint-rules/`, `eslint-config/`, `tools/lint-ratchet/`, `scripts/lint-ratchet/` (the Musi adapter), `scripts/lint-message-eval/`, `scripts/path-policy/`, `scripts/codemods/` implementations (fixtures sampled), `tools/stryker-lint-ratchet.mjs`, `examples/lint-ratchet-demo/`, lint-ratchet baseline files (root `lint-ratchet.baseline.json`, `eslint-config/max-lines-exceptions.baseline.json`) |

**Default rule:** any tracked path not matched by a row defaults to lane 01
if it is under `scripts/` or is a root-level harness/config file; any other
unmatched path must be explicitly assigned to a lane or excluded during
Phase 1 (see the matrix-closure step in the phase plan).

**Deliberately excluded** (record in the eventual AUDIT-SUMMARY as skipped,
not clean): `packages/server/src/generated/`, build artifacts and lockfiles,
drift packet outputs, SRD *content* correctness (data values, as opposed to
how the data is structured), and the contents of `docs/agent_notes/` packs
(their *structure* is lane 07's).

## Phase plan

| Phase | What runs | Output (committed) |
|---|---|---|
| 0 | Plan + prompts authored, panel-reviewed, revised | this doc, `prompts/` |
| 1 | **Barrier.** Record pins; build the dedup corpus; lane 00 runs `bun run drift:ai` + cheap repo metrics; orchestrator writes per-lane hotspot addenda; **matrix closure** — the dispatcher enumerates `git ls-files` top-level directories and root files against the ownership matrix and records every assignment/exclusion in `working/ownership-closure.md` before wave 1 dispatches | `working/dedup-corpus.md`, `working/hotspots.md`, `working/addenda/`, `working/ownership-closure.md` |
| 2 | **Wave 1:** lanes 01–09 in parallel (read-only codex, internal subagent fanout); each answer validated against the contract, then banked | `working/wave-1/lane-NN.json` |
| 3 | **Barrier, then wave 2:** orchestrator routes banked `coverage.pointers`/`featureIdeas` into the wave-2 briefs (see Pointer routing below); at most two top-up rounds on hotspots and skipped scope, then one completeness critic — a pass/fail barrier that must pass or be dispositioned before Phase 4 | `working/wave-2/*.json`, critic note |
| 4 | Fable triage workflow: cluster → verify → judge → direction → author | `working/triage/*`, draft leaves |
| 5 | Final review with stopping rules; finalize pack; prune `working/` | final pack |

Read-only consult lanes may run in parallel; anything that mutates the tree
stays serialized.

**Pointer routing.** After wave-1 banking, the orchestrator aggregates every
banked lane's `coverage.pointers` and `featureIdeas` and routes them into
the wave-2 briefs: test-shaped pointers go to a lane-06 top-up, docs-drift
pointers to lane 07, cross-cutting and feature material to lane 08, and
anything else to the lane that owns it. These fields have no other
consumer — an unrouted pointer is a lost signal.

**Completeness critic.** The critic is a pass/fail barrier, not advice. It
fails on any universally-skipped scope or any matrix area left unassigned.
On a failure the orchestrator either authorizes **one** additional top-up
round beyond the two-round cap or records an explicit exclusion; Phase 4
triage does not start until the critic passes or every failure is
dispositioned.

## Dispatch mechanics (codex lanes)

- Use the **agent-cli skill** (`agent-run.sh` wrapper), agent `codex`, default
  model. One dispatch per lane.
- **Lane prompt = `prompts/TEMPLATE.md` + the lane's `prompts/lane-NN-*.md`
  + that lane's Phase-1 hotspot addendum**, concatenated, with placeholders
  filled: `{{LANE_ID}}`, `{{AUDIT_TARGET_SHA}}`, `{{DEDUP_CORPUS_PATH}}`
  (absolute path to a copy outside the repo if lanes run detached), and
  `{{PRIOR_AUDIT_SHA}}` (used by lane 00 only).
  **Exception: lane 00 dispatches standalone — TEMPLATE.md is *not*
  prepended** (it is a metrics task, not a findings sweep); its dispatch
  fills both `{{AUDIT_TARGET_SHA}}` and `{{PRIOR_AUDIT_SHA}}`.
- Lanes must be told **explicitly to fan out with internal subagents** — one
  dispatch that parallelizes internally, never N wrapper calls. The template
  mandates an explicit glob partition per subagent and a per-shard coverage
  record.
- **The lane's final response IS the deliverable** (one JSON object; markdown
  for lane 00). The wrapper's `-o` captures it. Lanes write no files. The
  orchestrator then: validates the JSON against the finding contract
  (well-formed, required keys, ownership respected), copies it to
  `working/wave-1/lane-NN.json`, commits, and marks the run **banked** in the
  ledger. A run is not banked until it validates; a failed validation gets
  one resume-with-feedback before redispatch.
- **Fresh `-o` and log paths for every run and every retry.** On a capacity
  crash, re-dispatch the same prompt with fresh paths.
- Lanes are read-only: no edits, no commits, no branch changes.
- Soft cap: ~20 findings per lane, ranked by value; anything cut is named in
  `coverage.cut` rather than silently dropped.

## Dedup corpus (built in Phase 1, frozen for the waves)

Bare leaf numbers are the wrong dedup key — 18 of the prior pack's 20 open
leaves are superseded by plans whose slices are variously landed, optional,
blocked, or dropped. The orchestrator distills, into
`working/dedup-corpus.md`:

- every open leaf and each plan's remaining slices, with status
  (`scheduled` / `optional` / `blocked` / `no-work-left`) and one-line scope;
- every CONSTRAINTS.md ruling as a one-line "do not re-propose" record;
- one-line "do not reopen" entries for the finished shared/client clusters
  and for deliberately declined directions recorded outside CONSTRAINTS
  (landed-leaf divergences, dropped steps).

**Record shape.** Each corpus record carries: an id `CQ25-<n>` (sequential),
a `kind` (`open-leaf|plan-slice|ruling|do-not-reopen`), a status, a one-line
scope, and a source anchor (file + heading in the 2026-07-25 pack). The
corpus header records the prior-pack commit it was distilled from. The
corpus is exempt from final pruning: at finalization it is promoted into the
pack as `DEDUP-CORPUS.md` so the record ids cited in `priorPackOverlap` and
the drop trail never dangle.

Lanes cite corpus records (not leaf numbers) in `priorPackOverlap` and
`droppedAsPriorPackDuplicate`. Subagent briefs must carry the corpus rows
relevant to their slice — the fanned-out readers are the ones who need them.
During Phase 4 authoring, reconcile accepted candidates against the *live*
prior-pack state once more (the corpus is a launch-time snapshot; the other
pack keeps moving).

## Finding contract

Each lane's final response is a single JSON object (`contractVersion: 1`):

```json
{
  "contractVersion": 1,
  "lane": "lane-03-server",
  "auditTargetSha": "<AUDIT_TARGET_SHA>",
  "findings": [
    {
      "id": "L03-001",
      "title": "one-line finding name",
      "area": "shared|server|client|harness|tests|e2e|docs|cross-cutting",
      "category": "organization|idiom|naming|duplication|layering|comment|hack|dead-code|test-shape|dx|feature",
      "severityHint": "low|medium|high",
      "sizeHint": "S|M|L|XL",
      "evidence": [
        { "path": "packages/…", "line": 123, "endLine": null, "measurement": null, "note": "what this shows" },
        { "path": "packages/…", "line": null, "endLine": null, "measurement": "34 call sites (rg -c …)", "note": "spread" }
      ],
      "problem": "what is wrong and why it hurts maintainability/readability — the impact mechanism, not a style opinion",
      "proposedDirection": "one- or two-line sketch; triage owns direction detail",
      "leafability": "single-leaf|needs-split|observation",
      "priorPackOverlap": { "kind": "open-leaf|plan-slice|landed|constraint", "ref": "corpus record id", "novelty": "what is materially new" },
      "confidence": "high|medium|low"
    }
  ],
  "droppedAsPriorPackDuplicate": [
    { "title": "…", "ref": "corpus record id", "reason": "one line" }
  ],
  "featureIdeas": ["one-liners from non-08 lanes; lane 08 promotes or drops them"],
  "bugsSideList": [
    { "title": "…", "paths": ["…"], "whySuspectedBug": "one line", "suggestedOwner": "code-review|security-review" }
  ],
  "coverage": {
    "readFully": ["globs/dirs"],
    "sampled": ["globs/dirs — with sampling rule"],
    "skipped": ["globs/dirs — with reason"],
    "pointers": ["one-liners for other lanes: test-shaped, docs-drift, cross-cutting things noticed out-of-lane"],
    "cut": ["findings dropped by the soft cap, named"]
  }
}
```

Contract rules:

- **Every key present; `null` where not applicable** — never omit keys.
  Every evidence entry carries all of `path`, `line`, `endLine`,
  `measurement`, and `note`, with `null` for the unused; exactly one of
  `line` and `measurement` is non-null (`endLine` only accompanies `line`).
- `severityHint`/`sizeHint` are hints. Fable's Phase-4 judge assigns the
  authoritative values; hints exist only to help ranking inside the lane.
- `priorPackOverlap` is `null`, or names a dedup-corpus record plus the
  novelty delta ("materially new" = new paths/counts or a different
  direction — not the same problem restated).
- Findings that merely restate live prior work are dropped by the lane —
  but every such drop is recorded in `droppedAsPriorPackDuplicate` so
  Fable can audit over-dropping. Drops are cheap records, not developed
  findings.
- Any command cited anywhere must actually exist — check `package.json` /
  `scripts/` first. Fabricated verify commands are a known delegate failure.
- `coverage` is mandatory and honest: skipped ≠ clean, and the structured
  arrays are what the completeness critic aggregates.

**Calibration.** Applies to scope the prior audit never read (see each
lane's Known context): coming back empty-handed there is suspect — say what
you read and look again with stricter eyes before accepting it. For
recently-worked areas (finished shared/client clusters), **"clean, with
evidence of what was read" is a valid result**; do not manufacture findings
to fill a quota. Zero medium+ hints across a lane triggers an orchestrator
spot-check, not automatic rejection. Do not suppress a finding because a
MODULE.md/ADR/guide blesses the current shape — flag the conflict; triage
weighs which side moves.

## Feature findings

Only lane 08 emits `category: "feature"` findings, and each one needs: the
observed workaround or forced friction (with evidence paths), who benefits
(DM / player / contributor / harness user), and why the current structure
makes it cheap. Other lanes contribute one-liners via `featureIdeas`.
Features are triaged on usefulness, not maintainability severity, and land
in their own section of the final index.

## Phase 4 — Fable triage workflow

Run as a dynamic Workflow (deterministic fan-out, Fable-family agents):

1. **Cluster (barrier, cheap):** normalize all banked findings; merge
   exact/near duplicates by path + problem; preserve every lane's evidence
   on the merged candidate. One candidate = one coherent piece of work
   (respect `leafability` hints).
2. **Verify (per candidate, refute-oriented):** two lenses on the
   *problem*, independent of the proposed remedy — *evidence-holds*
   (paths/lines/counts true at the pin, cited commands exist) and
   *already-ruled-out* (against the dedup corpus and live prior-pack state).
   A bad codex fix sketch must not kill a real problem. Low-severity-hint
   candidates are verified in batched passes, not one-by-one.
3. **Judge:** authoritative severity/size per the rubric below, plus a
   *worth-it* call (does the fix pay for its churn at this repo's bar) made
   once per candidate — kill here is a recorded rejection.
4. **Direction:** every survivor gets one Fable direction review (is the
   sketch the right shape?). Contested candidates, and any with
   severity ≥ medium *and* size ≥ L, get a judgment panel — N independent
   proposals, scored, synthesized. Rulings that reject or reshape a
   candidate go into this pack's `CONSTRAINTS.md`.
5. **Author:** one agent per leaf writes `NN-<slug>.md` in the 2026-07-25
   leaf format (`Problem` / `Evidence` / `Proposed direction` /
   `Scope / caveats`, pinned evidence). An existence-check pass greps every
   cited command and path; a reconciliation pass re-checks the live
   prior-pack state before the leaf is accepted.

Every kill — lane-level drop, verify refutation, judge rejection — leaves a
recorded reason. The triage reject pile lives in
`working/triage/rejected.json`; it is Phase 5 input, not trash.

**Severity rubric:** high = actively misleads contributors or taxes most
changes in its area; medium = real friction or risk on a common path, fix
pays for itself within the area; low = local polish.
**Size rubric:** S = one commit, couple of files; M = one coherent
multi-commit change; L = multi-part, plan section needed; XL = needs its own
`NN-PLAN.md` with slices.

## Phase 5 — Final review and stopping rules

Every leaf has been verified **in isolation** (r39 leafcheck: every
`path:line` opened, counts re-derived, prior pack reconciled). Nothing has
yet asked whether the 206 pack files hold together **as a pack**. That is
this phase's whole job.

Two questions, both scoped by owner decision on 2026-08-03:

1. **Are any two leaves the same leaf?** (highest value)
2. **Do the sequencing cross-references form a coherent order?**

**Cut deliberately — do not re-add.** Severity/size consistency across
leaves, and copyability-for-outside-readers. Also removed 2026-08-03: this
phase previously ended with a cross-model panel on the final pack. Dropped
— the pack is a docs-only proposal queue, not code merging to main, and
there is no Fable 5 access to seat a second model anyway.

### Design note (revised 2026-08-03)

The original shape was one consult reading the whole pack with internal
subagent fanout. That is broken: dedup is an inherently **global pairwise**
judgment, so a subagent holding leaves 001–020 structurally cannot tell
whether leaf 007 duplicates leaf 180. Fanout only helps if what fans out is
*reading* and the judging happens over a *reduced* artifact.

The funnel below was critiqued by a high-effort codex consult (session
`019fc8fe-c3c7-7052-9d1d-f1b0a3e21db8`, 2026-08-03) and revised against it.
Five changes were adopted as mandatory: include the PLAN companions, move
the reject audits ahead of the freeze, import triage provenance, replace
flat target lists with `targetOps`, and split hard precedence from
coordination relations.

Steps 1 and 2 were then critiqued separately (r41, session
`019fc966-106a-7040-8198-dc6f0d059904`, 2026-08-03), because they had been
left far thinner than S0–S3. That round corrected the pile arithmetic,
added the 1a source ledger and the 1c adjudication seat, folded the
proposed standalone coverage contract into 1a and the proposed standalone
existence-check step into 2b, and regrouped D by source document. Steps
3–9 were not reopened.

**The channel is already proven on two real defects**, both found while
designing it and neither catchable by any per-leaf check:

- `044:181` claims "No sequencing edges against other leaves in this pack"
  while `050:149` names 044 by link as editing the same optimistic writers.
- `056:94` claims "no other leaf in this pack touches the `character-create`
  wizard test files" while `042:168` prunes `wizard-context.test.tsx` — and
  those are the only two leaves citing that file.

Both are pre-seeded S2 input, not findings to rediscover.

### Order of operations

Reject audits run **first**. A promotion authored after the dedup and
sequencing passes would enter a population those passes already froze, and
the stopping rule permits a second reject round on ≥ 3 promotions. Running
them first costs only ordering; running them last costs a mandatory delta
S0/S1 plus a global re-comparison of every promotion against every existing
leaf.

| # | Step | Shape |
|---|---|---|
| 1a | Source-ledger extraction + lineage classification | local script, no agent |
| 1b | Reject-pile audit | 3 consults (B, C eligible cuts + structured kills by lane; D prior-pack drops by live source document) |
| 1c | Pooled adjudication | 1 consult over the whole promotion pool |
| 2a | Promotions authored / existing leaves augmented | as r38: 4 per consult, 4 live, delimited blocks |
| 2b | Acceptance gate | r39-equivalent, a *different* consult, chunks of ≤ 10 |
| 2c | Threshold decision; optional second reject round | re-enters at 1b |
| 3 | **S0** mechanical extraction + provenance join | local script, no agent |
| 4 | **S1** record enrichment | ~21 chunks of ≤ 10, 4 live |
| 5 | Candidate-pair channels | local script, no agent |
| 6 | **S2** global nomination | 1 consult over records + candidates |
| 7 | **S3** adjudication by connected component | 4 live |
| 8 | Fixes; regenerate edge graph, root catalog routing, and leaf catalogs | — |
| 9 | Re-review round | changed components + neighbors, plus global graph checks |

**The pre-promotion population is 206 files** — 203 leaves plus
`107-PLAN.md`, `108-PLAN.md`, `109-PLAN.md`. The PLAN companions carry
executable sequencing (`107-PLAN.md:37` forbids its S0 running concurrently
with four other leaves), so they get records too, modeled as slice graphs
linked to their parent leaf. r39 covered 206; so does this phase.

**The S0 freeze population is `206 + new leaf files + new PLAN companion
files`**, not `206 + promotions`. Three ways the two diverge: an adjudicated
`augment-existing-leaf` changes a file's content without adding to the
population; an XL promotion drags in a same-numbered `NNN-PLAN.md` companion
under the size rubric; and a second reject round adds more of both. S0 does
not run until 2c closes.

### Step 1a — source ledger (script, not an agent)

The reject pile is spread across 18 wave JSON files (16 with a non-empty
`coverage.cut` or `droppedAsPriorPackDuplicate` array) and the triage files,
and the triage side does not hold its own evidence: rejection files carry ids
and reasons, candidate files carry summaries and member finding ids (keyed
`members` in the banked files, not `memberFindingIds` as this doc first said),
and the evidence itself lives back in the originating wave finding. Three consults
each re-gathering that by hand is both triplicated and exactly the class of
work delegates fabricate — the same argument [S0](#step-3--s0-mechanical-extraction-script-not-an-agent)
makes for itself.

So a script emits `working/phase5/source-ledger.json`: **one row per source
occurrence**, carrying `sourceItemId`, source file, JSON pointer/index, lane,
source class, original title, rejection stage and reason, `memberFindingIds`
(resolved back into the wave records for evidence), `CQ25` ref where present,
and a **lineage status**:

`eligible` · `already-promoted` · `already-dismissed` ·
`superseded-by-later-round` · `duplicate-occurrence` · `meta-disposition` ·
`sampled` · `not-sampled`

Lineage classification is not bookkeeping — the raw pile contains records
that triage already resolved. Lane 06's 13 round-1 cuts were revisited in
wave-2 round 2: 12 became leaves `L06-111..122` and the 13th was dismissed
with reasons (r29). Auditing those 13 as unresolved would re-run completed
triage. Without this ledger, "248" is not a reproducible sampling frame, a
second round cannot tell fresh material from re-reads, and nothing can prove
every structured kill and every D claimant received a disposition.

The ledger also carries the **sampling budget and its reporting** — there is
no separate wave-style `coverage` object for this phase:

- classify **all** raw records mechanically;
- audit **all 28 structured kills** exhaustively;
- audit **all of D** exhaustively;
- for eligible cuts, sample `max(4, ceil(0.2 × eligible cuts))` per lane,
  redistributing unused capacity toward explicit soft-cap overflow and cuts
  with weak or absent rationale.

That is roughly 50–55 reconstructed cuts after lineage cleanup, not 248.
Every eligible cut must end the round marked `sampled` or `not-sampled`
with a rank, a selection reason, and a round number.

### Step 1b — reject-pile audit

**Three consults, not two** (revised 2026-08-03 after measuring the pile —
it is ~2× the size the plan previously described, and holds two task shapes
that must not be mixed). Counts corrected 2026-08-03 against the banked
files:

| bucket | count | shape | consult |
|---|---|---|---|
| `coverage.cut` | 248 | one-line titles, **no path, no evidence** | B, C |
| batch-1 rejections (2 verify-refuted + 7 judge) | 9 | structured, with reasons | B, C |
| batch-2 judge rejections | 14 | structured, with reasons | B, C |
| accepted batch-2 refutations | 5 | structured, in `batch2-directions.json` | B, C |
| `droppedAsPriorPackDuplicate` | 250 | `{title, ref: CQ25-nn, reason}` | **D** |

**526 raw records, not 528.** The earlier table read the r34 row as "9 + 2";
r34's nine batch-1 rejections *are* 2 verify-refuted plus 7 judge-rejected.
The five accepted refutations are also easy to miss — they are not in a
rejection file at all.

**B and C — cut and rejection audit, split by lane.** Not by finding-id
range: `coverage.cut` entries have no ids, and both buckets are
lane-scoped, so a lane split is the natural disjoint partition and keeps
each consult inside one subsystem. Balance by **item count**, not lane
count. A cut carries no evidence, so auditing one means going back to the
tree and reconstructing the finding: expensive per item, hence the 1a
sampling budget rather than a uniform sweep of all 248.

The B/C bucket is **248 cuts + 28 structured kills = 276 raw records**. An
earlier revision balanced the split on "lane 05 carries 71 items, lane 01
carries 59" — those figures are cuts *plus prior-pack drops* (lane 01 =
30 + 29; lane 05 = 50 + 21, both exact), and the drops belong to D. Raw
per-lane B/C weights:

| lane | 01 | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 |
|---|---|---|---|---|---|---|---|---|---|
| cuts | 30 | 23 | 27 | 12 | 57 | 30 | 29 | 19 | 21 |
| kills | 3 | 2 | 4 | 2 | 2 | 5 | 2 | 4 | 4 |
| raw | 33 | 25 | 31 | 14 | 59 | 35 | 31 | 23 | 25 |

A raw-exact split exists (02+03+05+08 = 138 against 138), but **do not
freeze it** — lane 06 alone sheds 13 already-resolved rows once 1a runs.
Partition on the *eligible* counts the ledger reports, not these.

**1a has now run (r42), so use these.** B and C audit the round-1 *sample* plus
every structured kill, not the raw pile — **77 items**, not 276:

| lane | 01 | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 |
|---|---|---|---|---|---|---|---|---|---|
| eligible cuts | 30 | 23 | 26 | 12 | 48 | 13 | 26 | 18 | 20 |
| sampled (r1) | 6 | 5 | 6 | 4 | 10 | 4 | 6 | 4 | 4 |
| kills | 3 | 2 | 4 | 2 | 2 | 5 | 2 | 4 | 4 |
| **B/C items** | 9 | 7 | 10 | 6 | 12 | 9 | 8 | 8 | 8 |

A balanced disjoint split is **B = lanes 01, 02, 03, 05 (38 items)** and
**C = lanes 04, 06, 07, 08, 09 (39 items)**.

**D — prior-pack drop re-check, exhaustive.** Each of the 250 drops says
"already covered by CQ25-nn". Every one carries a `ref`, so the task is
near-mechanical and quite unlike B/C: open the named prior-pack leaf
**in its live state** and ask whether it really covers the dropped title,
or only partially. Promote the residual where coverage is partial.

**Chunk D by resolved live source document, not by ref.** The 250 drops
carry 160 distinct refs, but refs are not the read unit: 28 of them resolve
into a single shared `CONSTRAINTS.md` section (1a measured 28; this doc first
said 26), and aggregate records like
`CQ25-115` point at a whole cluster plan rather than one named leaf.
Grouping by ref would reopen the same document repeatedly and split its
claimants across consults. Group by resolved document/section, keep all of
a document's claimants together, cap on both dimensions (≤ 20 refs and
≤ 30 claimants per chunk), and split a source document only when forced —
roughly **8–10 consults**, 4 live.

**Record a `priorPackReviewSha` before dispatching D.** Every chunk must
judge one reproducible snapshot of a pack that keeps moving. If the prior
pack advances before 2b accepts, reconcile only the *changed* prior-pack
documents against the affected promotion decisions rather than re-running D.

Why this bucket is in scope at all: these drops were made by wave-1 lanes
at launch against the frozen snapshot in `working/dedup-corpus.md`, and
have never been revisited against the live prior pack. r39 ran exactly this
reconciliation over the 203 *authored* leaves and found **14
partially-landed and 2 ruled-out** — 16 prior-pack coverage claims that
needed narrowing. Same failure mode, ~15× the population, previously zero
checking.

**All three:** hunt for under-triage — something dropped for a reason that
does not survive contact with the tree — and return promotions with
evidence, not opinions. Each must also receive the dedup corpus and the
prior pack's `CONSTRAINTS.md`: a promotion that re-proposes a recorded
refusal has to overturn the ruling explicitly, with reasons.

**Dedup is not theirs to rule on.** Give each consult the authored leaf
titles and have it flag "looks already covered by leaf NNN" as a **hint,
not a ruling** — the ruling belongs to 1c. Otherwise a leaf gets authored
purely to be merged later: D-122 was judge-rejected precisely as subsumed
by C-021, so promoting that class blindly recreates duplicates.

**Output: a `promotionCandidate` per promotion** — evidence and *hints*
only, never authoritative values. The hint-vs-authority split is the same
one the [finding contract](#finding-contract) enforces, and a promoter
grading its own promotion is the conflict the Phase-4 stage split existed to
avoid.

```json
{
  "promotionId": "P-001",
  "title": "one-line name",
  "area": "shared|server|client|harness|tests|e2e|docs|cross-cutting",
  "category": "organization|idiom|naming|duplication|layering|comment|hack|dead-code|test-shape|dx|feature",
  "severityHint": "low|medium|high",
  "sizeHint": "S|M|L|XL",
  "evidence": [{ "path": "…", "line": 123, "endLine": null, "measurement": null, "note": "…" }],
  "problem": "what is wrong and why it hurts — the impact mechanism",
  "proposedDirection": "one- or two-line sketch",
  "leafability": "single-leaf|needs-split|observation",
  "confidence": "high|medium|low",
  "origins": [
    { "source": "reject-audit", "consult": "B|C|D", "sourceItemId": "…",
      "lane": "lane-05-client", "originalTitle": "…", "rejectionReason": "…" }
  ],
  "priorPackOverlaps": [{ "kind": "…", "ref": "CQ25-nn", "residual": "what is left uncovered" }],
  "existingLeafHints": ["looks close to leaf 137 — hint only"],
  "overturnsRuling": null
}
```

Every key present, `null` where not applicable, same as contract v1.
`origins` and `priorPackOverlaps` are **plural**: the same residual can be
promoted independently by B, C and D, and 1c merges them into one candidate
carrying all three provenance rows. A promotion with null provenance falls
silently out of S0's seam weighting.

### Step 1c — pooled adjudication (one consult)

The independent authority seat, and the one structural addition of the
2026-08-03 revision. It reads the **whole pooled promotion set at once** —
B, C and D together, against the authored leaf titles — and per candidate
returns a `promotionDecision`:

- a ruling: `new-leaf` · `augment-existing-leaf` · `merge-with-promotion` ·
  `reject`;
- authoritative `severity` and `size` per the rubric;
- a **worth-it** call — does the fix pay for its churn at this repo's bar;
- the settled direction, and any prior-pack residual or ruling constraint
  the author must honor.

Two reasons this is a separate seat rather than a step-2 preamble. It is the
only place the promotion pool is globally visible, so cross-consult
duplicates die here instead of being authored and then merged by S2 — the
plan's "dedup is S2's job" rule is right about the *auditors* but would
otherwise buy avoidable authoring churn. And placing it inside authoring is
too late: a duplicate that reaches 2a has already been given a number and
prose.

Do **not** reproduce Phase 4's per-candidate panels. One global adjudication
over a reduced pool is proportionate for a docs-only proposal queue.

### Steps 2a–2c — authoring, acceptance, and the second-round decision

**2a — author.** Keep r38's proven shape: four assigned promotions per
consult, four live, consults return **delimited blocks**, and the
orchestrator writes the files after a mechanical shape check (heading,
`Status: Not started`, Theme/Source lines, all four sections). No consult
writes into the pack. An `augment-existing-leaf` ruling edits the named leaf
in place instead of creating one.

The author packet carries: assigned number and slug, `promotionId`, the
adjudicated title/theme/area/severity/size/confidence, verified evidence,
the final problem and direction, prior-pack residual and ruling constraints,
all origins and existing-leaf relations, required scope/caveat statements,
and both `AUDIT_TARGET_SHA` and `priorPackReviewSha`.

**Numbering: new leaves run monotonically from 204.** Never renumber
001–203. A second round appends after the first round's maximum. An XL
promotion takes a same-numbered `NNN-PLAN.md` companion, as 107–109 did.

**2a also emits `working/phase5/promotion-map.json`** — a mechanical
`promotionId → leaf file` manifest. Without it S0 cannot join promotion
provenance onto leaf headers, which all read a generic
`Source: codebase quality audit`; the promotions would then enter the freeze
with null provenance, which is exactly what the `origins` contract exists to
prevent.

**2b — acceptance gate.** The r39 pass, run by a **different** consult than
authored the leaf, over new and augmented files only, in chunks of ≤ 10:
open every `path:line`, re-derive every count, verify every cited command
exists, resolve intra-pack and prior-pack links, and repeat the prior-pack
delta check against `priorPackReviewSha`. It also checks the authored leaf
against its packet — authors drop constraints.

This is not optional politeness. The operational notes record fabricated
verify commands from delegate-authored leaves, and r39 over the 203
authored leaves found 138 defects across 91 files plus 16 prior-pack
coverage claims needing narrowing. Promotions come from the same class of
delegate, and everything downstream of the freeze treats extracted
`path:line` data as trustworthy.

**2c — threshold decision.** The stopping rule's "≥ 3 promotions" counts
**accepted under-triage findings after 1c adjudication**, not raw promoter
suggestions. A second round re-enters at 1b, where B/C draw from rows the
ledger marks `not-sampled` (never a re-read of the first sample) and D takes
a fresh second opinion only on source partitions that produced an accepted
promotion. Round-two output passes through 1c, 2a and 2b unchanged. S0 does
not freeze until 2c closes.

### Step 3 — S0, mechanical extraction (script, not an agent)

100% derivable, and exactly the class of thing delegate agents fabricate.
Per file: number, slug, title, the `Theme · Area · Severity · Size` header
fields, plan-companion parent link, every backticked `path[:line]` tagged
by originating section, and every intra-pack reference.

Joined in from `working/triage/batch{1,2}-*.json`:
`origin: {batch, lanes[], candidateId, memberFindingIds[], batch1Overlap}`
plus `triageExpectedRelations[]` distilled from `clusterNotes` — the
near-miss and dependency-edge pairs the cluster stage recorded and
authoring was expected to honor. Later steps compare expected relations
against authored ones; **do not trust a leaf to have preserved a relation
its author may have dropped.** Without this join, S2 cannot actually weight
the batch-1 × batch-2 seam (see Seam weighting).

**Extraction hazards, all confirmed in-tree:**

- Bare `leaf NN` prose is unsafe — `038:74` says "leaf 25" meaning the
  *prior* pack. Resolve markdown link targets against current-pack
  filenames; require exact three-digit basenames (so ADR `0002-…` never
  becomes leaf 002); treat unaccompanied bare prose as `ambiguous`.
- `## Proposed direction` paths are a **screening signal, not a coverage
  statistic**. 2 leaves cite no path there at all; 10 cite exactly one, and
  ~7 of those singletons name a test or a dependency rather than the
  production edit (`038`'s only direction path is its test command; the
  real edit is `dice-notation.ts`). Do **not** treat
  `targetOps ∌ S0 paths` as a trust failure — it would fire as noise on
  exactly these.
- Keep the **evidence**-path index as a lower-weight channel. Docs/code
  sibling pairs overlap write↔evidence, not write↔write; dropping it loses
  that whole class.

### Step 4 — S1, record enrichment

Each chunk reads only its own ≤ 10 files and reports only what those files
say — no cross-leaf rulings. Per record:

- `concreteEdit` — the proposed edit in ≤ 2 sentences.
- `problemFingerprint` — subject/domain object + failure mechanism +
  desired invariant. This is the channel for duplicates that share zero
  paths.
- `targetOps[]` — `{target, action, role, branch?}` where `action` is
  `create|modify|move|delete|consume|document` and `role` is
  `write|dependency|truth-source`. Replaces a flat target list, which
  cannot model alternatives: `097` proposes *either* editing docs *or*
  deleting commands plus three code files, and a flat list falsely claims
  both branches happen. `role` is also what makes "leaf X converges onto
  helper H while leaf Y deletes H" mechanically detectable.
- `relations[]` — see the vocabulary below, each carrying its source
  sentence and `confidence: explicit|inferred|ambiguous`. Never force
  ambiguous prose into a crisp edge.
- `independenceClaim` — the exact claim text and its strength, not a
  boolean. Variants are many ("no hard ordering", "either order"), and one
  leaf hedges to "No sequencing edges *recorded*".
- `withinChunkNearMisses[]` — pair ids + one-sentence reasons, explicitly
  **non-authoritative**. A reader holding ten full leaves noticing a
  near-duplicate is free signal; S2 remains the judge.

Merged output ≈ 25k tokens — one context, comfortably.

### Relation vocabulary

| relation | meaning | graph treatment |
|---|---|---|
| `requires` | must land after the target | topologically sorted; a cycle is a P0 defect |
| `prefersBefore` | preferred order, reverse still workable | report strongly-connected components, not "cycles" |
| `serialize` | either order, never concurrent | undirected; cycles are meaningless by construction |
| `coLand` | must land together | components must be schedulable as one unit |
| `alternativeTo` / `moots` | one makes the other unnecessary | conditional — flag for a scheduling decision |
| `rebaseOn` | no ordering constraint, but the later rewrites on top | advisory |

The earlier `{hard|soft} × {before|after|coordinate}` model was too lossy:
`024`/`026` is serialization with a preference, not a hard dependency;
`097`/`203` is a keep-versus-remove conditional where removal moots 203;
`061` says "no ordering dependency" yet still needs outcome-sensitive
coordination.

**Asymmetry is not automatically a defect** — hard dependencies are
naturally stated one way only. The real defect is a *contradicted
independence claim*: detect by comparing inbound relations and target
overlap against each claimed-independent leaf, not by demanding reciprocal
declarations for every edge.

### Step 5 — candidate channels (script)

Union of, each tagged by originating channel:

1. `targetOps` write × write overlap;
2. `targetOps` write × dependency/truth-source (the converge-vs-delete
   class);
3. evidence-path overlap (lower weight);
4. lexical top-k neighbors over title + theme + `problemFingerprint` +
   `concreteEdit` (k ≈ 5) — the zero-path duplicate channel;
5. explicit resolved intra-pack references;
6. `triageExpectedRelations` and `batch1Overlap` from provenance;
7. every contradicted independence claim.

Scale check on the raw path channel alone: 20,503 possible pairs → 1,204
sharing any cited path → 469 sharing a `Proposed direction` path → 60
sharing ≥ 2. High recall, low precision; precision comes from `targetOps`
and provenance, not from paths.

### Steps 6–7 — nomination and adjudication

S2 is one consult over every record plus the candidate lists, nominating
pairs and clusters with a hypothesis: `duplicate` / `subsumes` / `collides`
(same target, different intent, no declared relation) / `contradicts`
(directions pull opposite ways) / `distinct`.

S3 adjudicates **connected components of the nomination graph**, not pairs.
One consult per component of ~3–8 files reading them in full; unrelated
singleton pairs batch 3–5 to a consult; split only genuinely large hub
components, retaining a shared hub summary. Pairwise rulings would be both
expensive and logically inconsistent for A≈B≈C. Each result returns a
relation matrix plus one cluster-level remedy (merge / add relation /
narrow one leaf's scope / no action).

**Seam weighting.** Batch-1 triage found zero merges and batch-2 found two,
but both clustered *within* batch. The untested cross product is batch-1
(lanes 01–03, 51 survivors) × batch-2 (lanes 04–09 + wave-2, 152). Lane 08
is the cross-cutting lane whose charter explicitly spans other lanes'
areas, so lane-08 × lanes-01/02/03 is the sharpest seam. Provenance from
S0 is what lets S2 act on this rather than merely be told about it.

### Step 8 — the index is a Phase-5 deliverable

`00-index.md` is still the Phase-0 skeleton ("Leaves: None yet"). It is
generated from the **reviewed** edge ledger — leaf table plus scheduling
rules — and then included in the step-9 re-review. Otherwise this phase
approves a sequencing order before the document that presents it exists.

### Stopping rules

Wave 2 was capped at two rounds and stops early when a round yields no
novel medium+ survivor. The reject-pile audit runs once more only if the
first round yields ≥ 3 **accepted** promotions — counted **in aggregate
across B, C and D**, and counted *after* 1c adjudication rather than from
raw promoter suggestions, since 1c is where cross-consult duplicates and
not-worth-it items die. A second round re-runs only the consult(s) that
promoted, not all three, and draws only on unsampled ledger rows (see 2c).
A "clean" final round means no unresolved
evidence, dedup, or direction defect of P0/P1 gravity — P2 polish does not
force another round. Ask the owner before merging the branch.

## Working-state layout

```
working/
  dedup-corpus.md        # Phase 1 distillation of prior-pack remaining work
  ownership-closure.md   # Phase 1 matrix closure: every path assigned/excluded
  hotspots.md            # lane 00 output
  addenda/lane-NN.md     # per-lane hotspot weighting injected at dispatch
  wave-1/lane-NN.json    # validated, banked lane outputs
  wave-2/*.json
  triage/
    candidates.json      # post-cluster candidates
    rejected.json        # triage kills with reasons
  bugs-handoff.md        # accumulated bugsSideList entries
  leafcheck-results.json # r39 existence-check + prior-pack reconciliation
  phase5/
    build-source-ledger.mjs  # 1a: the generator (dependency-free ESM; `bun <path>`, `--round N`)
    README.md                # 1a: re-run instructions, lineage vocabulary, partitioning caveats
    source-ledger.json   # 1a: one row per reject-pile occurrence + lineage status + sampling record
    reject-audit-{b,c,d}.json  # 1b: promotionCandidates with evidence (d = prior-pack drops)
    adjudication.json    # 1c: promotionDecisions (ruling, severity, size, worth-it, direction)
    promotion-map.json   # 2a: promotionId -> leaf file
    promotion-check.json # 2b: acceptance-gate results over new/augmented leaves
    leaf-index.json      # S0 + S1 merged, one record per pack file (206 + promotions)
    candidates.json      # step 5: nominated pairs, tagged by channel
    nominations.json     # S2 output
    adjudications.json   # S3 component rulings + remedies
    edge-graph.json      # relations after fixes; input to 00-index.md
```

Committed on the branch while the audit runs so a dead session loses
nothing; keep any single banked file under ~200 KB (summarize overflow).
Pruned in the finalization commit — except `bugs-handoff.md`, which is
promoted to the pack as `BUGS-HANDOFF.md`, and `dedup-corpus.md`, which is
promoted as `DEDUP-CORPUS.md` so the corpus record ids cited in
`priorPackOverlap` and the drop trail never dangle.

## State ledger

Update before ending any session; this table *is* the resumption anchor.

### Pins

| key | value |
|---|---|
| AUDIT_TARGET_SHA | `ebf096580b31f604861fadb3d4cbd4079da4f017` (recorded 2026-08-01) |
| PRIOR_AUDIT_SHA | `883d48bf` |
| priorPackReviewSha | `948169235fef7798de67bd44b90ac4894e9cc55f` (recorded 2026-08-03, before the step-1b D dispatches) |

**`priorPackReviewSha`** pins the *live* state of the 2026-07-25 pack that
every step-1b D chunk judges against, and that 2b re-checks. It is the last
commit touching `docs/agent_notes/backlog/code-quality-2026-07-25/`
(`docs(backlog): reconcile harness leaf statuses`, 2026-08-01), not this
branch's HEAD: the audit branch only accretes 2026-08-01 pack docs, so the
prior-pack tree is byte-identical at `948169235`, at `main` (`8ab48f723`) and
at this branch's HEAD. Verify with
`git log -1 --format=%H -- docs/agent_notes/backlog/code-quality-2026-07-25/`;
if that SHA has moved when 2b runs, reconcile only the *changed* prior-pack
documents against the affected promotion decisions rather than re-running D.
Distinct from `PRIOR_AUDIT_SHA`, which is the prior pack's own *evidence*
pin and is never a citation or read target here.

### Phases

- [x] Phase 0 — plan + prompts committed; panel round folded in (2026-08-01)
- [x] Phase 1 — pins, dedup corpus, hotspot map, addenda, matrix closure (2026-08-01)
- [x] Phase 2 — wave 1 (all nine lanes banked 2026-08-02; 180 findings, 107 side-listed bugs, `working/bugs-handoff.md` seeded)
- [x] Phase 3 — wave 2 + completeness critic (closed 2026-08-02: two top-up rounds + critic FAIL dispositioned via authorized micro round r32–r33; 233 findings, 118 side-listed bugs)
- [x] Phase 4 — triage (r34–r37); 203 leaves + 3 PLAN companions authored (r38); existence-check + prior-pack reconciliation (r39) — COMPLETE 2026-08-02
- [x] Phase 5 — final review and finalization **COMPLETE 2026-08-04; ROUND 6 CLOSED**. Design revised 2026-08-03 against two codex critiques (r40, r41); see [Phase 5](#phase-5--final-review-and-stopping-rules). **Steps 1a–2c initially closed** (r42–r78) after five rounds and 91 accepted authoring outcomes. **Steps 3–8 then completed** (r79–r86): S0 mechanical extraction, S1 enrichment of 270 leaves, 2,648 candidate pairs across eight channels, S2's 61 nominations, S3's adjudication of 24 components (which **overturned 59% of those nominations**), the two merges and 32 S3 relation edges, and the original 250-edge graph. **Step 9 closed on a clean round** (r87–r91), and finalization promoted the bugs handoff and dedup corpus, wrote the reader-facing constraints and summary, and pruned superseded intermediates. The owner then requested substantive reading of the 15 remaining eligible cuts: round 6 read all 15, promoted 9 and dismissed 6 at 1b, then produced 1 new leaf, 4 augmentations, and 4 rejections at pooled adjudication, with all 9 candidates evidence-verified (r99–r100). Acceptance found two P0 citation defects and both were repaired; S1 enriched 5 records and added the `271 → 117 rebaseOn` relation; regeneration produced **269 live leaves and 251 edges**; S3 ruled the sole `271 ↔ 141` collision candidate no-edge; and the step-9 re-review was substantively clean. The finite eligible pool is exhausted at **216 of 216 read**. Deliberate numbering holes at 096 and 161 remain. Per-run detail is in [RUN-LEDGER.md](RUN-LEDGER.md#runs).

### Runs

The append-only run ledger moved to [RUN-LEDGER.md](RUN-LEDGER.md#runs). Read it when you need to know what a specific run did or why a decision was taken; you do not need it to continue the work.

### Step 1b results (closed 2026-08-03)

These closed-round results moved to [RUN-LEDGER.md](RUN-LEDGER.md#step-1b-results-closed-2026-08-03). Read them when you need to know what a specific run did or why a decision was taken; you do not need them to continue the work.

### Steps 1c–2b results (closed 2026-08-03)

These closed-round results moved to [RUN-LEDGER.md](RUN-LEDGER.md#steps-1c2b-results-closed-2026-08-03). Read them when you need to know what a specific run did or why a decision was taken; you do not need them to continue the work.

### Triage cursor

The closed triage cursor moved to [RUN-LEDGER.md](RUN-LEDGER.md#triage-cursor). Read it when you need to know what a specific run did or why a decision was taken; you do not need it to continue the work.

### Last checkpoint

**Current state (2026-08-04).** Analytical work, finalization, and the
owner-requested round 6 are complete. The round read all 15 remaining eligible
cuts, closed its acceptance and relation review, and received a substantively
clean step-9 re-review. The pack has **269 leaves** and **251 relation edges**,
with deliberate numbering holes at **096** and **161** after the two original
S3 merges. **Never renumber the leaves**: doing so would invalidate every
citation, ledger row, and cross-reference in the pack.

**Only remaining action: owner approval before merge.** Nothing analytical or editorial remains, and the branch must not be merged without that approval.

**Round-6 eligible-cut closure.** The 15 rows formerly recorded as unsampled
were all reconstructed and read: lane 01 promoted 5 of 7, lane 05 promoted 0
of 4, and lane 07 promoted 4 of 4. Together with the 201 cuts read through
round 5, this exhausts the finite eligible pool at **216 of 216 read**. The
authoritative row names and rulings are retained in
[CONSTRAINTS.md](CONSTRAINTS.md#round-6-rulings-for-the-15-eligible-cuts); the
two reading seats and pooled disposition are narrated in run rows
[r99–r100](RUN-LEDGER.md#runs) and banked under `working/phase5/1b-r6/`.

#### S0 provenance note — the Phase-4 candidate join is unrecoverable

The Phase-4 per-leaf author packets were never committed, so nothing maps candidates to leaves 001–203. Title similarity and evidence-path overlap both failed the pack’s reconstruction bar; S0 correctly leaves `origin` null rather than using a biased 17% partial join. The second join gap is that `clusterNotes` is prose and cannot mechanically produce `triageExpectedRelations[]`.

**Consequences, to apply and not re-derive:**

1. S2 could not apply the batch-1 × batch-2 seam prior to leaves 001–203. It retained shared paths, the lower-weight evidence-path index, and `problemFingerprint`, but recall is slightly lower for zero-path cross-batch near-duplicates. `AUDIT-SUMMARY.md` discloses the limit; leaves 204–270 retain exact promotion-map provenance, and leaf 271 retains exact round-6 provenance.
2. Distilling the two `clusterNotes` strings into `triageExpectedRelations[]` would require a small judgment consult. The pack proceeded without that input rather than fabricating it mechanically.
3. Harness lesson: authoring input packets are provenance. Future packs must commit them or emit a `packet → output` map; this join alone is unrecoverable because its intermediate artifact was treated as disposable.

**Open owner-facing questions — preserve; do not settle locally.**

- **Round limit.** The owner asked for these 15 rows to be read, and that
  one-off request exhausted this pack's finite eligible pool. It does **not**
  settle whether future application means running every finite pool to
  exhaustion or stopping at a fixed round count and recording the remainder as
  knowingly unsampled. That policy choice, including when S0 may freeze,
  remains open.
- **Stopping-rule design, rather than this pack.** A fixed threshold of three
  accepted promotions carried no information against a large draw. A future
  plan template should instead settle on an acceptance rate or a fewer-than-N
  yield threshold. Exhausting this pack's pool by owner request is **not** a
  general ruling on that design; the question remains open.

## Operational notes (hard-won; keep with the plan)

- Tell codex lanes to fan out with **internal subagents**; a single context
  over a whole package rots and returns shallow findings.
- **Fresh `-o` and log paths per run/retry.** Codex capacity crashes are
  recoverable by re-dispatch; reusing an output path is how results get
  silently lost.
- Never run parallel mutating lanes. Concurrency history for fan-out
  consults: nine parallel lanes OOM'd the container (r02–r10), two
  concurrent lanes OOM'd it again (r13–r14), and the wave went serial
  until the owner found and fixed the high-memory root cause outside the
  lanes (2026-08-02), after which the remaining six lanes were dispatched
  in parallel on the owner's direction. If OOM symptoms reappear, drop
  back to serial dispatch and check container memory before blaming lane
  count.
- drift-ai packet outputs are gitignored — copy anything worth keeping
  outside the repo and reference by absolute path.
- Optional drift-ai engines are provisioned **per-checkout** under
  gitignored `.tools/` (verified 2026-08-01): semgrep 1.165.0 at
  `.tools/semgrep/.venv` (auto-resolves, no flag) with GitLab SAST
  community rules pinned at `d580dedc` and license consent declared in
  `.tools/semgrep/gitlab-rules.json`; Dolos 2.9.3 at
  `.tools/dolos/node_modules/.bin/dolos` (not on PATH — pass
  `--dolos-bin`). A detached worktree does not inherit `.tools/`; lane 00
  must run in this checkout or re-provision.
- The commit-msg hook enforces `<type>(<scope>): <subject>` with subject
  ≥ 20 chars and body ≥ 40 chars; run `bun run backlog:lint` before
  committing pack docs.
- Delegate-authored leaves have fabricated verify commands before — the
  Phase 4 existence-check pass is mandatory, not optional.
- Keep the backlog `README.md` entry for this pack in step with its status.
