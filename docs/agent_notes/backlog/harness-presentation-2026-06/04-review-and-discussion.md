# Review & Discussion Record

**Project:** Harness / context / agentic engineering presentation (Musi repo as case study)
**Audience for the talk:** mixed — engineers AND engineering leadership (current deck: 23 slides, ~30 min)
**Date:** 2026-06-13
**Status:** review complete; original 20-slide spine reconciled; superseded by the current 23-slide deck in `02-slides.md`

> **Current-deck note (2026-06-15 follow-up):** This file is a historical review record. The authoritative presentation is `02-slides.md`; `05-research-update-recommendations.md` records the later security-slide/evidence refresh and the before-presenting checklist. Where this file preserves older counts or slide numbers, the current deck wins.

---

## 1. Why this document exists

Before the presentation findings were finalized, the five theme drafts — Framing & Stakes, Linting, Tests, AI = Onboarding, and System & Payoff — plus the supporting research corpus were put through **four independent adversarial reviews**, each examining the material through a different lens, followed by a **moderator reconciliation** that adjudicated the critiques into a single, buildable 20-slide spine. A later research update added the security slide and refreshed external evidence, producing the current 23-slide deck.

This record documents that the findings were genuinely stress-tested rather than asserted. It exists so that a reader of the final deck can trust that:

1. every concrete claim about the Musi repo was checked against the actual files,
2. every external claim was checked against its cited source and tiered by evidence quality,
3. the talk fits its time and slide budget for the stated mixed audience, and
4. the "what we'd build next" content does not pass off already-shipped work — or slide props — as novel gaps.

The central thesis the deck argues is unchanged by the review and survived it intact:

1. **Optimizing a codebase for AI agents is, in practice, the same work as onboarding a new human developer** — make it readable, well-organized, maintainable, and free of friction and surprises.
2. **Running AI without a good harness** (no lints, no tests, no guardrails) **builds tech debt and entropy fast**, until the codebase becomes unmaintainable even for the AI — a doom loop that forces more manual debugging and produces worse results.
3. **The remedy is harness engineering**: feedforward (guides) + feedback (sensors), with linting as the cheapest highest-leverage guardrail and a robust, high-coverage test suite as the behavior-confidence backbone.

What the review changed was *credibility hygiene* — purging grep-able numeric errors, re-tiering overstated external evidence, cutting ~50% of the slides for redundancy, and disciplining the shipped-vs-planned framing — not the argument.

---

## 2. The review process

| Stage | Who | What they did |
| --- | --- | --- |
| Lens 1 | **Repo-accuracy critic** | Verified every concrete claim about the Musi repo (file paths, rule names, message text, counts, mechanisms) against the actual files at `/workspace/.claude/worktrees/abstract-leaping-liskov`. |
| Lens 2 | **Generic-soundness / evidence critic** | Checked every non-Musi claim against the cited web sources; flagged overstated sources, anecdote-as-data, false consensus, and weak citations — with special attention to the doom-loop and productivity numbers. |
| Lens 3 | **Narrative / pedagogy / audience-fit critic** | Asked whether the material works as a ~20-slide / ~30-min talk for a mixed engineering + leadership room: arc, redundancy, altitude, jargon, slide budget. |
| Lens 4 | **Novelty critic** | Cross-checked every "improvement idea" in the corpus and drafts against what is already done or planned in `docs/agent_notes/harness-review-2026-05/`, the backlog folders, and finished work — to ensure the deck never presents shipped work or slide props as novel gaps. |
| Reconciliation | **Moderator** | Adjudicated the four critiques, independently re-verified the highest-stakes facts (rule count, retry count, deep-module numbers, the live stale-doc bug), and produced the original 20-slide spine with all corrections baked in. |

The four lenses were chosen to be deliberately non-overlapping: one trusts nothing about the repo, one trusts nothing about the outside world, one ignores truth entirely and only asks "will a mixed room follow this in 30 minutes," and one polices the line between "shipped" and "aspirational." Convergence across all four — which is what happened on the major findings — is a stronger signal than any single reviewer's verdict.

