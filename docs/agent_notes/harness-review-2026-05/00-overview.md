# Harness Review — May 2026

Status: Completed review artifact (not in_progress work)
Date: 2026-05-30
Branch: feature/harness-review
Method: multi-agent research + audit + adversarial triage (23 agents)

This is a top-to-bottom review of Musi's AI coding harness against the current
external literature on harness engineering, plus a brainstorm of improvements.
It is written to be **mostly project-agnostic** — the generic principles in
`05-generic-harness-principles.md` are the part intended for sharing with other
teams; the rest grounds them in Musi's actual state.

## How to read this set

| File | Contents |
|---|---|
| `00-overview.md` | This file: method, headline findings, the consolidated recommendation table, sequencing. |
| `01-current-state-and-audit.md` | What the harness is today, by dimension: strengths, gaps (with severity + evidence), and the meta-gaps the harness doesn't see about itself. |
| `02-research-findings.md` | Distilled findings from each external source, foregrounding the two Böckeler/Fowler articles. Key quotes preserved. |
| `03-recommendations.md` | The endorsed improvements, consolidated and de-duplicated, in tiers, each with rationale / sources / current state / effort / risk / how-to-apply. |
| `04-rejected-and-deferred.md` | Everything considered and **not** recommended, with the reason. This is deliberately long — the rejections are as much the point as the recommendations. |
| `05-generic-harness-principles.md` | The shareable, project-agnostic distillation: the principles that are good for any agentic codebase, with the traps. |

## Method

A workflow spawned 23 sub-agents across four phases:

1. **Research** — one agent per source: the two Böckeler articles on
   martinfowler.com (*Harness Engineering for Coding Agent Users* and
   *Maintainability sensors for coding agents*), the OpenAI Codex field report,
   Anthropic's *Harness design for long-running application development*, the
   Sakasegawa/nyosegawa.com *Best Practices (March 2026)* post, the
   `walkinglabs/awesome-harness-engineering`
   list (plus two of its links), the acairns *Deep Modules and AI-Ready Codebases*
   note, `mattpocock/skills`, and the local *Spec-Driven Development* podcast
   transcript. 8/9 fetched cleanly during the original run; OpenAI's page 403'd
   then and was reconstructed from corroborating secondaries. A 2026-05-31
   follow-up check fetched the official page directly and did not change the
   recommendations.
2. **Audit** — five agents read the real repo across structure/deep-modules,
   feedforward/guides, sensors, verify/gates/loop, and tooling/maintainability;
   a sixth catalogued prior art (the existing `ai-harness-*` backlog, finished
   work, LOG/DECISIONS) so nothing already-done or already-planned was re-proposed.
3. **Synthesis** — five theme agents brainstormed candidate improvements from the
   combined corpus (29 candidates + 47 explicitly-rejected candidates).
4. **Evaluation** — three adversarial critics (prior-art/redundancy,
   generic-soundness/evidence, cost/maintenance/noise) triaged every candidate
   into endorse / demote / reject / already-covered, collapsed duplicates, and
   surfaced topics no candidate covered.

## Headline findings

1. **Musi's harness is a near-textbook implementation of the source literature —
   often ahead of it.** `docs/ai-harness.md` uses Böckeler's exact vocabulary
   (guides=feedforward, sensors=feedback, computational vs inferential, the three
   regulation categories), and Musi has built out the *computational* tier more
   thoroughly than the primary article itself demonstrates. OpenAI's "taste
   invariants as hard failures," Sakasegawa's "pointer-style AGENTS.md," the
   "MCP tax" decision to prefer a Playwright CLI over MCP, and the promotion
   rule (guide + sensor + repair) are all already present, frequently in a more
   disciplined form than the sources prescribe.

