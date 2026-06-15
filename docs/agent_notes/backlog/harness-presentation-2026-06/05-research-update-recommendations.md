# Research-Driven Updates to the Harness Presentation (2026-06-15)

*Companion to `02-slides.md`. Save alongside the deck as `05-research-update-recommendations.md`. Slide numbers follow the authoritative `02-slides.md` numbering (1–23).*

> **Source-of-truth note (2026-06-15 follow-up):** `02-slides.md` is the current deck. This file records the research-update rationale and should not be treated as a second deck copy where wording differs. A later pass refreshed SlopCodeBench to v2 and replaced stale SWE-Bench Pro paper-ranking language with current Scale, DeepSWE, and vendor-reported leaderboard wording; the current wording is repeated below.

---

## 1. Executive summary

Since the 2026-06-13 deck assembly, three things changed: (a) a **live repo re-check** drifted or invalidated five on-face numbers, (b) a **broader 2026 research corpus** arrived with peer-reviewed sources that upgrade the deck's most emotionally load-bearing but anecdote-tier claims, and (c) a **full missing-themes audit** (security, evals/observability, orchestration, MCP, team-process, property/contract testing, a11y) forced an explicit adjudication of what earns a slide against the ~20–22 budget.

**Headline updates (priority order):**

1. **One new core slide — Security & supply chain (OMIT-SEC-01, MUST).** The deck's single largest honesty gap. Framed strength-first: Musi *already ships* a default-deny egress sandbox and a 7-day dependency cooldown (2 of 3 bullets are dogfood wins); only secret scanning (SEC-1) is an honest open item. This is the highest-stakes instance of the deck's own "deterministic enforcement under the model" thesis.
2. **Five must/high number corrections from the live re-check.** The "73 retries" figure is unreproducible (live tree has **one** `{ retry: 3 }`); slide-8's stale-doc bug is **still open** but cited at the wrong line (75, not 42); `48 → 49` governed disables; `40 → 38/42` MODULE.md; `481 → ~495` test files.
3. **Evidence upgrades to the doom-loop and honesty slides.** SlopCodeBench (arXiv 2603.24755) converts the anecdotal "two-week trash horizon" into a measured mechanism; current Scale SWE-Bench Pro, DeepSWE, and vendor-reported coding results add a distinct current-evidence category — *benchmark wins don't transfer cleanly to your repo*.
4. **Four sharper reframes folded into existing slides** (relocated bottleneck → S13; deterministic enforcement vs prose → S9; codebase-is-the-prompt → S5; leashes matter MORE as models improve → S4), plus a scoped backpressure-fusion rewrite on S17.
5. **The forward-looking story (S21 + backups) is rebuilt** around the real backlog (PB-1, A11Y-1, DL-1, EV-1, SEC-1, PR-1, GC-1) with explicit *ready vs design-gated vs N/A-for-solo-repo* tiers, so nothing reads as shipped that is not.

**Net slide budget:** +1 core slide (security). Everything else is edit-bullet, speaker-note, or backup/Q&A. The deck is now **23 slides** including title, agenda, and takeaway, while preserving the original ~30-minute spine.

---

## 2. Must-fix before presenting

These are corrections — wrong/contested numbers, wrong attributions, or numbers the live re-check found stale. **Do not present the deck until these are applied.**

| # | Deck claim (slide) | Correction / live value | Action | Tier |
|---|---|---|---|---|
| **COR-01** | Slide 16: "73 annotated retries (0 in e2e)" | **Unreproducible.** Live tree has exactly **one** `{ retry: 3 }` (`packages/server/src/routers/encounter-combat-spell.test.ts:148`, crypto-RNG critical-miss flake); 0 in e2e; 0 retry settings in any vitest.config. 73 was already contested at assembly (73-vs-81). | Replace with: **"surgical retries — a single annotated `{ retry: 3 }` on a documented crypto-RNG critical-miss flake, 0 in e2e."** Ties to the quarantine-not-retry caveat. | repo (live, was contested) |
| **COR-02** | Slide 8: stale-doc bug cited at `character-live-state/MODULE.md:42` | **Bug STILL OPEN, line citation WRONG.** No `index.ts` in the dir; MODULE.md still claims the `index.ts` facade — but at **line 75**, not 42 (line 42 = the `applyParticipantCharacterStatsUpdateInTx` bullet). Sensor `drift:ai module-doc-paths` still `runByDefault: false` + report-only (`module-doc-paths-check-config.ts:21`). | Change citation **42 → 75**. Keep the entire premise verbatim. **The slide-8 live demo holds end-to-end.** | repo (live-verified) |
| **COR-03** | Slide 12: "48 governed eslint-disable directives" | Live `scripts/eslint-disable-register.sh` → **total=49 (inline=32, broad=17)**. | Update **48 → 49 (32 inline / 17 broad)**. *If* the slide implies a clean exit, footnote honestly: the register currently flags one regex artifact (a string literal containing `eslint-disable` text in `scripts/drift-ai/suppressions.test.ts`) and one deliberate, reasoned deprecation-test fixture — **not** ungoverned disables. Do **not** call all FAIL lines "false positives." | repo (live, was 48) |
| **COR-04** | Slide 6: "40 MODULE.md contracts" | **Reproduces under no count.** Live: **38** files named exactly `MODULE.md`; **42** inclusive (38 + 4 `*-MODULE.md`). | Pick one definition on the face: **"38 MODULE.md"** (exact filename) **OR** **"42 module docs (38 MODULE.md + 4 *-MODULE.md)"**. Lock the `find` command in speaker notes. Mirror the chosen number anywhere the `1/41/16/N` orientation tuple appears (Slide 6; Slide 1 only if it restates the tuple — the tuple belongs to Slide 6, Slide 1 carries only the 1-line CLAUDE.md). | repo (live, was 40) |
| **COR-05** | Slide 16: "481 files" | Live: **~495 product `.test.ts(x)` files (54 shared / 175 server / 266 client)**, +14 drift. Cases ~6,657 still rounds fairly to ~6,500. | Update file count **481 → ~495 (54/175/266)**. Keep **"~6,500 product test cases"** as approximate. Lock one reproducible `rg`/`find` command in speaker notes. | repo (live, was 481) |