---

## 3. What each lens found

### Lens 1 — Repo accuracy

**Strongest verdict: the deck is fact-check-proof on stage except for a small set of numeric drifts.** The overwhelming majority of concrete repo claims check out against source, often verbatim. The critic confirmed the load-bearing, demo-able facts are all true:

- `CLAUDE.md` is exactly **1 line** (`@AGENTS.md`); `AGENTS.md` is **41 lines**, under a real, hook-enforced **250-line** budget (`scripts/doc-length-policy.sh`) with the verbatim rationale "AGENTS.md is loaded into every agent session's context."
- The **18 custom local ESLint rules** split exactly **7 maintainability / 6 architecture-fitness / 5 behavior**.
- `no-llm-artifacts` and `concurrency-guard` exist with their slide-quoted messages verbatim; the `message-guidance` meta-test (Why/How shape, action-verb allowlist omitting Delete/Shrink/Suppress) is real.
- The lint ratchet is genuinely symmetric, and the **12-entry debt log is 100% retirements** (every entry has an empty `regressions: []` and a populated `orphansRemoved`).
- The **8-step verify matrix** is byte-identical across all four consumers (verify / changed / parallel / pre-commit).
- **108 harness controls**; the **weekly slow-drift cron** (`23 9 * * 1`); the **Stryker baseline** (70.25% score, 628 killed / 258 survived over 1,438 mutants, 16 of 66 shared files, `thresholds.break: null`); vitest floors (shared 99/89, server 93/86, client 82/75); and **0 `.only` / 0 `.skip` / 0 `fdescribe`** across the suite.
- Critically, the flagship cautionary tale is **real and still un-fixed** as of the 2026-06-15 update: `character-live-state/MODULE.md:75` asserts "`index.ts` is the public facade only," no `index.ts` exists, and the catching sensor (`module-doc-paths-check-config.ts:21`) is `runByDefault: false`. *(Re-verify before presenting; if fixed, reframe as "found and fixed by our own sensor.")*

The errors it flagged were all surface-number hygiene, not thesis-breaking: the retry count, the `combat-actions` deep-module figures, the coverage-map status sub-counts, the framing of the `eslint-disable` count, and unstable per-package test-call splits. (See the Corrected-claims table in §5.)

### Lens 2 — Generic soundness & evidence