2. **The highest-leverage gaps are exactly the three Musi already self-declares,
   and the literature points straight at all three:**
   - *Diagnostics/signal are not yet combinable.* The plumbing exists (a Zod
     `harness-diagnostics` envelope emitted by ~6 tools) but **nothing consumes
     multiple envelopes** — and `drift:ai` and `logs:audit` speak their own
     dialects. The fix is a fusion consumer (`harness:audit`), which the backlog
     itself gates remaining JSON work on.
   - *Slow drift sensors are built but never collected.* `drift:ai` (default +
     opt-in + hotspots), `knip`, mutation, and timing/flake data all exist; there
     is **no scheduled lane** running them (CI is PR/push-only, no cron). Every
     source prescribes a continuous-monitoring lane separate from per-change checks.
   - *Behavior confidence is the weakest axis.* This is acknowledged as unsolved
     industry-wide (Böckeler's "elephant in the room"); the tractable, cheap wins
     are activating the strong sensor that already exists (`logs:audit`) and a
     ranked mutation-survivor signal — not a heavyweight evaluator agent yet.

3. **The structural/deep-modules angle (acairns, Pocock) revealed a concrete live
   bug the harness can't see:** `character-live-state/MODULE.md` documents an
   `index.ts` facade that was deleted to satisfy `no-barrel`; five routers now
   reach into 6+ internal files. Nothing detects a doc pointing at a deleted file
   — even though `harness-freshness.ts` already does exactly that path-existence
   check for `ai-harness.md`. Generalising that one check to the 35 `MODULE.md`
   files is the single cheapest, highest-precision win in the review.

4. **A genuine generic-vs-Musi tension worth naming explicitly:** the audit rates
   Musi's **local-only enforcement** of commit-shape / hook-bypass / dangerous-git
   a *high-severity* risk for most teams (a non-Claude/Codex client or a
   hooks-less contributor bypasses every guard; CI has no policy step). For Musi
   this is a *deliberate, documented* trade (`AGENTS.md`: "Commit-shape
   enforcement is local by design"). We do **not** recommend changing it, but we
   surface it as an accepted risk to revisit — and as a principle most *other*
   teams should invert. See `04` and `05`.

5. **The review itself adds feedforward, so it must police its own context cost.**
   Several recommendations add things an agent reads (a golden-path pointer,
   path advisories, "Use when" lines, a session-start injection). Each is cheap
   alone; together they can re-introduce the bloat the `AGENTS.md` cap exists to
   prevent. We add a meta-recommendation to sum the per-session context before
   shipping the additive set.

## Consolidated recommendations

The 29 raw candidates collapsed to **18 distinct leaves + 2 meta-recommendations**
(the critics found 5 ideas had been written up as 11 line-items). Full detail in
`03-recommendations.md`; rejected/deferred items in `04`.

### Tier 1 — quick wins (small, endorsed by all three critics)

| # | Leaf | Effort |
|---|---|---|
| R1 | **Module-doc accuracy sensor** — generalise `harness-freshness.ts`'s backtick path-existence check to all 35 `MODULE.md` (and area docs, and doc paths embedded in hook scripts). Path-existence first; gate symbol-existence behind report-only. | S |
| R2 | **Fix `character-live-state/MODULE.md`** facade fiction and document the named-facade convention (logic-bearing `<name>.ts`, not a re-export `index.ts`) in `services/README.md`. Doc-only half. | S |
| R3 | **Golden-path reference-feature pointer** in `AGENTS.md` — one line naming the cleanest existing end-to-end tRPC slice to copy. | S |
| R4 | **One hook edit plus `MODULE.md` breadcrumbs:** guide-pointer advisories for `routers/`/`socket/`/`rules/`/`e2e/`; tamper-guard advisory on the ratchet baseline / eslint config / suppression registers; `See: docs/guides/X.md` breadcrumbs for non-hook clients. | S |
| R5 | **Fix `scripts/doc-length-policy.sh`** arms that reference `STATUS.md`/`NEXT.md`/`DECISIONS_ARCHIVE.md` (none exist). | S |
| R6 | **Stop-hook escalation tier** — one louder final notice + a machine-readable `abandoned-red.json` flag after the notify cap (not a hard block). | S |
| R7 | **De-stale `ai-harness.md`** — correct the "Current Gaps" prose that calls JSON output "future" (6 tools already emit the envelope) and keep any narrated local-rule count generated from the manifest. | S |
| R8 | **"Use when" trigger grammar** on the two skill descriptions (sentence 1 = capability, sentence 2 = "Use when [triggers]"); defer per-guide front-matter until `docs:intel`. | S |

### Tier 2 — feedback-loop closure (moderate, endorsed)

| # | Leaf | Effort |
|---|---|---|
| R9 | **`harness:audit` fusion consumer** — project `drift:ai`/`logs:audit` into the existing diagnostics envelope and emit one merged report with a `byControl` tally. The keystone that unblocks the JSON gate; build before R10. | M |
| R10 | **Scheduled slow-drift lane** — one weekly, report-only cron workflow that runs the already-built slow sensors through R9. Never fails the default branch; never auto-opens PRs. Folds in duration-trend + scoped `rules/` mutation. | M |
| R11 | **SessionStart/PreCompact rehydration hook** + a tiny **JSON status block** in `in_progress/<task>.md` (built together): re-seed pending red-verify state and the active handoff after a fresh start or compaction. | M |
| R12 | **Intra-package layer-direction sensor** (reverse-direction bans only: `utils`↛`services`, `services`↛`routers`) + the deferred **facade-leak check** — fold both into the planned graph-drift suite (backlog 10), report-only. | M |
| R13 | **Structured self-correction message audit** — close the terse-exemption holes where a real codemod exists (`no-barrel`→`expand-barrel`, `trpc-require-output-schema`→`trpc-shared-output`); single-source remediation from `meta.docs` (long-form in the generated doc, terse why+command in the runtime message). | M |
| R14 | **Spec/plan discipline (thin)** — extend the existing `in_progress` template with Scope / Acceptance / Cross-package-contract sections and a code-aware discovery step (`code:intel dependents`/`refs` before coding). Tiered by change shape; never a gate. | M |

### Tier 3 — refinements & cautious adds

| # | Leaf | Effort |
|---|---|---|
| R15 | **First-run green backpressure** on `bun-run-quiet.sh` (swallow-and-checkmark on success) — *but build the must-act carve-out first* so warn-level/ratchet-partial signal is never hidden. | M |
| R16 | **`logs:audit:latest`** graceful-degradation (no-op-with-hint) surfaced from `doctor`; defer the Stop-hook runtime-log inspection until dev-session log capture (backlog 14) lands. | M (partly blocked) |
| R17 | **Demotion-rule paragraph** in `ai-harness.md` (the counterpart to the Promotion Rule); defer the periodic load-bearing audit to backlog 4/16; **drop** the scripts size-ceiling sensor. | S |
| R18 | *(Optional)* **Lazy ubiquitous-language section** inside `CONTEXT.md` with `_Avoid_` lists — only on observed naming collision; no lint enforcement. | S |

### Meta-recommendations (governance)

| # | Leaf |
|---|---|
| M1 | **Add a retirement tripwire to the Promotion Rule:** every report-only sensor ships with a written noise budget / kill-criterion (when its false-positive rate means it gets pulled or stays report-only forever), not just a path to becoming a gate. |
| M2 | **Sum the per-session context** added by R3+R4+R8+R11+R18 before shipping them, and keep the additive feedforward within the `AGENTS.md`-cap discipline. Optimise the set, not each item in isolation. |

## Suggested sequencing

- **Do Tier 1 first** — all are small, independent, and several fix real live bugs
  (R1 detects the R2 drift; R5/R7 are stale-harness cleanups). R4 is one small
  hook-and-breadcrumb change set.
- **R9 before R10** (the cron needs the aggregator) and **R6's flag feeds R11**
  (the abandoned-red flag is a natural SessionStart input).
- **R11's two halves ship together** (the hook needs the JSON block to parse).
- **R12 folds into the existing planned graph-drift backlog item**, not a new
  standalone effort — sequence it as one architecture-direction sensor.
- Tier 3 is opportunistic; **R18 is optional** and was demoted twice.

## Important caveats on this review

- During the original review run, the OpenAI source could not be fetched directly
  (403), so its claims were triangulated from secondaries and flagged. A
  2026-05-31 follow-up check fetched the official page directly; keep the specific
  stats approximate unless re-quoted from that page.
- The two Fowler-hosted articles are by **Birgitta Böckeler** (Thoughtworks);
  Fowler is the publisher. The newer one's real title is *"Maintainability
  sensors for coding agents"* and is **scoped to maintainability/internal
  quality** — it is not a general behavior-sensor manual.
- Every recommendation here is sized against a harness that is *already mature*.
  None is greenfield. The biggest value of the review is the **rejections** (`04`)
  and the **generic distillation** (`05`), not a long to-do list.
