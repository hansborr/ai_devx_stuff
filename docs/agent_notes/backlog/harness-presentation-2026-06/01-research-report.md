# Harness / Context / Agentic Engineering — Research Report (Musi as Case Study)

**Date:** 2026-06-13

**Method note.** This report was produced by a multi-agent research workflow: 15 audit-and-research agents (8 auditing the Musi repository, 7 surveying the external 2025–2026 literature), 5 theme synthesizers, 4 adversarial critics, and 1 moderator who reconciled the drafts, independently verified every load-bearing repo number against ground truth, and resolved disagreements. Every numeric claim in this document has been re-grepped against the repository at write time (branch `feat/ux-audit-p0-03-hp-attribution`). Where a figure is directional, vendor-sourced, or single-author, it is tagged inline so the slide author can calibrate its weight. The companion slide outline lives alongside this file; this is the backing document for those slides.

---

## Executive Summary (for leadership)

AI coding agents are now the fastest-growing readers and writers of most codebases — and the single most useful way to think about an agent is as **a brand-new teammate with no memory who shows up dozens of times a day**. That reframe drives three conclusions this report defends with evidence.

**1. Optimizing a codebase for AI is the same work as optimizing it for onboarding a new human.** Readable code, clear module boundaries, short routing-style docs, decision records, and fast feedback help an agent and a new hire for the *identical* reason: both arrive with limited working context and zero prior knowledge of your conventions. This is not a niche AI line item — it is one investment that pays back twice.

**2. Running AI *without* a harness manufactures entropy fast.** The problem is measured: a Carnegie Mellon study of 807 repositories found static-analysis warnings up ~30% and complexity up ~41% after AI adoption, and *persistent*; a peer-reviewed randomized trial showed iterating with AI *without human review* raised critical vulnerabilities 37.6% after five passes. Ungated AI velocity has a short shelf life — you can ship fast and accrue a rewrite-in-two-weeks liability at the same time.

**3. The remedy is harness engineering: feedforward (guides) plus feedback (sensors).** Linting is the cheapest, highest-leverage guardrail — deterministic, sub-second, free per run, and consumed by the agent itself before any human looks. A trustworthy, high-coverage test suite is the behavior-confidence backbone, because line coverage proves code *ran*, not that a bug would be *caught*.

DORA (Google) frames the leadership takeaway precisely: **AI is an amplifier** — it magnifies the discipline of strong teams and the dysfunction of weak ones. The harness decides which way it amplifies you. Musi is a worked, dogfooded example: a 1-line `CLAUDE.md`, an enforced-lean `AGENTS.md`, 18 custom lint rules whose error messages teach the fix, and a test budget tiered so cheap checks run every change while expensive truth runs on a schedule.

---

## (A) Linting as the cheapest, highest-leverage guardrail

### The argument

The field has converged — across independent and often commercially-interested authors — on a clear hierarchy of feedback for coding agents: **deterministic static checks (linters, type checkers) are the cheapest and highest-leverage signal you can give an agent.** They run in milliseconds, cost nothing per run, never flake, and execute *inside the agent's own loop* so it self-corrects before a human ever looks. Factory.ai's slogan captures it: **"Agents write the code; linters write the law"** — agents need machine-verifiable rules, not natural-language suggestions (Alvin Sng, Factory.ai, 2025-09-05).

The companion concept is **backpressure** — "feedback that reaches the agent before it reaches the human." Without it, "the human becomes the compiler, the test runner, the linter... That is not review. That is babysitting" (The Generative Programmer, 2026-06-06). *(Gloss for leadership: "backpressure" = automated pushback in the loop that forces the agent to fix its own work before a person is involved.)*