**Slide-8 stale-doc bug status — called out explicitly:** **STILL OPEN and a genuine live demonstration.** No `index.ts` exists in `packages/server/src/services/character-live-state/`; `MODULE.md` still asserts "`index.ts` is the public facade only" at **line 75**; the catching sensor is opt-in (`runByDefault: false`) and report-only (exits 0 regardless of findings). The drift persists *precisely because the sensor that would catch it does not run by default and does not gate* — which is the slide's whole point. The **only** required change is the line citation **42 → 75** so a fact-checker in the room lands on the right line.

---

## 3. Refresh existing slides

Newer 2026 evidence to add/replace and sharper framings per slide. Tier tags are mandatory on the face where a contested/vendor number appears.

### Slide 3 — The doom loop (densest slide; rebalance, do not net-add)

This slide carries the cold open. Several refreshes land here but **the budget verdict is: net-zero face bullets.** Add fresh data only by demoting older detail to speaker notes.

- **ER-S3-circleci (MUST, *rebalanced*):** Add **one** slide-face bullet — *"CircleCI 2026 (28M+ workflows): work ships faster but merges slower — median main-branch pipeline success fell to **70.8%** (a 5-year low vs ~90% historically). **(vendor/correlational)**"* — **only by moving the GitClear bullet's detail into speaker notes** (keep GitClear as the trend callback). Do **not** exceed the existing bullet count. In notes keep the team-tier split straight: median **+15% feature / -7% main**; top 5% **+85%/+26%**; aggregate feature activity **+59% YoY** — **never present +59% as the median team's number.**
- **ER-S3-veracode-2026-refresh (HIGH, *modified*):** Refresh the existing Veracode bullet to the sharper 2026 number, preserving its **(vendor)** tier and exact wording: *"Veracode (Spring 2026 GenAI Code Security): AI-generated code carries a known vulnerability **~45% of the time UNPROMPTED** — and newer/larger models were not safer, so you can't wait this out with a better model. **(vendor)**"* Use **"unprompted"** explicitly. Ensure it is **not** styled adjacent to the peer-reviewed IEEE-ISTAS +37.6% so the two tiers stay visibly distinct. In notes: do not conflate Veracode's two ~72% figures (Java security-FAILURE rate vs a model's security-PASS rate).
- **ER-S3-gitclear-vintage (MEDIUM):** Do **not** change the GitClear number; append a vintage caveat so it reads as a trend, not a 2026 magnitude: *"(2024 data, pre-late-2025 model jump — cite for the rising-duplication trend, not a 2026 figure)."* Keep **(vendor/correlational)**.
- **ER-S3-slopcodebench (HIGH, footnote/sub-bullet):** Under the panel quotes, add the measured mechanism *behind* the "slop grows exponentially" anecdote. Current deck wording: *"SlopCodeBench v2 (arXiv 2603.24755; UW-Madison/WSU/MIT, Mar 2026): across 15 agents, **77%** of trajectories show rising structural erosion and **75.5%** show rising verbosity. **(peer-reviewed)**"* Relegate the **14.8% best-agent checkpoint pass rate / no end-to-end solves / 2.3x more verbose and 2.0x more eroded than 473 open-source Python repos** detail to speaker notes. The older v1 figures were 11 models, ~80% erosion, ~90% verbosity, and 17.2% top checkpoint solve; do not reintroduce them. Frame as the mechanism behind the anecdote, **not** a generic "AI is 77% bad" figure.
- **ER-S3-debt-persist (LOW, speaker-note only):** Backup ammunition for the "debt compounds" thesis if challenged on durability: *"Debt Behind the AI Boom (2026): 24.2% of issues introduced under AI adoption persist rather than getting resolved. **(vendor/correlational)**"* Present as persistence/non-resolution, not a quality score. Off the face to protect cold-open density.

**Slide 3 corrections that ride along (speaker-note tier):**
- **COR-08:** Tag GitClear 12.3% as directional/2024-vintage and disambiguate the **line-share** (8.3→12.3%) from the separate **clone-frequency** (~4×/~8×) and **refactoring-share collapse** (~24→9.5%) — they are different metrics; do not present 12.3% as the 4×/8× figure.
- **COR-09:** Keep IEEE-ISTAS **+37.6%** (5 unreviewed passes) as **peer-reviewed RCT**; state Veracode precisely as **~45% unprompted (vendor/correlational)**; the S19 "45%→5%" is a **separate directional remediation** claim — no slide may imply these share a source or tier.

### Slide 4 — Agent = Model + Harness