**Strongest verdict: the doom-loop case is genuinely backed by converging mixed-tier evidence, but a handful of punchy numbers are over-weighted relative to their sourcing.** The critic praised the evidentiary structure — peer-reviewed studies (CMU MSR'26 on +30% warnings / +41% complexity; IEEE-ISTAS 2025 RCT on +37.6% critical vulns over five unreviewed iterations) carry the rigorous load, with vendor trend data (GitClear, Veracode) as supplement — and noted the drafts already pre-flag most of their own weak spots in speaker notes.

Its sharpest single finding: the **Morph "harness +22 vs model +1 SWE-bench" stat** is the most load-bearing *generic* number in the whole talk, yet it is sourced only *through the repo's own review doc* with no recoverable primary — the highest prominence-to-evidence mismatch in the deck. It also flagged that several illustrative anecdotes (100%-coverage/4%-mutation, ~10x-cheaper eval, the two-week trash horizon) are correctly hedged in notes but appear in slide *bullets* at the same visual weight as peer-reviewed data, and that "consensus / the field has converged" language overstates a ~12-month-old, still-contested discipline whose strongest "everyone agrees" claims come from SEO/vendor sites. Its constructive recommendation — adopted — was one consolidated "proven vs. directional" slide plus on-slide one-word evidence tags, because **leadership reads bullets, not speaker notes**.

### Lens 3 — Narrative, pedagogy & audience fit

**Strongest verdict: the content is excellent and the spine is sound, but the deck is ~50% over budget and loops.** Summing the drafts gave **23 content slides** (5/5/5/4/4) before title, agenda, evidence, and Q&A — realistically a 45–50 minute talk, not 30. The good news the critic stressed: the cuts are almost entirely *redundancy*, not substance. Three big ideas — *Agent = Model + Harness*, the Pocock "new hire with no memory" quote, and the doom-loop stats — are each stated as full beats two to three times across themes; the fix is "establish once, callback thereafter."

It argued (and the moderator adopted) a **cold open on the doom loop** — stakes before vocabulary — rather than opening on a definitions/taxonomy slide that spends peak attention on jargon. It identified the exact merges (doom-loop anecdote + data; the lint rules tour; payoff + where-to-start) and named the **live stale-doc bug as the single strongest slide** that must be protected from cuts. It also flagged altitude problems (the Zod-envelope/cron-syntax fusion slide, the `no-async-array-callbacks` deep dive) and undefined jargon on leader-facing slides ("backpressure," "drift," "tactical tornadoes," "build-without-collect").

### Lens 4 — Improvement-suggestion novelty

**Strongest verdict: almost none of the ~25 corpus "improvement ideas" are novel — and the team already knew it.** The critic verified that the presentation team had itself produced a rigorous novelty reconciliation (`03-improvement-suggestions.md`) mapping each idea to its backlog/review status. It independently confirmed the key shipped/absent facts and concluded the genuinely-new, worth-proposing set is just three items: (a) the **M2 aggregate context-budget reporter**, (b) **scoped Stryker mutation + a survivor summarizer folded into the existing weekly lane**, and (c) **R11 SessionStart/PreCompact rehydration**.

Its most important credibility guardrail: **`harness:audit`, the weekly slow-drift lane, and the `module-doc-paths` + `layer-direction` sensors are all SHIPPED** (verified: `harness:audit` in `package.json`; `slow-drift.yml` cron `23 9 * * 1`; sensors registered; the drift-ai pack Done). Several corpus angles framed these as aspirational; presenting them as future work would contradict the deck's own evidence and understate the harness. It also warned against featuring `lint:ratchet:trend` or a "harness-scorecard" as gaps — both are confirmed-*absent* but are slide props, not deficiencies, and featuring them undercuts the restraint thesis. It endorsed leaning on the repo's verbatim **"a ceiling, not a template"** line and the dated **2026-05-30 → 2026-06-13 review-to-ship delta** as a "the steering loop actually turns" beat.

---

## 4. Debate & resolution

All four critics converged on the same core verdict: the intellectual content and central thesis are strong, the repo is a genuinely dogfooded case study, and the load-bearing facts hold — but the deck was ~50% over budget and carried a handful of grep-able numeric errors plus evidence-attribution risks.

### Where the critics agreed (adopted wholesale)

- **Over-scoping and redundancy.** The narrative critic (over-budget) and the repo-accuracy critic (same merges) independently identified the same cuts: merge Theme 1's doom-loop anecdote + data, merge Theme 2's rules tour, merge Theme 5's payoff/where-to-start pairing, and cut Theme 3's standalone lint-hygiene slide because it duplicates Theme 2's thesis. The three over-repeated ideas (Agent = Model + Harness, the Pocock quote, the doom-loop stats) now land **once** with callbacks thereafter.
- **The rule-count error is the single highest credibility risk.** Three critics flagged it; the moderator independently verified ground truth. `eslint-config/local-plugin.js` registers **exactly 18** rules; the generated catalog (`docs/generated/local-lint-rules.md`) splits them **7 maintainability / 6 architecture-fitness / 5 behavior** by H3 header. "30+," "17," "19," and "25" are all wrong and were purged from every slide and note. *(Re-verified at write time: the catalog contains exactly 18 rule H3 headers in a 7/6/5 split.)*
- **Evidence calibration.** Two critics asked for **one consolidated "proven vs. directional" slide** near the end, absorbing caveats currently scattered across five themes' speaker notes, with the caveats moved onto the slide face as one-word tags.
- **The live stale-doc bug is the strongest single slide.** All four critics call it the most honest and memorable beat — it proves "stale docs are worse than none" and "a sensor you don't run doesn't protect you" simultaneously. It is protected from cuts and is **not** to be fixed before the talk; it is shown live as the open wound.
- **Restraint framing.** Present `harness:audit`, the slow-drift lane, and the sensors as **shipped, never as future work**, and close on the repo's verbatim "ceiling, not a template" line.

### Where the critics disagreed / the moderator adjudicated

- **`combat-actions` deep-module numbers.** Drafts said "imports 6 siblings / ~4 entry points / ~14 internal files." The repo-accuracy critic corrected to "5 siblings / ~5 entry points / ~9 source files." The moderator verified directly: `combat-actions.ts` has **5 sibling imports** (one providing two named exports) over **9 non-test source files**. The "14" double-counts test files and the `MODULE.md`. The repo critic was right; the deep-module + no-barrel-reconciliation *point* is valid, only the numbers were inflated.
- **Retry count.** Theme 3 said 81; the repo critic and corpus said 73. A later live re-check found exactly **one** annotated `{ retry: 3 }` (all in packages, 0 in e2e), and the current deck uses that stricter figure.
- **Coverage map counts.** Theme 2 used both "232" and "230" rows plus "177 linted." Verified: **~230 rows**; status sub-counts are not reliably cite-able. Decision: drop the breakdown and say "every tracked file has a declared lint owner."
- **`eslint-disable` count.** The original "48 across 2,070 files" was true only via the disable-register script (a naive grep returns more). A later live re-check found **49 governed eslint-disable directives (32 inline / 17 broad)**, and the current deck uses that number.
- **Morph "+22 vs +1."** The evidence critic flagged it as the single highest prominence-to-evidence mismatch; two other lenses treated it as a great hook. The moderator sided on **attribution** — present as "one team's reported measurement (Morph, via Thoughtworks/Musi review) — directional, not a controlled benchmark" — while keeping it as the reframe hook, because the harness > model thesis has corroborating convergence; the *number* just can't be presented as a settled benchmark.
- **Opening structure.** The narrative critic argued strongly to **cold-open on the doom loop** (stakes before vocabulary); the repo critic was neutral. The moderator adopted the cold open: slide 2 = stakes; slide 3 = reframe + Agent = Model + Harness + the `CLAUDE.md` = 1-line reveal as the first proof/laugh.

### Resolution

The moderator adopted the narrative critic's 20-slide spine almost entirely (it was the most rigorous reconciliation and already cross-checked against the other lenses), with the repo critic's numeric corrections baked in, the evidence critic's consolidated-evidence slide and on-slide caveat tags added, and the novelty critic's shipped-vs-planned discipline plus the restraint line on the closer. That reconciled spine had the full arc — stakes → reframe → thesis → mechanisms (lint-heavy, tests-heavy) → system → payoff → action. Every section carried a leadership takeaway; **lint and tests each retained four heavy slides** (the merges removed redundancy, not substance); and the three over-repeated ideas each landed once. The later `05-research-update-recommendations.md` pass added a core security slide and refreshed evidence, producing the current **23-slide** deck in `02-slides.md`.

The resulting original spine (titles abbreviated): (1) title + hook; (2) the doom loop, cold open; (3) Agent = Model + Harness + the `CLAUDE.md`=1-line reveal; (4) the thesis — AI-ready = onboarding-ready; (5) the orientation library; (6) deep modules; (7) the live stale-doc bug; (8) lint = cheapest feedback; (9) the 18 invariants; (10) every error message is a repair manual; (11) the lint ratchet; (12) behavior is the hardest axis; (13) coverage is theater; (14) mutation testing; (15) the managed test budget; (16) it's a system, not a pile of tools; (17) timing + fusion; (18) proven vs. directional; (19) the payoff; (20) where to start. See `02-slides.md` for the current 23-slide order.

---

## 5. Corrected claims

These are the claims that were wrong or overstated in the drafts and have been corrected in the final deck. The table is included so a reader can trust the final report: the errors were caught, not shipped.

| # | Original (draft) claim | Correction (final deck) | Why it mattered |
| --- | --- | --- | --- |
| 1 | "30+ custom local ESLint rules" (Theme 2 header); "17 registered rule names" (Theme 1 open-question); "19" / "25" floating in corpus | **Exactly 18 registered local ESLint rules**, split **7 maintainability / 6 architecture-fitness / 5 behavior**. Verified via the `rules:{}` block in `eslint-config/local-plugin.js` and the 18 H3 headers in `docs/generated/local-lint-rules.md`. | Single most grep-able credibility risk; a hostile engineer who finds "30+" can dismiss the whole talk and discount the harder-to-check external stats by association. |
| 2 | "81 surgical annotated retries"; later "73 annotated retries" | **One** annotated `{ retry: 3 }` on a documented crypto-RNG critical-miss flake; 0 in e2e. | A hard number a sharp engineer can re-grep on stage. |
| 3 | "`combat-actions.ts` imports 6 siblings, ~4 entry points over ~14 internal files" | **Imports 5 siblings (one providing 2 named exports), ~5 entry points over ~9 non-test source files.** "14" double-counted tests + `MODULE.md`. | The deep-module + no-barrel point is valid; the inflated numbers were the only error. |
| 4 | "232-row coverage map … 177 linted, 132 ratcheted" (and "230" used elsewhere) | **~230-row coverage map**; drop the linted/ratcheted breakdown — say "every tracked file has a declared lint owner." Do not cite "177 linted" or "232." | Internal inconsistency (232 vs 230) is itself a credibility leak. |
| 5 | "48 eslint-disable directives across 2,070 files" (implied via raw grep) | **49 *governed* eslint-disable directives (32 inline / 17 broad, per the disable-register), each carrying a required `-- reason`**. A naive grep returns more. | An audience member who greps gets a different number unless the register framing is on the slide. |
| 6 | Morph "+22 vs +1 SWE-bench" presented as a settled benchmark that reframes the whole talk | **"One team's reported measurement (Morph, via Thoughtworks/Musi review) — directional, not a controlled benchmark."** Anchor the harness > model thesis on broader convergence too. | Sourced only through the repo's own review doc, no recoverable primary; prominence was inversely proportional to sourcing. |
| 7 | GitClear used inconsistently ("~4x clones" in one theme, "12.3% copy-paste" in another); "the doom loop is measured" | Use **one consistent GitClear metric** (12.3% prevalence + "duplication exceeded refactoring for the first time"). Soften to **"evidenced — a converging correlational trend (GitClear) plus a controlled mechanism study (IEEE-ISTAS)."** GitClear is correlational, vendor-sourced, and does not label AI-written lines. | Two metrics for one source across the deck invites a "which is it?" challenge; "measured" overclaims a correlational vendor source. |
| 8 | "The doom loop proven"; lint/test cure stats (45%→5%, ~10x cheaper, 100%/4%) shown at peer-reviewed weight | Soften "proven" → **"demonstrated / measured"** (IEEE-ISTAS is a single-model RCT). Keep illustrative cure stats off slides or tag "(illustrative)." State that the rigorous data measures the **problem**; the lint/test **cure** is a high-confidence low-cost bet, not a proven silver bullet. | Mixing evidence tiers at equal visual weight is the biggest credibility risk with engineers. |
| 9 | DX "AI halved onboarding (91→49 days)" and Anthropic "17% lower comprehension" stated as fact | **DX (vendor study, daily-AI-use cohort): ~91→49 days, directional.** The 17% figure is secondary-reported (InfoQ) — verify against Anthropic's primary publication or drop it / move to a Q&A backup. | Vendor/secondary sourcing presented as settled fact in a leadership takeaway. |
| 10 | OpenAI "~1M lines / ~1,500 PRs / zero human-written code" as a marquee proof point | If used at all, attribute as **OpenAI self-reported**, avoid the "zero human review" phrasing, and balance with a risk counter-narrative. Earlier research noted a primary-source 403; the page was reachable in a later follow-up, so do not preserve the 403 caveat as current fact. | Secondary retellings vary on the "zero human review" claim. |
| 11 | `harness:audit`, the weekly slow-drift lane, the `module-doc-paths` / `layer-direction` sensors framed as recommended/next-step work | **All SHIPPED** (verified: `harness:audit` in `package.json`; `slow-drift.yml` cron `23 9 * * 1`; `module-doc-paths` sensor present with `runByDefault: false`; drift-ai pack Done). Present as shipped, never as future work. | Framing shipped work as aspirational would contradict the deck's own evidence and understate the harness. |
| 12 | `scripts/lint.sh:35` cited for `eslint --max-warnings=0` | It is **line 32** (`eslint . --max-warnings=0`). Standardize on 32. | Minor, but a wrong line number is a free credibility ding. |
| 13 | "Böckeler" spelled inconsistently ("Bockeler" / "Böckeler") on an attributed quote | **Standardize to "Böckeler"** everywhere. | Inconsistent spelling on an attributed source looks sloppy. |
| 14 | `character-live-state` has "12 internal files" | **11 non-test source files.** (The bug itself — `MODULE.md:75` claiming a deleted `index.ts` facade, sensor `runByDefault: false` — was verified still live in the 2026-06-15 update and kept as the open wound.) | Fix the count if cited; protect the slide. |

---

## 6. Confidence & caveats

**What is well-evidenced (high confidence):**

- **Every load-bearing Musi-repo fact in the final deck** was verified against source and re-verified at write time: the 1-line `CLAUDE.md`, 41-line `AGENTS.md` under a hook-enforced 250-line cap, 18 rules in a 7/6/5 split, the symmetric ratchet and 12-entry retirement-only debt log, the 8-step verify matrix identical across four consumers, 108 controls, the weekly slow-drift cron, the Stryker baseline, the 0/0/0 focused-or-skipped suite, and the **live stale-doc bug** (`MODULE.md:75` + `runByDefault: false` sensor).
- **The *problem* — that ungated AI coding raises duplication, complexity, and security debt — is measured**, by peer-reviewed work: CMU MSR'26 (807 repos; +30% warnings, +41% complexity, persistent) and the IEEE-ISTAS 2025 RCT (+37.6% critical vulnerabilities over five unreviewed iterations, with human review named as the fix).
- **The central thesis (AI-ready = onboarding-ready) is convergent**, stated almost verbatim by independent and commercially-distinct authors (Pocock, Tian Pan) and grounded in classic theory (Ousterhout's deep modules), and corroborated by the repo's own 2026-06-13 onboarding audit.
- **The harness's self-correction is demonstrable**: gaps named on 2026-05-30 (R9/R10/R1/R12) were shipped by 2026-06-13 (`harness:audit`, `slow-drift.yml`, the two drift sensors).

**What is directional or thinner (state with calibration):**

- **The *cure* — that lint + tests specifically fix the doom loop — is a high-confidence, low-cost bet, not a proven silver bullet.** The strongest cure stats (45%→5% violations, ~10x cheaper eval, 100%-coverage/4%-mutation) are single-author or vendor anecdotes and are tagged "(illustrative)" or kept off slides.
- **Most external sources are commercially interested** (Anthropic, GitClear, Veracode, DX, Faros, Chroma, Factory.ai). The real signal is that *competitors converge on the same conclusions* — the deck says this explicitly on the evidence slide rather than claiming a neutral "consensus."
- **The Morph "+22 vs +1" number is directional only** — one team's reported measurement, no recoverable primary.
- **Behavior confidence is the honest gap.** The repo self-declares it the weakest axis (`docs/ai-harness.md` **Current Gaps**), and the literature (Böckeler) agrees functional-behavior harnessing is industry-unsolved. Mutation testing is scoped to 16 of 66 shared files and runs off-gate by design.

**Operational caveat for the presenter:** several cited numbers drift over time (AGENTS.md line count, guide/MODULE.md totals, retries, the test-call splits). Re-run a quick grep checklist before the talk. In particular, **re-verify the `character-live-state/MODULE.md:75` bug is still unfixed** — if the team's own sensor catches and fixes it before the talk, reframe the slide from "open wound" to "found and fixed by our own sensor."