The eval literature explains *why* deterministic beats an LLM judge for style and structure: sub-millisecond versus 2–5 seconds, reproducible versus flaky ("a JSON parse error is a JSON parse error"), roughly 10× cheaper because the expensive judge only sees the fraction that passes structural checks (Saurav Bhattacharya, dev.to, 2026-06-05 — *author-modeled figures, illustrative*). The single highest-leverage technique *within* linting is making the error message a teaching prompt — "positive prompt-injection at the exact point of failure" (Musi's own harness review; James Phoenix: "Error messages are teaching prompts").

### What Musi does

Musi takes this principle to its conclusion.

- **18 custom ESLint rules** (`eslint-config/local-plugin.js` registers exactly 18 keyed rules; the 19th `.js` file, `trpc-shared-schema-import-collector.js`, is a shared helper, not a rule). They split into exactly three intent categories — **7 maintainability / 6 architecture-fitness / 5 behavior** — confirmed by counting the H3 rule headers per section in `docs/generated/local-lint-rules.md`. The taxonomy maps cleanly onto onboarding: maintainability = readability, architecture-fitness = keep the design from rotting, behavior = catch real bugs. *(If a bigger number is wanted, say "18 bespoke rules on top of ~22 Vitest + ~9 Playwright plugin rules" — never "30+ custom rules.")*

- **Every diagnostic is a mini repair manual.** A convention requires each message to read "Why: `<reason>`. How to fix: `<imperative steps>`." A meta-test — `eslint-rules/message-guidance.test.js` — *lints the lint messages*: it verifies the Why/How shape, that paired-guide paths exist on disk, and that the fix uses an action verb from a curated allowlist that **deliberately omits Delete / Shrink / Suppress because "they tend to steer low-quality fixes."** The repo guardrails its own guardrails.

- **Repair is executable, not just prose.** 5 rules ship runnable codemods (`codemod:trpc-shared-input/output`, `codemod:concurrency-guard`, `codemod:structured-logging-fix`, `codemod:expand-barrel`) and `strict-shared-schemas` ships an autofix that inserts `.strict()`. When the lint says no, the fix is a command — not interpretation the agent has to get right.

- **The standout rules make the thesis concrete.**
  - `no-llm-artifacts.js` bans the AI's own editing scars — `"...existing code..."`, `"rest of the function remains the same"`, `"omitted for brevity"`, `throw new Error("not implemented")` stubs, and TODOs without an issue/PR/roadmap anchor. Source comment: these "should never land in committed code." It deliberately avoids the word "placeholder" so legitimate UI props don't trip it — *strict but tuned, not blunt*.
  - `concurrency-guard.js` (category: behavior, repairKind: codemod) turns a real lost-update race into a lint failure that names the exact locked helper and codemod: "Why: Direct `{delegate}.{method}` bypasses the documented concurrency helper boundary. How to fix: ... Try `bun run codemod:concurrency-guard -- <file>` first. See docs/CONCURRENCY.md."

### The compounding layer: the lint ratchet

The governance layer is what makes quality compound.

- **The ratchet is symmetric.** `scripts/lint-ratchet/lint-ratchet-baseline-compare.ts` fails on *both* sides of drift — regressions (debt up) *and* un-acknowledged cleanups (improvements not locked in). "Debt cannot grow silently, and cleanup cannot go unacknowledged." The only direction the baseline can move is down.
- **The debt log is 100% retirements.** The append-only `lint-ratchet.debt-log.jsonl` has **12 entries, every one a retirement** — a ratchet deleted because normal strict lint finally absorbed it. Read top to bottom, it *is* the monotonic-improvement story: the codebase deleting its own guardrails.
- **Normal lint stays fully strict.** All gates run `eslint . --max-warnings=0` (`scripts/lint.sh:32`), so warnings still fail the gate and entropy can't accumulate silently.
- **Escape hatches carry receipts.** **49 governed `eslint-disable` directives** (per the disable-register, each carrying a required `-- reason`). *(2026-06-15 live re-check via the register script: `total=49 inline=32 broad=17`. A naive grep returns more — cite the governed count, never imply a raw grep yields 49.)*
- **Coverage is inventoried.** A **~230-row coverage map** (`docs/agent_notes/lint-coverage-map.md`, verified 230 table rows) gives every tracked file a declared lint owner — closing the gap where unlinted files silently rot. *(Cite "every tracked file has a declared lint owner" rather than the linted/ratcheted sub-counts, which are not reliably cite-able.)*

### State of the evidence (honest)

The *problem* is well-measured (CMU peer-reviewed; GitClear correlational trend). The *cure* — lint-as-guardrail — is supported by strong logic and practitioner anecdote, not controlled trials. The most cited cure figure, "violations 45%→5% in 4 weeks" (Phoenix), is single-author; keep it off slides or tag it "(illustrative)." Present lint guardrails as a **high-confidence, low-cost bet**, not a proven silver bullet.

---

## (B) Test suite + coverage + mutation = behavior confidence

### The argument

Readable code and cheap lint guardrails handle maintainability and architecture. Tests handle the axis neither can touch: **behavior** — does the code actually do the right thing? Birgitta Böckeler (Thoughtworks) names three regulation dimensions — maintainability, architecture fitness, and behavior — and calls behavior the weakest: "we still have a lot to do to figure out good harnesses for functional behaviour." Musi says the same about itself: **"Behavior confidence is still weaker than maintainability and architecture fitness"** (`docs/ai-harness.md:223`). That honesty is the point — the team names its weakest sensor axis rather than pretending green CI means correctness.

**Coverage is theater.** Line coverage proves code *executed*; it does not prove your tests would *notice* if behavior broke — and AI-written tests make the gap a chasm because AI is excellent at the happy path and poor at adversarial assertions. Lead with Böckeler's reproduced numbers (credible, named source): a file at **100% statement / 75% branch coverage with zero unit tests, 13 mutants surviving.** The punchy restatement — **100% line coverage with a 4% mutation score, 96% of injected bugs surviving undetected** (OutSight AI) — is *one team's internal example, illustrative*, a single practitioner blog; use it as the kicker, not the anchor.

The fix is **mutation testing** — inject deliberate bugs and check whether a test fails. Meta runs this in production: its Automated Compliance Hardening pairs LLM test generation with mutation testing across Facebook/Instagram/WhatsApp and calls mutation testing "the most powerful form of software testing." On steering, the **TDAD** study cut AI-agent regressions ~70% (6.08% → 1.82%) just by telling agents *which* tests to check — and, counterintuitively, telling an agent *how* to do TDD without that context made regressions *worse* (9.94%). The lesson: the test suite is the agent's behavioral contract.

### What Musi does — a managed three-tier budget

Each check is placed where its cost belongs.

- **Fast (in the loop):** ~6,500 product test cases across ~495 files (54 shared / 175 server / 266 client) run per change via diff-aware `test:changed` (`scripts/test-changed.sh`), which **escalates to a full project run** when config/dependency/deletion edits could invalidate unchanged tests — so the cheap path can never produce a false green. High-fidelity yet cheap: server tests hit a real Postgres DB per worker; raising workers 4→6 cut the server suite from ~134s to ~50s, so integration tests stay in the loop.
- **Slow (out-of-band):** the full coverage sweep with strict per-package floors (shared 99% lines, server 93%, client 82%) is a deliberate **weekly weekend ritual**, explicitly forbidden from `verify:changed`/CI (`docs/guides/coverage-cadence.md`) so it never competes with the per-change feedback the agent depends on.
- **Deepest (manual audit):** mutation testing (Stryker) carries a real baseline — **70.25% mutation score, 258 survivors over 1,438 mutants** on `packages/shared/src/rules` (16 of 66 shared files), kept **off the gate by design** (`stryker.config.mjs` sets `thresholds.break: null`; `test:mutation` is absent from the verify steps). Expensive truth lives out-of-band.

**The suite can't lie — enforced by lint, not vigilance.** There are **0 focused / 0 skipped / 0 commented-out tests** across the whole suite, computed by `eslint --max-warnings=0` (vitest `no-focused-tests`, `no-disabled-tests`, `no-commented-out-tests`), not hoped for in review — an agent under deadline pressure physically cannot land a `.only` or a skipped test. Flakes are root-caused, not silenced: a custom rule `local/test-file-location` forces tests to colocate, and the current deck cites **one annotated `{ retry: 3 }`** on a documented crypto-RNG critical-miss flake, with **0 in e2e**. *(A later live re-check superseded the earlier 73-retry figure. Frame as "surgical retry," singular, unless a fresh grep proves otherwise.)*

A representative discipline example: an `encounter-combat-spell` flake was traced to a real 5e rule (natural 1 is a crit miss regardless of bonus, `attack-roll.ts:58`) and fixed with a reasoned `retry: 3` that drops residual flake to ~1e-5 — recorded in `docs/agent_notes/observed_flaky_tests.md` so the next agent doesn't re-chase red herrings.

### The metaphor for leadership

Tests are not overhead that slows delivery — they are **the brake that lets you drive fast.** A race car with better brakes is faster, because the driver can commit to corners. The investment ask: fund the test suite and mutation auditing as the precondition for accepting AI velocity safely.

### Honest limits

Mutation testing covers only 16 of 66 shared files and zero server services (where the highest-risk AI-written domain logic — combat, level-up, spell-casting — lives); a scoped Stryker expansion folded into the existing weekly lane is a genuinely open item. The heavyweight generator/evaluator-agent fix was rejected on cost (Anthropic's ~6hr/$200 figure) in favor of cheaper wins. Behavior confidence remains the industry's unsolved frontier.

---

## (C) The no-harness doom loop — the empirical case

### The mechanism

Without guardrails, AI does not just write a bad line — it **accretes structural entropy that compounds**, until the codebase is unmaintainable even for the AI itself. The presenter's curated panel names the mechanism in two memorable lines:

> "The meme I have is that your codebase regresses to your worst engineer. ... An if/else block 20 deep becomes 'how things are done,' and the AI exponentially grows this slop."
> — vibe-coding panel (youtu.be/0fgJPhYcbVk?t=2727)

> "We tried to build entire products purely by vibe coding ... auto-merge, no code review at all. ... The state-of-the-art in December was about two weeks [before you say] we have to trash this codebase and rewrite it. ... To change the color of a button, it's implemented in 10 different places ... and you forgot one."
> — same panel

Dex Horthy (HumanLayer) names the gap and the self-inflicted-wound character of the loop:

> "Models can't ship. Models can code."

> "The more the model sees a pattern, the more it leaks in, and quality becomes hard. Claude likes to use the useEffect hook ... when you have a useEffect-ordering bug across a distributed network of hooks, it's very hard for Claude to debug." — Horthy

That is why it is a *loop*, not a one-time cost: the slop the agent generates is slop the agent then cannot debug. Jake Nations (Netflix) supplies the conceptual core:

> "Easy doesn't mean simple. Easy means you can add to your system quickly. Simple means you can understand the work you've done. ... AI has destroyed that balance, because it's the ultimate easy button." — Jake Nations, "The Infinite Software Crisis"

### The data (evidence tiers tagged)

The entropy is **evidenced** — a converging correlational trend plus a controlled mechanism study:

- **GitClear** *(vendor, correlational)* — across 211M changed lines, copy-pasted code rose to 12.3% and 2024 was the first year on record where **duplication exceeded refactoring**. GitClear does not label which lines were AI-written. *(Use ONE consistent GitClear metric across the deck — recommend the 12.3% prevalence + "duplication exceeded refactoring for the first time.")*
- **CMU 807-repo study** *(peer-reviewed, MSR'26)* — static-analysis warnings up ~30% and complexity up ~41% after AI adoption, both **persistent**, beyond what codebase growth explains (He et al., arXiv:2511.04427).
- **IEEE-ISTAS RCT** *(peer-reviewed, single-model)* — iterating with AI to "improve" code *without human review* raised critical vulnerabilities **37.6% after five passes**; the named fix is human review between iterations (Shukla/Joshi/Syed, arXiv:2506.11022v2). *(This demonstrates the doom-loop mechanism; say "demonstrated/measured," not "proven.")*
- **Veracode** *(vendor security report)* — 45% of AI-generated code introduced an OWASP Top 10 vulnerability, and **newer/larger models were not safer** — you cannot wait this out with a better model.

### Honesty beat

The speed story is *unsettled* (METR found experienced devs 19% slower in early 2025, then materially softened that to ~−4% / "likely benefits" by Feb 2026 due to selection bias), while the **quality and security debt story is converging** — which is exactly why guardrails are the safe bet regardless of how the speed debate resolves. Most sources here are commercially interested; the real signal is that **independent and often competing authors land on the same conclusions.**

### The reframe (the lever you own)

**Agent = Model + Harness**, where the harness is "everything in an AI agent except the model itself" (Böckeler, Thoughtworks). The harness has two halves: **GUIDES** (feedforward — steer *before* the agent acts: `AGENTS.md`, `docs/guides`) and **SENSORS** (feedback — observe *after* it acts so it self-corrects: linters, type checks, tests). The lever is the harness, not the model: one team's reported measurement (Morph, via the Thoughtworks/Musi review) put a harness swap at ~22 SWE-bench points versus ~1 for a model swap — **directional, not a controlled benchmark**, but the harness > model thesis has corroborating convergence beyond this one number. The first proof and first laugh: Musi's `CLAUDE.md` is literally one line (`@AGENTS.md`).

---

## The central thesis: AI-optimization = onboarding-optimization

**Optimizing a codebase for AI agents is, in practice, the same work as optimizing it to onboard a new human developer** — make it readable, well-organized, maintainable, and eliminate friction and surprises. This is not the speaker's invention; it is the repo's own conclusion and a 2025–2026 convergence across independent authors.

> "AI is not a super-powered developer. It's a new starter with no memory. ... This is how good codebases have been designed for 20 years. What works for humans is also great for AI."
> — Matt Pocock, "How To Make Codebases AI Agents Love" (aihero.dev)

> "The fastest-growing consumer of your codebase is no longer a junior engineer onboarding in their first week. It's an LLM-powered agent. ... The Venn diagram of 'readable to humans' and 'readable to machines' has massive overlap."
> — Tian Pan, "The AI-Legible Codebase" (tianpan.co, 2026-04-13)

John Ousterhout supplies the grounding mechanism: **deep modules** (a simple interface hiding complex implementation) minimize cognitive load on whoever consumes the module — and he argues design matters *more* in the AI era, not less, because AI generates maintainability debt fast. Pocock's prescription maps onto it cleanly: **"You own the interface. AI owns the implementation. Tests keep it honest."** Anthropic's own metaphor reinforces the frame: "engineers working in shifts, where each new engineer arrives with no memory of what happened on the previous shift." Musi codified this as **Principle 10: "Treat the agent as a new teammate with no memory who joins fresh every session."**

### The orientation library — repo grounding

Musi is the living proof, structured exactly like the nested day-one orientation a good org gives a new hire:

- **`CLAUDE.md` is 1 line** (`@AGENTS.md`); **`AGENTS.md` is 41 lines** that route rather than restate ("see `docs/guides/` before tRPC, Prisma, socket... changes"), under a **hook-enforced 250-line cap** (`scripts/doc-length-policy.sh`: "AGENTS.md is loaded into every agent session's context. Keep it compact... by pushing detail into linked docs"). It uses only 41 of 250 lines on purpose — and *shrank* from 54 to 41 since the last review, the opposite of the accreting-failure-log anti-pattern.
- **16 task guides** (`docs/guides/*`), each opening "Use this path when X" — a named recipe for nearly every recurring change.
- **42 module-doc orientation contracts** (38 `MODULE.md` + 4 `*-MODULE.md`) governed by a written charter (`docs/module-docs.md`) answering "where do I start, what owns state, what must not drift?" with required sections and invariants like "`character:updated` emits only after the write commits."
- **`code:intel` / ts-graph** for deterministic cross-file navigation (def / refs / dependents / exports / tests), replacing noisy grep archaeology — the same fast-orientation tooling that onboards a human quicker. Skills are mirrored across `.claude/skills` and `.codex/skills`, so the investment is portable across agent runtimes, not vendor lock-in.

### Deep modules, made structural

`combat-actions.ts` is a **named, logic-bearing facade** that imports **5 siblings** (one — `resolve-attack.js` — providing 2 named exports: `resolveCharacterAttack`, `resolveCustomAttack`) and exposes ~5 entry points over **9 non-test source files**, giving callers one import target. It elegantly reconciles a real sensor conflict: you want one import target (good for callers) but the `no-barrel` rule bans dumb re-export `index.ts` files (which wreck tree-shaking and hide the graph). The answer is a facade that actually *composes*, not a barrel. `services/README.md` codifies a three-tier taxonomy (deep module / flat service / utils) with a "promote when ALL THREE hold" rubric — a folder is *earned*, not defaulted, preventing the shallow-module sprawl agents and junior devs both produce.

### AI makes stale context hurt immediately — and that's the gift (the live bug)

The sharpest, most honest beat — **verified still live and unfixed at write time:**

- `packages/server/src/services/character-live-state/MODULE.md:75` still asserts "`index.ts` is the public facade only," but **there is no `index.ts`** (it was deleted to satisfy `no-barrel`; the directory has **11 non-test source files**).
- The sensor built to catch exactly this — `drift:ai module-doc-paths` — is **`runByDefault: false`** (`scripts/drift-ai/module-doc-paths-check-config.ts:21`), so the drift survived.

This proves two truths at once: **a stale doc an agent will confidently follow is worse than no doc**, and **a sensor you don't run in the loop doesn't protect you** ("build-without-collect"). The spoken line: *"AI is what makes this visible — a human shrugs at a slightly-wrong README; an agent follows it off a cliff, loudly, immediately."* The team's own 2026-06-13 onboarding audit independently flagged the same failure class: "several authoritative docs point at deleted or renamed code" and "a fresh clone cannot reach a running, logged-in app by following the README." Same findings, two lenses (agent-ready and human-onboarding), one codebase. **(Re-verify this bug is still unfixed at talk time; if fixed, reframe as "found and fixed by our own sensor.")**

### The honest caveat (keeps engineers' trust)

The analogy is a **superset, not an identity**: AI-ready ⊇ onboarding-ready. Agents add machine-specific needs (instruction files, deterministic fast feedback) and lack human durability — "comprehension debt," where a codebase can be AI-traversable yet understood by no human, because an agent builds no durable mental model. The shared *goal* (low cognitive load, no surprises) holds; the consumption pattern differs.

---

## Context engineering (subsection)

"Context engineering" is the 2025–2026 discipline of curating the optimal set of tokens an LLM sees at inference time. Anthropic frames the goal as finding **"the smallest possible set of high-signal tokens that maximize the likelihood of some desired outcome."** The motivating problem is **context rot** — Chroma's controlled study of 18 frontier models found *every* model degrades as input grows, even on trivial tasks — explained by a finite "attention budget": more context is not free.

The convergent practices map directly onto Musi's artifacts:

- **Point, don't paste.** A pointer-style session file (`CLAUDE.md` → `AGENTS.md`) loaded upfront, with just-in-time retrieval (grep/glob, `code:intel`) for everything else — exactly Anthropic's hybrid pattern ("CLAUDE.md is naively dropped into context up front, while primitives like glob and grep ... retrieve files just-in-time"). GitHub's study of 2,500+ repos found "most agent files fail because they're too vague"; Musi's enforced 250-line cap and routing style are the low-cost guard against bloat.
- **Retrieve, don't stuff; compact, don't accumulate.** Memory and summarization keep durable state outside the window — the same principle as `DECISIONS.md`, the ADR-lite record whose stated purpose is "so future agents don't relitigate it."
- **The MCP tax.** Naively loading many tool schemas can burn 25–70%+ of a window before any work *(vendor-measured ranges, directional)* — Anthropic's litmus test: "If a human engineer can't definitively say which tool should be used in a given situation, an AI agent can't be expected to do better."

Every primary source here has a commercial angle (Anthropic sells Claude, Chroma sells retrieval). The convergence across competitors is itself the strongest signal — cite each as interested, not neutral.

---

## What this repo does well

- **A written constitution.** `docs/ai-harness.md` names the vocabulary (Guide = feedforward, Sensor = feedback; Computational vs Inferential) and states the **Promotion Rule** (`docs/ai-harness.md:238-248`): every new control ships *all three* — a guide, a sensor, and repair text/codemod — and "Do not add more global instructions to AGENTS.md unless every agent needs them on every session start." This caps bloat while capability grows.
- **One gate, four consumers.** A single 8-step verify matrix (lint, ratchet, zero-baseline, coverage-map, format-check, typecheck, test, scripts) runs **identically** across `verify`, `verify:changed`, `verify:parallel`, and pre-commit, generated from one schema — no "works on my machine" gap for humans or agents.
- **One source of truth, governed.** `harness.controls.json` (**108 controls**) generates the verify matrix, the agent-facing docs, and the Claude/Codex hook wiring, all `--check`'d for drift — the harness polices its own consistency.
- **Signal fusion — the maturity step most teams skip.** Nine tools emit one shared, Zod-validated `HarnessDiagnostics` envelope; `harness:audit` reads them all into one report; `.github/workflows/slow-drift.yml` runs that fused report weekly (cron Monday) as a report-only continuous-monitoring lane. Most teams over-build signal *emission* and under-build *consumption*; Musi built the boring spine.
- **Quality compounds.** The lint ratchet's only direction is down; the 12-entry debt log is entirely retirements.
- **It treats the harness as code.** ~108 controls, 18 custom lint rules, tens of thousands of lines of self-tested harness code (e.g., ~4,900 lines of the ratchet's own tests). The harness that prevents entropy is not itself entropy.
- **It states its own limits.** Behavior confidence is the self-declared weakest axis; the closing principle is verbatim: *"These principles describe a ceiling ... A smaller team should treat that as aspirational, not a starting template. Start with the cheapest, highest-leverage few ... and grow the harness from observed failures, not from this list."*

---

## What's changed / notable since the 2026-05 harness review

The 2026-05-30 review (a 23-sub-agent, multi-phase audit of the harness against the external literature) named three headline self-declared gaps. **All have since shipped** — a concrete "the steering loop actually turns" beat:

- **R9 — signal fusion:** `harness:audit` exists (`package.json:86`, `bun scripts/harness-audit.ts`).
- **R10 — scheduled drift lane:** `.github/workflows/slow-drift.yml` runs weekly (cron `23 9 * * 1`), report-only.
- **R1 / R12 — drift sensors:** `module-doc-paths` and `layer-direction` checks are registered (the former intentionally `runByDefault: false`).

Gaps named on **2026-05-30 → shipped by 2026-06-13** (~2 weeks). Two further markers of self-correction: `AGENTS.md` *shrank* 54 → 41 lines, and a new 2026-06-13 "Codebase Maintainability & Onboarding Audit" reframes the whole effort around "how easy the codebase is for a new developer being onboarded for the first time" — the thesis made operational.

**Genuinely open items (the honest roadmap):**

1. **M2** — an aggregate context-budget reporter (sum the always-loaded tokens across `AGENTS.md` + `CLAUDE.md` + auto-injected); per-file caps exist, the aggregate reporter does not.
2. **task-25** — scoped Stryker mutation expansion to high-value server services + a survivor summarizer, folded into the existing weekly lane.
3. **R11** — `SessionStart` / `PreCompact` rehydration to re-seed load-bearing state at session start (handoff is preserved at session *end* via a Stop hook, but not re-injected at start) — the clearest single unshipped principle, and the cleanest "what's next" headline.

The rest of the corpus's ~25 improvement ideas map to existing R-numbers/backlog leaves and are mostly **Done or Parked-by-design**. Two confirmed-absent items — `lint:ratchet:trend` and a `harness-scorecard` — are **slide-props, not gaps**; do not feature them as deficiencies, as that would undercut the restraint thesis.

---

## External sources (cited)

**Framing / harness vocabulary**
- Birgitta Böckeler, "Harness engineering for coding agent users," martinfowler.com, 2026-04-02 — https://martinfowler.com/articles/harness-engineering.html
- Birgitta Böckeler, "Maintainability sensors for coding agents," martinfowler.com, 2026-05-27 — https://martinfowler.com/articles/sensors-for-coding-agents.html
- Simon Willison, "How coding agents work," simonwillison.net, 2026-03-16 — https://simonwillison.net/guides/agentic-engineering-patterns/how-coding-agents-work/
- Addy Osmani, "Agent Harness Engineering," 2026-04-19 (Trivedy: "Agent = Model + Harness") — https://addyosmani.com/blog/agent-harness-engineering/
- Anthropic (Justin Young), "Effective harnesses for long-running agents," 2025-11-26 — https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Ryan Lopopolo / OpenAI, "Harness engineering," 2026-02-11 *(attribute as OpenAI self-reported and avoid "zero human review"; earlier research saw a transient 403, but a later follow-up found the primary page reachable)* — https://openai.com/index/harness-engineering/

**Linting / deterministic guardrails**
- Alvin Sng, Factory.ai, "Using Linters to Direct Agents," 2025-09-05 — https://factory.ai/news/using-linters-to-direct-agents
- The Generative Programmer, "Stop Babysitting Your Coding Agent. Give It Backpressure.," 2026-06-06 — https://generativeprogrammer.com/p/stop-babysitting-your-coding-agent
- Saurav Bhattacharya, "Deterministic Checks vs Model-as-Judge," dev.to, 2026-06-05 *(author-modeled figures)* — https://dev.to/saurav_bhattacharya/deterministic-checks-vs-model-as-judge-a-tiered-approach-to-agent-evaluation-3217
- James Phoenix, "Custom ESLint Rules for AI Determinism," understandingdata.com, 2026 *(45%→5% is single-author/illustrative)* — https://understandingdata.com/posts/custom-eslint-rules-determinism/
- Teal Larson, "You need a linting config, not just agent instructions," 2026-03-27 — https://www.teallarson.dev/blog/2026-03-27-dont-make-your-agent-file-a-linting-config

**Tests / coverage / mutation**
- Birgitta Böckeler, "Maintainability sensors for coding agents" (reproduced 100% statement / 75% branch / 13 survivors) — see link above
- OutSight AI, "The Truth About AI-Generated Unit Tests: Why Coverage Lies and Mutations Don't," 2025-08-06 *(practitioner blog, illustrative)* — https://medium.com/@outsightai/the-truth-about-ai-generated-unit-tests-why-coverage-lies-and-mutations-dont-fcd5b5f6a267
- Mark Harman, "LLMs Are the Key to Mutation Testing and Better Compliance," Engineering at Meta, 2025-09-30 — https://engineering.fb.com/2025/09/30/security/llms-are-the-key-to-mutation-testing-and-better-compliance/
- Trail of Bits (Larregay), "Use mutation testing to find the bugs your tests don't catch," 2025-09-18 — https://blog.trailofbits.com/2025/09/18/use-mutation-testing-to-find-the-bugs-your-tests-dont-catch/
- Alonso/Yovine/Braberman, "TDAD: Test-Driven Agentic Development," arXiv:2603.17973v2, 2026-03-19 — https://arxiv.org/html/2603.17973v2

**Doom loop / quality + security data**
- He et al., "Speed at the Cost of Quality" (CMU, 807 repos), arXiv:2511.04427, MSR'26 *(peer-reviewed)* — https://arxiv.org/abs/2511.04427
- Shukla/Joshi/Syed, "Security Degradation in Iterative AI Code Generation," IEEE-ISTAS 2025, arXiv:2506.11022v2 *(peer-reviewed, single-model RCT)* — https://arxiv.org/html/2506.11022v2
- GitClear, "AI Copilot Code Quality 2025" *(vendor, correlational)* — https://www.gitclear.com/ai_assistant_code_quality_2025_research
- Veracode, "2025 GenAI Code Security Report" *(vendor)* — https://www.veracode.com/blog/genai-code-security-report/
- METR, "Measuring the Impact of Early-2025 AI..." 2025-07-10 and "We are Changing our ... Experiment Design," 2026-02-24 *(productivity, walked back)* — https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/ ; https://metr.org/blog/2026-02-24-uplift-update/

**Thesis grounding (AI = onboarding) & ROI**
- Matt Pocock, "How To Make Codebases AI Agents Love," aihero.dev — https://www.aihero.dev/how-to-make-codebases-ai-agents-love (video: https://www.youtube.com/watch?v=uC44zFz7JSM)
- Tian Pan, "The AI-Legible Codebase," 2026-04-13 — https://tianpan.co/blog/2026-04-13-the-ai-legible-codebase
- John Ousterhout w/ Gergely Orosz, "The Philosophy of Software Design," The Pragmatic Engineer, 2025-04-09 — https://newsletter.pragmaticengineer.com/p/the-philosophy-of-software-design
- Mark Heath, "Does Code Quality Still Matter in the Age of AI-Assisted Coding?," 2026-03-30 — https://markheath.net/post/2026/3/30/does-code-quality-still-matter
- DORA / Google Cloud, "2025 DORA Report" (AI is an amplifier) — https://dora.dev/insights/balancing-ai-tensions/
- DX (Laura Tacho), "AI-assisted engineering: Q4 impact report," 2025-11-04 *(vendor; 91→49 days is the daily-AI-use cohort, directional)* — https://getdx.com/blog/ai-assisted-engineering-q4-impact-report-2025/

**Context engineering**
- Anthropic, "Effective context engineering for AI agents," 2025-09-29 — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Chroma (Hong/Troynikov/Huber), "Context Rot," 2025-07-14 — https://www.trychroma.com/research/context-rot
- Matt Nigh, GitHub Blog, "How to write a great agents.md (2,500+ repositories)," 2025-11-19 — https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/

**Presenter-curated primary sources (verbatim quotes used above)**
- Vibe-coding panel (worst-engineer meme; two-week trash horizon) — https://youtu.be/0fgJPhYcbVk?t=2727
- Dex Horthy (HumanLayer), "How to Ship Complex Features 10x Faster with AI Agents" — https://www.youtube.com/watch?v=c630qv03i8g
- Jake Nations (Netflix), "The Infinite Software Crisis" — https://www.youtube.com/watch?v=eIoohUmYpGI
- Tom Delalande, "I was wrong about AI coding agents" — https://www.youtube.com/watch?v=S2FbFgUuOkU
- Michal Cichra, "BDD, ADR, PRD, WTF: Capturing Decisions for Humans and AI Alike" — https://www.youtube.com/watch?v=504PvfXou5Y

---

## Appendix: standout repo examples (path → what it demonstrates)

| Path | What it demonstrates |
| --- | --- |
| `CLAUDE.md` (1 line: `@AGENTS.md`) | Size discipline; the most expensive context kept tiny and routing to detail. The first laugh/proof. |
| `AGENTS.md` (41 lines) + `scripts/doc-length-policy.sh` | Pointer-style session file under a hook-enforced 250-line cap; routes, doesn't restate; *shrank* 54→41. |
| `eslint-config/local-plugin.js` | Registers exactly **18** custom rules (7 maintainability / 6 architecture-fitness / 5 behavior). Taste codified as code. |
| `eslint-rules/no-llm-artifacts.js` | A lint rule written specifically to ban the AI's own editing scars — the doom loop made literally enforceable. |
| `eslint-rules/concurrency-guard.js` | A real lost-update race turned into a lint failure that names the locked helper + codemod (Why/How message). |
| `eslint-rules/message-guidance.test.js` | "We lint our own lint messages" — Why/How shape + curated action-verb allowlist (omits Delete/Shrink/Suppress). |
| `scripts/lint-ratchet/lint-ratchet-baseline-compare.ts` | The symmetric ratchet: blocks debt growth AND un-acknowledged cleanup; baseline only moves down. |
| `lint-ratchet.debt-log.jsonl` (12 entries) | 100% retirements — the codebase deleting its own guardrails as strict lint absorbs them. |
| `scripts/lint.sh:32` | `eslint . --max-warnings=0` — warnings are hard failures; advisory severity can't quietly accumulate. |
| `docs/agent_notes/lint-coverage-map.md` (~230 rows) | Every tracked file has a declared lint owner — no silently-unlinted files where entropy hides. |
| `scripts/test-changed.sh` | Diff-aware fast loop that escalates to a full run on config/dep edits — the cheap path can't false-green. |
| `stryker.config.mjs` + `docs/agent_notes/backlog/mutation-testing-stryker.md` | Mutation baseline 70.25% / 258 survivors / 1,438 mutants, off-gate by design (`thresholds.break: null`). |
| `eslint-config/test-configs.js` | Vitest hygiene rules at error → the verified 0 focused / 0 skipped suite, enforced by lint not vigilance. |
| `docs/guides/coverage-cadence.md` | Coverage is a weekly out-of-band ritual, explicitly banned from the edit loop — timing discipline. |
| `packages/server/src/services/combat-actions/combat-actions.ts` | Named logic-bearing facade: imports 5 siblings, ~5 entry points over 9 source files; reconciles `no-barrel`. |
| `packages/server/src/services/README.md` | Three-tier taxonomy + "promote when ALL THREE hold" rubric — a folder is earned, not defaulted. |
| `packages/server/src/services/character-live-state/MODULE.md:75` | **The live, unfixed bug** — claims a deleted `index.ts` facade; catching sensor is `runByDefault: false`. |
| `scripts/drift-ai/module-doc-paths-check-config.ts:21` | `runByDefault: false` — proof that "a sensor you don't run doesn't protect you." |
| `docs/ai-harness.md:238-248` | The Promotion Rule — every control ships guide + sensor + repair; keep AGENTS.md lean. |
| `harness.controls.json` (108 controls) | One authoritative manifest generates verify matrix + agent docs + hook wiring, all `--check`'d for drift. |
| `scripts/harness-audit.ts` + `.github/workflows/slow-drift.yml` | Nine tools, one Zod envelope, one weekly fused report — the signal-fusion step most teams skip. |
| `scripts/verify/steps.generated.sh` | The same 8-step gate across verify / changed / parallel / pre-commit — no "works on my machine" gap. |
| `docs/agent_notes/harness-review-2026-05/05-generic-harness-principles.md:280-286` | The verbatim "ceiling, not a template ... grow from observed failures" closer. |