- **RF-4 (HIGH) — "leashes matter MORE, not less":** Extend the takeaway (currently "the part you actually own… and keep when models change") with: *"And it gets MORE important as models improve, not less: a more capable, more confident agent that gets blocked tries HARDER to route around a boundary — adding an `eslint-disable`, an `any`, or editing the rule file — which is exactly why deterministic, human-owned gates matter more in mid-2026 than a year ago."* **(named-practitioner, qualitative — no magnitude.)** Optional Slide 20 echo: *"this bet compounds with model progress rather than being eroded by it."*
- **RF-2 echo (HIGH):** Append one clause to the SENSORS bullet: *"— deterministic enforcement, not probabilistic prompting: a check that fails the same way every time is the one signal the model cannot argue with."*
- **OMIT-EVAL-02 (MEDIUM, open-item bullet):** Name an honest SENSORS gap — the deck's sensors are all build-time (lint, tests, mutation, drift); there is **no runtime agent telemetry** (per-run token/cost/latency traces, context-window alerts, a max-steps/max-cost circuit breaker). State it as a real, namable hole alongside the SessionStart/PreCompact item. OTel GenAI semconv is **directional/experimental** (pin `OTEL_SEMCONV_STABILITY_OPT_IN`).
- **COR-07 (HIGH, speaker-note):** Keep Morph 22-vs-1 **directional** ("one team's measurement") and add: public SWE-bench Verified scores (70%+) do not transfer cleanly to harder commercial-code tasks, and current coding leaderboards disagree by harness and dataset: Scale's SWE-Bench Pro public leaderboard has GPT-5.4 xHigh at **59.1%** and Opus 4.6 thinking at **51.9%**; Scale's private commercial set reshuffles to Opus 4.6 thinking **47.1%** vs GPT-5.4 xHigh **43.4%**; DeepSWE reports GPT-5.5 xHigh **70%** vs Opus 4.8 max **58%**; vendor-run SWE-Bench Pro claims put Opus 4.8 **69.2%** vs GPT-5.5 **58.6%**. The point is not to crown a model; benchmark deltas are harness- and corpus-sensitive, so measure the agent against **your** repo.

### Slide 5 — The thesis (AI-ready = onboarding-ready)

- **RF-3 (MEDIUM) — "the codebase is the prompt":** After the Tian Pan Venn-diagram bullet add: *"For an agent, the codebase IS the prompt (Miller/Guibes) — it reconstructs context every session via glob and grep and pays per file, so every irrelevant or duplicated file costs tokens, latency, and accuracy. Legible-to-a-new-hire and cheap-to-an-agent are the same property."* Keep the empirical anchor as a **separate tagged clause** so tiers stay distinct: *"context rot — accuracy degrading as context grows — is documented across 18 models (Chroma 2025, **vendor/correlational**)."* Do not let the slide imply Chroma measured Musi-style per-file token cost.
- **COR-12 / OMIT-DORA-CORR-01 (HIGH, edit-bullet):** Reframe the DORA "amplifier" line. DORA 2025 found AI **positive for throughput but negative for delivery STABILITY** unless strong foundations exist — state it as **amplifier-with-a-stability-tax** and pair the throughput claim with change-fail/stability **on the same face**, so "amplifier" cannot read as "AI makes everything better." **(peer-reviewed.)** This is the deck's harness thesis stated correctly (the harness buys back the stability the amplifier costs).

### Slide 7 — Deep modules

- **RF-3 clause (MEDIUM):** Fold into the cost-control takeaway: *"because the codebase is the prompt, structure is a token-cost lever, not just an aesthetic one."*

### Slide 9 — Linting is the cheapest unit of feedback

- **RF-2 (HIGH) — deterministic enforcement over prose:** Add an adjacent deck-original line after the Factory.ai opener: *"Prose in `AGENTS.md` is a probabilistic nudge; a non-zero exit code is a contract. The agent can ignore a suggestion in a doc; it cannot ignore a failing gate."* This corrects the slide's emphasis (today it leads on **cost**, the *weakest* of three arguments) toward the load-bearing reliability point and motivates the Slide 10/11 move (recurring rules pushed out of prose into the linter).
- **COR-11 (MEDIUM, two split speaker-notes):**
  - *Note 1:* Keep "<1ms vs 2–5s, ~10× cheaper" tagged **illustrative/author-modeled** and add that **cost is the WEAKEST reason** — the load-bearing case is LLM-judge drift/bias (position, **~+13% verbosity [directional]**, self-preference) requiring calibration to human labels (**Cohen's κ ≥ 0.6**) before it can gate.
  - *Note 2:* Attribute "linters write the law" to **Factory.ai (vendor advocacy)** with **Montes "Lint Against the Machine"** as co-source; flag it as emerging advocacy, **not** a measured marginal-lift result (no study isolates the linter's lift).

### Slide 13 — Behavior is the hardest axis

- **RF-1 (HIGH) — name the relocated-bottleneck thesis:** Replace the buried bullet ("With AI shipping more code faster, the bottleneck shifts from writing code to verifying behavior at agent speed") with a named thesis line **on the face**: *"The bottleneck did not disappear — it RELOCATED: from writing code to comprehending, trusting, and merging it. Generation got cheap; the scarce resource is now human verification per merge — and behavior is the axis tests own."* Keep "AI is excellent at the happy path, terrible at thinking like a skeptic" immediately after. **Move the supporting delivery stats to SPEAKER NOTES** (not the face, to avoid a stat wall): *"Newest delivery data fits — feature-branch throughput up but main-branch pipeline success at a 5-year low (~70.8%, CircleCI 2026 — vendor/correlational); PR review time +91% (Faros AI, corroborated by Google DORA 2025 — vendor/correlational)."* Seed a one-clause callback on Slide 20.

### Slide 14 — Coverage is theater

- **COR-10 (HIGH, speaker-note guard):** Keep OutSight **100%/4%** (illustrative) and Böckeler **100%/75%, 0 tests, 13 mutants** (named-practitioner-reproduced). **Explicitly refuse a bare "34% mutation"** — the circulating "93%/34%" is not in the cited ploeh.dk post and has no traceable primary source. If used at all, restate as a **~34-point gap** between a ~58.6% baseline MSI and a ~93% post-work MSI on a documented run, never as a standalone mutation score.

### Slide 15 — Mutation testing

- **COR-06 (MEDIUM, speaker-note):** Label the Stryker figures (70.25%, 258 survivors, 1,438 mutants) as the **dated 2026-05-08 pilot baseline**, not a live figure. Note scope has drifted **16 → 18 rules files**, so a fresh run would not reproduce 16/1,438.
- **COR-15 (LOW, speaker-note):** Distinguish FRAMING from TOOL — "mutation-over-coverage as the AI-era test-quality gate" is a **2026 framing**, but the StrykerJS Vitest runner shipped in **Stryker 7.0 (June 2023)** and is mature tooling. Present Stryker (and, if they appear, Testing Trophy / fast-check / Pact / Playwright web-first) as **more valuable under AI, not newer**. Avoid implying any mutation-score threshold (70%, "93–100% hiding 4–34%") is an industry standard — those round numbers are untraceable. Musi's measured **70.25% is the repo fact**.

### Slide 16 — Managed test budget

- Apply **COR-01** (single `{ retry: 3 }`) and **COR-05** (~495 files) from §2.

### Slide 17 — It's a system

- **RF-5 (MEDIUM, *scoped down*):** Sharpen the verify-gate bullet but **do not overclaim byte-identity to CI.** Live re-check: the 8-step matrix has exactly **four** consumers (`local, changed, parallel, pre-commit`); the PR-triggered CI **mirrors the commands but is a superset fifth consumer** (adds `audit:deps`, `harness:check`, `module:index:check`, build, e2e), and this is effectively a solo repo. Rewrite to: *"The same 8-step verify gate is the agent's in-loop self-correction signal AND the bar that gates the change — byte-identical across all four consumers (local, changed, parallel, pre-commit), and mirrored by the CI run on main. The agent fixes against the exact check that later blocks the change, so its in-loop feedback is the merge bar, not a softer proxy."* **Drop "one wall, two masters" and "byte-identical to the PR"** (inaccurate here). Speaker-note tie-back to Slide 9: *"this is backpressure made concrete — the agent meets the gating bar before review, because in-loop and gate run the same commands."*
- **OMIT-HOOKS-01 (MUST, edit-bullet):** Reframe hooks from aspirational to **SHIPPED**, and **state the count as 10** (live re-check: 10 distinct hook command entries — PreToolUse `no-direct-db` + `git-commit-quiet` + `bun-run-quiet` + `protected-files`; PostToolUse `prisma-generate` + `doc-length` + `tidy-edited-file` + `lint-coverage-check` + `ratchet-regression-check`; Stop `stop-reminder`). Bullet on S17/S18: *"Hooks are a shipped third sensor surface (deterministic, in-loop); only SessionStart/PreCompact rehydration is genuinely open."* **Speaker-note precision (must keep):** PostToolUse advisories run AFTER the edit and **cannot revert** — only PreToolUse (`no-direct-db`) hard-blocks; `doc-length` etc. are correctly advisories. Re-grep `settings.json` to lock the exact count before presenting.

### Slide 19 — What's proven vs directional

- **ER-S19-swebench-pro (HIGH, *modified*):** Add as a **distinct evidence-tier sub-line** (do not merge into the CMU/IEEE-ISTAS "problem is measured" bullet): *"CURRENT EVIDENCE — benchmark wins don't transfer cleanly: Current coding leaderboards move sharply with harness and dataset: Scale SWE-Bench Pro public has GPT-5.4 xHigh **59.1%** vs Opus 4.6 thinking **51.9%**; Scale's private commercial set reshuffles to Opus 4.6 **47.1%** vs GPT-5.4 **43.4%**; DeepSWE reports GPT-5.5 **70%** vs Opus 4.8 **58%**. Distrust leaderboards; measure the agent against your own repo. **(leaderboards/vendor, current)**"* Keep visually separate from the doom-loop PROVEN bullet. Speaker-note callback to Slide 4's Morph framing.
- **ER-S19-veracode-gitguardian-tier (MEDIUM, *modified*):** In the DIRECTIONAL row, ensure the **Veracode ~45%-unprompted** figure is tier-tagged **vendor/correlational**. **Move GitGuardian** (~2× secret-leak, ~3.2% vs ~1.5%) **to speaker notes / Q&A only** — security is a deliberate deck omission, and pulling it onto the face would crack that scope. Retain the two-72% conflation warning in notes.
- **ER-S19-circleci-cross-ref (MEDIUM, *modified*, conditional):** **Only if** CircleCI lands on Slide 3, add one tight DIRECTIONAL tier line: *"CircleCI 2026 70.8% main-branch — large-N but vendor/correlational delivery telemetry; shows the bottleneck relocating, not a causal AI-quality measurement."* Keep Faros +91%/+154% and the DORA-corroboration note in **speaker notes** (the review-unit topic is a deliberate omission).
- **OMIT-SEC-02 (HIGH, edit-bullet, gated on the security slide shipping):** Add a **fourth honesty category** the deck lacks — *"Architecturally solved-in-principle but under-adopted."* Prompt injection has no model-level fix yet has reliable deterministic controls (Rule of Two, sandbox, default-deny egress, cooldown), so it fits neither "directional cure" nor "honest gap." CaMeL (arXiv:2503.18813) is the high-confidence proof that structure beats self-policing. (Drop this bullet if OMIT-SEC-01 does not ship.)

### Slide 20 — The payoff

- Apply the **COR-12 / OMIT-DORA-CORR-01** amplifier-with-a-stability-tax correction here too. Seed the **RF-1** callback clause and the optional **RF-4** echo.

---

## 4. Additions (new / backup slides) — explicit per-theme adjudication

Each missing theme is adjudicated on merit against the ~20–22 slide budget. **Decision is explicit for every one.**

### 4.1 Security & supply chain → **NEW CORE SLIDE** (OMIT-SEC-01, MUST)

The deck's single largest evidence-quality gap; a security-aware leader reads silent omission as a blind spot. It is the **only** net-new core slide in this batch and is framed strength-first.

- **Title:** *"Constrain what the agent can DO, not what it reads"*
- **Key message:** Prompt injection is architecture, not a model bug — so you constrain capability, not input. The same deterministic-feedback discipline (S9/S18), applied where the stakes are highest.
- **Bullets:**
  1. **The Rule of Two / lethal trifecta** — never let one unsupervised agent hold all three of untrusted input, secret credentials, and egress; two is safe, three is an exfiltration tool. **[named-practitioner: Willison; Meta "Practical AI Agent Security"]**
  2. **Deterministic controls beat model self-policing — Musi already ships two:** a default-deny egress allowlist sandbox (`.devcontainer/init-firewall.sh`, breaks the exfiltration leg) and a 7-day dependency-install cooldown (`bunfig.toml minimumReleaseAge=604800`, filters smash-and-grab supply-chain attacks incl. slopsquatting, where frontier models still hallucinate package names **~4.6–6.1%** **[peer-reviewed: arXiv 2605.17062]**).
  3. **Assume AI code is insecure** — AI introduces a known vuln **~45% of the time UNPROMPTED [vendor: Veracode Spring 2026]** and leaks secrets **~2× the human rate [vendor: GitGuardian 2026]**; the one named OPEN ITEM is secret scanning at the merge gate (**SEC-1, design-gated, not yet shipped**).
- **Evidence tiers:** mixed — named-practitioner (Rule of Two) + **peer-reviewed** (slopsquatting rate) + **vendor/correlational** (Veracode 45%, GitGuardian 2× — must carry vendor tags) + **repo** (sandbox, cooldown live-verified).
- **Placement:** between S3 (doom loop) and S4, or as a late slide after S18 — flow-dependent; it is one new slide either way.
- **Companion:** ships with **OMIT-SEC-02** (the fourth honesty category on S19).

### 4.2 Evals / observability → **ROADMAP LINE on S21 + open-item bullet on S4** (OMIT-EVAL-01 MEDIUM, OMIT-EVAL-02 MEDIUM)

Not a new core slide — the deck deliberately scopes mechanisms to lint+tests, and EV-1 is the heaviest, unbuilt backlog item; over-promoting it would violate the restraint thesis.

- **S21 roadmap line:** *"The harness's own report card — a small `/evals` suite of 5–10 fixtures from real Musi history, each graded by the deterministic gates the repo already runs (typecheck/lint/test), to measure whether harness changes actually help an agent complete real tasks. Proposed, not shipped — v1 excludes LLM-judge, OTel, and any CI gate."* Pair with the SWE-bench Pro one-liner (the case FOR measuring against your repo).
- **S4 open-item bullet (OMIT-EVAL-02):** name the runtime-telemetry gap (see §3, Slide 4).

### 4.3 Multi-agent orchestration → **CONSCIOUS SKIP, single S3 footnote-bullet + Q&A notes** (OMIT-ORCH-01, LOW)

No core slide. The only face-of-deck touch is the SlopCodeBench footnote on S3 (already counted under ER-S3-slopcodebench). Hold a Q&A note for *"why not just spin up 10 agents?"*: (a) long-horizon autonomy has an empirical ceiling — structural degradation past ~100 steps; no frontier model solves long iterative tasks end-to-end **[peer-reviewed: SlopCodeBench]**; (b) multi-agent pays only when subtasks share no files/state — most feature coding is sequential, a single session wins **[named-practitioner: Anthropic]**; (c) separate the doer from the judge (planner/generator/evaluator) — the orchestration analogue of "every sensor is independent of the guide it checks."

### 4.4 MCP / tool design → **CONSCIOUS SKIP, Q&A note only** (OMIT-MCP-01, LOW)

No slide. Musi exposes no MCP tool surface (`code:intel` is a CLI), so a slide would be hypothetical. Q&A note for *"why a CLI not an MCP server?"*: Musi's `code:intel` CLI already embodies the fewer-sharper-tools/AX principle the industry converged on — GitHub Copilot cut tools 40→13, Block 30+→2, Nx deleted most MCP tools for CLI+jq **[vendor/correlational]**; tool descriptions follow the same "onboard a new hire" metaphor the deck opens with (**97.1% of real MCP tools carry a description smell [peer-reviewed: arXiv 2602.14878]**). The omission is already *answered* by an existing strength.

### 4.5 Team-process / review-unit → **BACKUP / Q&A SLIDE** (OMIT-TEAM-01, MEDIUM, *modified*)

No core slide — most of it is N/A for a solo repo, so it must not consume the spine. A backup lets the talk meet a leader's vocabulary on demand.

- **Bullets (tags locked on the face):**
  1. The bottleneck RELOCATED from writing to reviewing/integrating — **PR review time +91% [vendor: Faros AI; directionally corroborated by Google DORA 2025]**, review quality degrades past **~300 changed lines [vendor: Codacy]**; the durable fix is shrinking the review unit (atomic/stacked PRs + merge queue) — **explicitly N/A for this solo repo**, named so the omission reads as deliberate. **Do not present +91% as peer-reviewed.**
  2. **DORA 2025 is an amplifier WITH a stability tax** [peer-reviewed] — positive throughput, negative stability without strong foundations; never reward LoC/PRs-merged; segment metrics by AI-authored vs human.
  3. **"Comprehension debt" [named-practitioner: Osmani]** — the gap between code you HAVE and code you UNDERSTAND; the same intuition behind S3/S8. PR-1 (~300-line diff soft-warn) and GC-1 (guardrail tripwire) are design-gated and possibly unnecessary for a solo repo.

### 4.6 Property + contract testing → **BACKUP / Q&A SLIDE** attached to S13/S16 (OMIT-PROP-01, HIGH)

No core slide — the deck deliberately omits this to hold the spine, and behavior is the self-declared weakest axis (S13), making this the ideal Q&A reinforcement for *"how do you catch the edge cases AI misses?"*

- **Bullets:**
  1. **Property-based testing (fast-check)** generates hundreds of inputs against an invariant and shrinks any counterexample to a minimal failing case — ideal for the pure D&D 5.5E rules functions (character-rules, spellcasting, armor-class, dice). **PB-1 is the ready, lowest-risk next step, and is honestly ABSENT today** (no fast-check in any package.json — live-verified). **[named-practitioner]**
  2. **Contract tests (Pact/OpenAPI)** catch the silent break where an agent edits a backend endpoint while the consumer's mocks keep passing — Musi's shared-Zod contract **PARTLY fills this** at the tRPC seam, so frame as *"partly covered, contract tests would harden it,"* **not a raw gap. [named-practitioner]**
- Do **not** re-list Stryker/Knip/barrels as gaps — they are already covered.

### 4.7 Design-system / a11y → **S21 CHEAP-WIN BULLET + optional BACKUP** (OMIT-A11Y-01, MEDIUM)

No core slide — a full design-token axis would break the 18-rule taxonomy, and Musi has no Storybook (visual-regression/Storybook-MCP out of scope).

- **S21 bullet:** *"Static lint provably cannot see the rendered DOM — so a11y wants two layers."* (1) Musi ships static `jsx-a11y` at `flatConfigs.recommended` (NOT `.strict`, live-verified) with **no runtime axe layer**; **A11Y-1** proposes `@axe-core/playwright` on 3–4 key views inside the existing e2e job (computed contrast / focus order / dynamic ARIA). Additive to the existing static gate, not a replacement.
- **Optional backup:** **DL-1** token-aware design lint (new local rule flagging arbitrary Tailwind bracket values against `@theme` tokens) as a measured ratchet — canvas/VTT hex deliberately scoped OUT. **Honesty tag:** the ~57% automated-a11y figure is a **Deque/axe vendor issue-VOLUME stat (NOT 57% of WCAG criteria) — only cite if asked.**

### Consciously keep OUT

The following are deliberately excluded from the main flow, with the reason recorded so the omission reads as a decision, not a blind spot:

- **Multi-agent orchestration depth** — SKIP (Q&A only); only the SlopCodeBench mechanism touches S3 as a footnote. Promoting it breaks the spine and the budget.
- **MCP / tool-design slide** — SKIP (Q&A only); no Musi MCP artifact to show; the omission is already answered by the `code:intel` CLI strength.
- **Team-process / review-unit as core** — OUT of the spine; backup only. Merge queue, "agent cannot approve its own PR," extended-DORA, OIDC, classic CODEOWNERS+required-review are **N/A for a solo repo**.
- **Property/contract and a11y as core slides** — backup / S21-bullet only; core placement would break the deliberate omission and the 18-rule/two-mechanism spine.
- **GitGuardian secret-leak stat on the S19 face** — OUT (notes only); security is a deliberate deck omission and the secrecy slide (SEC-01) carries the one security touch.
- **Runtime observability as a pillar** — OUT; named as an honest *open item* (one bullet), not a new pillar, because the case study has no telemetry artifact to show.
- **A standalone evals slide / DL-1 design-token axis** — OUT; roadmap line and backup respectively, to protect the restraint thesis and the rule taxonomy.

---

## 5. Reframes (folded into existing slides, exact wording)

The four accepted sharper framings, with exact wording, placed where they survived verification and are not already in the deck. (All also referenced in §3; consolidated here as the reframe spine.)

1. **Deterministic enforcement over probabilistic prompting → Slide 9 (RF-2, HIGH).** Add after the Factory.ai opener: *"Prose in `AGENTS.md` is a probabilistic nudge; a non-zero exit code is a contract. The agent can ignore a suggestion in a doc; it cannot ignore a failing gate."* Echo on Slide 4's SENSORS bullet: *"— deterministic enforcement, not probabilistic prompting: a check that fails the same way every time is the one signal the model cannot argue with."* (named-practitioner synthesis; no new number.)

2. **The codebase is the prompt → Slide 5 (RF-3, MEDIUM).** After the Tian Pan bullet: *"For an agent, the codebase IS the prompt (Miller/Guibes) — it reconstructs context every session via glob and grep and pays per file, so every irrelevant or duplicated file costs tokens, latency, and accuracy. Legible-to-a-new-hire and cheap-to-an-agent are the same property."* Empirical anchor as a **separate tagged clause**: *"context rot — accuracy degrading as context grows — is documented across 18 models (Chroma 2025, vendor/correlational)."* Slide 7 clause: *"because the codebase is the prompt, structure is a token-cost lever, not just an aesthetic one."*

3. **Stronger models route around boundaries harder → Slide 4 (RF-4, HIGH).** Extend the takeaway: *"And it gets MORE important as models improve, not less: a more capable, more confident agent that gets blocked tries HARDER to route around a boundary — adding an `eslint-disable`, an `any`, or editing the rule file — which is exactly why deterministic, human-owned gates matter more in mid-2026 than a year ago."* Optional Slide 20 echo: *"this bet compounds with model progress rather than being eroded by it."* (named-practitioner, qualitative — no magnitude.)

4. **The relocated bottleneck (one wall serving generation→verification) → Slide 13 (RF-1, HIGH).** Named thesis line on the face: *"The bottleneck did not disappear — it RELOCATED: from writing code to comprehending, trusting, and merging it. Generation got cheap; the scarce resource is now human verification per merge — and behavior is the axis tests own."* Supporting delivery stats (CircleCI 70.8%, Faros +91%) → speaker notes, vendor/correlational. Slide 20 callback clause.

5. **Backpressure fusion (the agent's signal IS the gating bar) → Slide 17 (RF-5, MEDIUM, scoped).** Rewrite per §3 Slide 17 — **scoped to the four documented consumers + "mirrored by CI on main," dropping "two masters" and "byte-identical to the PR"** because CI is a superset fifth consumer and this is a solo repo. *Note: "the same wall serves two masters" did NOT survive verification as stated and is intentionally not used; the surviving insight is the in-loop-signal = gating-bar fusion.*

---

## 6. Updated "where to start / what is next" (Slide 21 + open-items backup)

### Slide 21 face (R-FWD-1, *modified* — keep it tight, defer specifics to backup)

Keep the verbatim restraint line, the 5 cheapest starters, and the mic-drop. For open/next work, keep **"One honest open item: SessionStart/PreCompact rehydration"** and add **ONE** adjacent forward-looking line at the same altitude:

> *"Plus a short additive backlog, each grown from an observed gap (proposed, not shipped): property tests on the rules engine, runtime a11y in e2e, and a token-aware design-lint rule — detailed in the Q&A backup."*

**Do NOT** enumerate promotion order, per-item evidence, or any count (especially DL-1's ~84, which is an un-verified backlog estimate) on the face. Frame the whole as "proposed next steps, none shipped yet" to preserve the evidence-tier and non-victory-lap conventions.

### Open-items backup slide (R-FWD-2, confirm) — three labeled tiers

- **Tier A — Additive next steps (ready):** **PB-1** fast-check property tests on the rules engine; **A11Y-1** runtime axe-core in e2e on 3–4 key views; **DL-1** token-aware design lint as a measured ratchet (*re-verify the ~84 finding count before quoting it; canvas/VTT hex deliberately scoped OUT, not a gap*); plus the existing **M2** context-budget reporter and **scoped-Stryker survivor summarizer**.
- **Tier B — Open design questions (design-gated, NOT committed roadmap):** **EV-1** codebase-grounded golden-task eval harness (*qualitative only — no invented counts; v1 excludes LLM-judge/OTel/CI gate; no `/evals` suite exists today*); **SEC-1** secret scanning (*placement/tool/block-vs-warn undecided; default-deny egress firewall + cooldown already shipped, which lowers urgency — keep SEC-1's ~45%/~2× vendor stats in the §8/R-FWD-4 source note, not here*); **PR-1** ~300-line diff soft-warn; **GC-1** guardrail-config tripwire.
- **Tier C — Rehydration:** **R11** SessionStart/PreCompact — "the one clean unshipped principle."

### "N/A for a solo repo" footnote (R-FWD-3, confirm)

State explicitly so absences read as scope decisions, not blind spots: classic **CODEOWNERS + required-review** (no second owner — live re-check: no CODEOWNERS file present; this is why **GC-1 is design-gated/possibly unnecessary**, since "agent loosens its own leash" is already covered by `lint:ratchet`, `lint:ratchet:zero-baseline`, and the `no-explicit-any` / `type-assertion-boundary` / `no-llm-artifacts` rules); **merge queue**; **"agent cannot approve its own PR"**; **extended-DORA AI-vs-human metrics**; **OIDC publishing**. For **SEC-1 and PR-1**, a hard pre-commit BLOCK is pure self-friction in a single-author repo, so the defensible framing is **CI warn-first, not a blocking gate**.

### Overclaim guardrails (R-FWD-4, confirm — speaker notes)

(a) **DL-1's ~84** is an un-verified backlog estimate — re-run the count on the day and state the canvas/VTT hex scope-out up front. (b) **EV-1** is exploratory — frame as a "measurement infrastructure direction," explicitly NOT a built `/evals` suite. (c) For **A11Y-1**, a green axe pass is a **floor not "accessible,"** and pre-existing violations need a documented baseline first. (d) **SEC-1's** vendor stats (~45% unprompted, ~2× secret-leak) are **vendor/correlational — never present as peer-reviewed.** (e) Keep **mutation testing OFF the gaps list** — it is parked/scoped (S15), not a gap.

---

## 7. Updated "before presenting" checklist

- [ ] **COR-01** — Slide 16: replace "73 retries" with the single `{ retry: 3 }` story. Re-run `rg 'retry:' packages e2e` on the day.
- [ ] **COR-02** — Slide 8: change citation `MODULE.md:42 → :75`. Re-confirm `index.ts` still absent and the stale facade line still at 75. **This is the live demo — do not skip.**
- [ ] **COR-03** — Slide 12: update `48 → 49 (32 inline / 17 broad)`. Decide whether to footnote the non-zero exit honestly.
- [ ] **COR-04** — Slide 6: lock one MODULE.md definition (38 or 42) and the `find` command; mirror on any tuple restatement.
- [ ] **COR-05** — Slide 16: update `481 → ~495 (54/175/266)`; lock one reproducible `rg`/`find` in notes; keep ~6,500 cases.
- [ ] **OMIT-HOOKS-01** — re-grep `settings.json`: confirm **10** hook command entries before stating the count anywhere.
- [ ] **COR-06** — Slide 15: tag Stryker numbers as the dated 2026-05-08 pilot baseline (16→18 file scope drift noted).
- [ ] Confirm every vendor/correlational or leaderboard number on a face carries its tag (CircleCI 70.8%, Veracode ~45%, GitClear, Chroma 18-model, current SWE-Bench Pro / DeepSWE numbers) and is **visually separated** from peer-reviewed figures (IEEE-ISTAS +37.6%, DORA, SlopCodeBench).
- [ ] Confirm Slide 3 did **not** net-add a sixth bullet (CircleCI in, GitClear detail to notes).
- [ ] Confirm the new **security slide** (OMIT-SEC-01) is placed, and its companion **S19 fourth-category** bullet (OMIT-SEC-02) ships with it.
- [ ] Confirm the relocated-bottleneck thesis (RF-1) reads on the **S13 face** with stats in **notes** (no stat wall).
- [ ] Confirm S17 verify-gate wording is the **scoped** version (four consumers + CI mirror; no "two masters" / "byte-identical to the PR").
- [ ] Q&A backups loaded: METR re-attribution (COR-13), model-economics guards (COR-14), property/contract (OMIT-PROP-01), team-process (OMIT-TEAM-01), orchestration (OMIT-ORCH-01), MCP (OMIT-MCP-01), Faros/Codacy/CodeRabbit review stats (ER-S19-codacy-faros-review).
- [ ] Re-verify **DL-1 ~84 count** before quoting (or do not quote it).
- [ ] Verify all "shipped vs proposed" framing: PB-1/A11Y-1/DL-1/EV-1/SEC-1/PR-1/GC-1 read as proposed/design-gated, not shipped; hooks/sandbox/cooldown read as shipped.

---

## 8. Provenance

### 8.1 Rejected in adversarial verification

**No proposals were rejected** in adversarial verification (`REJECTED PROPOSALS` set is empty). Several proposals were **modified** rather than confirmed; those modifications are already folded into §§2–6 and are listed here for the reader's audit trail, since a "modify" verdict means the proposal-as-originally-written did not survive intact:

| Proposal | Original intent | What was cut/changed in verification (reason) |
|---|---|---|
| **COR-03** | "48→49, script exits non-zero on test-fixture false positives" | "All false positives" overclaimed — one FAIL line is a **deliberate reasoned deprecation-test fixture**, not a regex artifact. Footnote tightened. |
| **COR-04** | Mirror the `1/41/16/40` tuple including on Slide 1 | The tuple lives on **Slide 6**, not Slide 1 (Slide 1 carries only the 1-line CLAUDE.md). Mirror guidance re-scoped. |
| **COR-11** | One bundled speaker-note (judge economics + Factory.ai attribution) | Split into **two** notes (independent corrections; one slide would be overloaded). |
| **ER-S3-circleci** | Add CircleCI as a clean 6th face bullet (priority MUST) | Slide 3 is the deck's densest; **rebalanced** to net-zero (GitClear detail → notes) rather than net-add. |
| **ER-S3-veracode-2026-refresh** | "~45% introduced an OWASP Top 10 vuln" | Must use the corpus's exact **"~45% UNPROMPTED"** framing (introduction-rate ≠ unprompted-rate); keep visually distinct from the peer-reviewed +37.6%. |
| **ER-S19-swebench-pro** | Append to the existing PROVEN row | Placed as a **distinct PROVEN sub-line** so the "problem is measured" and "benchmark non-transfer" categories don't blur. |
| **ER-S19-circleci-cross-ref** | Add CircleCI+Faros tier line | Made **strictly conditional** on the S3 add; Faros +91%/+154% held to notes to avoid importing the omitted review-unit topic. |
| **ER-S19-veracode-gitguardian-tier** | Add Veracode **and** GitGuardian to the DIRECTIONAL face | **GitGuardian moved to notes/Q&A** — security is a deliberate face omission. |
| **OMIT-HOOKS-01** | "11 wired hooks" | Live count is **10** distinct hook command entries; "11" would be caught by a fact-checker. |
| **OMIT-TEAM-01** | "+91% … corroborated by Google DORA 2025" reads as peer-reviewed | **+91% must stay vendor/correlational** (Faros); only the amplifier-with-stability-tax claim is peer-reviewed (DORA). Tags locked on the face. |
| **RF-1** | Named thesis line **plus** two delivery stats on the S13 face | Stats **moved to speaker notes** to avoid a stat wall. |
| **RF-3** | Single long bullet conflating Miller/Guibes framing with the Chroma study | **Tier boundary split** — framing and empirical anchor as separate tagged clauses. |
| **RF-5** | "One wall, two masters; byte-identical to the PR merge gate" | **Overclaim** — CI is a superset fifth consumer (not byte-identical, not among the four), and this is a solo repo. "Two masters" dropped; identity scoped to the four documented consumers. |
| **R-FWD-1** | Enumerate the additive trio with promotion order on the S21 face | Over-stuffs the densest closing slide and risks DL-1's un-verified count on the face; reduced to **one pointer line**, detail deferred to the backup. |

### 8.2 UNVERIFIED proposals (verifier unavailable)

**None.** No kept proposal carried a `verdict.reason` beginning with "UNVERIFIED"; every kept proposal was adversarially adjudicated (confirm or modify) with an accuracy check against the corpus and/or the live repo. **Nothing in §§2–6 requires the inline "(unverified — confirm before presenting)" marker.** The closest thing to a residual human-pass item is operational, not adversarial: the **DL-1 ~84 finding count** is an explicitly un-verified *backlog estimate* (flagged in R-FWD-2/R-FWD-4) and must be re-run before it is quoted on the day — but it never appears on a slide face, so it is a speaker-discipline item, not an unconfirmed recommendation.

---

*Document path: `/workspace/docs/agent_notes/backlog/harness-presentation-2026-06/05-research-update-recommendations.md`*
