# Harness Engineering: Optimizing Your Codebase for AI Is Optimizing It for People

> Slide deck text. 23 slides, ~30 min talk. Audience: engineers AND engineering leadership.
> Final reconciled deck (supersedes the earlier draft). Every numeric claim was verified against the live repo or the moderator's authoritative reconciliation.
> Updated 2026-06-15 from the broader harness-engineering research (see `05-research-update-recommendations.md`): added the Security slide (19), refreshed 2026 evidence (CircleCI, SlopCodeBench, SWE-bench Pro, DeepSWE, Veracode), folded in four sharper framings, and corrected five drifted repo numbers.
> Evidence-tier tags appear on slide faces: **(peer-reviewed)** / **(vendor/correlational)** / **(illustrative)** / **(directional)**.

---

## Slide 1 — Optimizing your codebase for AI is optimizing it for a new hire
**Key message:** An AI coding agent is best understood as a brand-new teammate with no memory who shows up dozens of times a day — so the work that makes a codebase AI-ready is the same work that makes it onboarding-ready.
- A *coding agent* = an LLM plus tools running in a loop (Simon Willison). It joins fresh every session with zero memory of the last one.
- This talk argues three things: (1) AI-ready = onboarding-ready; (2) AI with no guardrails triggers a tech-debt doom loop; (3) the fix is *harness engineering* — guides + sensors, with linting as the cheapest guardrail and tests as the behavior backbone.
- Case study throughout: **Musi**, a D&D 5.5E virtual tabletop (TypeScript / Bun / tRPC / Prisma / React) whose harness was built and dogfooded with AI agents.
**Leadership takeaway:** This is not an "AI line item." The investment that makes agents effective is the same investment that makes new human hires productive faster — one budget, double return.
**Speaker notes:** Set the frame before any jargon. Picture not a 10x engineer but a sharp new hire with amnesia who arrives 20+ times a day. The whole talk's first thesis is that the things you'd do to make *that* person productive are exactly the things that make agents productive — and we'll prove it with a real, dogfooded codebase, not slideware.

---

## Slide 2 — Agenda
**Key message:** Stakes first, then the reframe, then the mechanisms (lint and tests, heavily), then the system and where to start.
- **The stakes** — the doom loop: what AI without a harness does to a codebase.
- **The reframe** — Agent = Model + Harness; AI-ready = onboarding-ready.
- **The mechanisms** — feedforward (orientation docs, deep modules) and feedback (lint as the cheapest guardrail; tests as the behavior backbone).
- **The system, security & the payoff** — composition, constraining what the agent can *do*, honest evidence, ROI.
- **Where to start** — five cheapest, highest-leverage pieces.
**Leadership takeaway:** You'll leave with a fundable, sequenced plan — not a 108-control rewrite.
**Speaker notes:** Keep this to 20 seconds. Flag that lint and tests get the most time because they are the cheapest and the highest-value guardrails respectively, and that we close on a concrete "start here" list.

---

## Slide 3 — The doom loop: AI without a harness manufactures entropy
**Key message:** Without guardrails, AI doesn't just write the occasional bad line — it accretes compounding structural debt until the codebase becomes unmaintainable even for the AI itself.
- The mechanism, verbatim from a vibe-coding panel: *"Your codebase regresses to your worst engineer."* The AI cements the messiest nearby pattern, then *"exponentially grows this slop."*
- The two-week trash horizon (same panel): a fully auto-merged, no-review codebase hit *"we have to trash this and rewrite"* in ~2 weeks; changing a button color meant editing it in 10 places and missing one.
  - The *measured* mechanism behind the anecdote — **SlopCodeBench v2** (arXiv 2603.24755; UW-Madison/WSU/MIT, Mar 2026): across 15 agents, **77%** of trajectories show rising structural erosion and **75.5%** show rising verbosity. **(peer-reviewed)**
- **GitClear** (211M changed lines, 2024 data — cite for the rising-duplication *trend*, not a 2026 magnitude): copy-pasted code rose to 12.3% and 2024 was the first year duplication exceeded refactoring. **(vendor/correlational)**
- **CircleCI 2026** (28M+ workflows): work ships faster but merges slower — median main-branch pipeline success fell to **70.8%**, a 5-year low (vs ~90% historically). **(vendor/correlational)**
- **IEEE-ISTAS RCT**: iterating with AI to "improve" code *without human review* raised critical vulnerabilities **+37.6%** after five passes. **(peer-reviewed)**
- **Veracode** (Spring 2026 GenAI Code Security): AI-generated code carries a known vulnerability **~45% of the time, unprompted** — and newer/larger models were *not* safer, so you can't wait this out with a better model. **(vendor)**
**Leadership takeaway:** Unreviewed AI velocity has a short shelf life. You can be shipping fast and accruing a rewrite-in-two-weeks liability at the same time — speed without a harness is borrowed, not earned.
**Speaker notes:** This is the cold open — stakes before vocabulary. Lead with the "worst engineer" meme and the two-week trash horizon; they land emotionally. Then the tagged stats: GitClear is the converging (2024-vintage) trend, CircleCI 2026 is the freshest delivery-layer proof, IEEE-ISTAS the controlled mechanism, Veracode kills "just wait for a smarter model." Visual: the GitClear crossing-lines chart (duplication rising, refactoring falling). Be honest about tiers on the slide face — that honesty makes the rest credible. **Density guard:** keep ≤4 face stats — push CircleCI's team-tier split (median +15% feature / −7% main; top-5% +85%/+26%; +59% aggregate feature activity) to notes, and never present +59% as the median team's number. SlopCodeBench v2's 14.8% best-agent checkpoint pass rate / no end-to-end solves / 2.3x more verbose and 2.0x more eroded than 473 open-source Python repos are notes-only backups; older v1 figures were 11 models, 80% erosion, 89.8% verbosity, and 17.2% top checkpoint solve. *Debt Behind the AI Boom*'s 24.2%-of-issues-persist is another notes-only backup. (CMU's 807-repo study, +30% warnings / +41% complexity, is a footnote here.)

---

## Slide 4 — Agent = Model + Harness (the lever is the part you own)
**Key message:** Stop arguing about which model is smartest; the *harness* — everything around the model — is the lever you control, and it's the bigger one.
- **Agent = Model + Harness.** The *harness* is "everything in an AI agent except the model itself" (Böckeler, Thoughtworks) — the field-standard vocabulary as of 2026.
- Two halves you'll hear all talk: **GUIDES** = *feedforward* (steer the agent BEFORE it acts: AGENTS.md, docs, conventions). **SENSORS** = *feedback* (observe AFTER it acts so it self-corrects: linters, type checks, tests) — *deterministic enforcement, not probabilistic prompting: a check that fails the same way every time is the one signal the model cannot argue with.*
- The directional hook: one team reported swapping the *harness* moved a SWE-bench score ~22 points while swapping the *model* moved it ~1 — *Morph, via Thoughtworks/Musi review; directional, not a controlled benchmark.* The broader signal is that competing authors converge on harness > model.
- The first proof/laugh: Musi's `CLAUDE.md` is **literally one line** — `@AGENTS.md`. The most expensive context (loaded every session) is kept tiny and routes to detail.
**Repo example:** `CLAUDE.md` (1 line: `@AGENTS.md`); `AGENTS.md` (41 lines that mostly point to `docs/guides/` rather than inline detail).
**Leadership takeaway:** The competitive lever is the harness you build, not the model vendor you pick — and it's the part you actually own, can invest in, and keep when models change. And it matters *more* as models improve, not less: a more capable, more confident agent that gets blocked tries *harder* to route around a boundary — an `eslint-disable`, an `any`, editing the rule file — which is exactly why deterministic, human-owned gates matter more in mid-2026 than a year ago.
**Speaker notes:** Reframe the whole investment conversation here, once. Define guides vs sensors now and reuse the words for the rest of the talk. Put the Morph number on screen but attribute it honestly — it's a hook, not a benchmark; the thesis rests on convergence across rivals (Anthropic, Thoughtworks, OpenAI), not one number. On Morph: public SWE-bench Verified scores (70%+) do not transfer cleanly to harder commercial-code tasks, and current coding leaderboards disagree by harness and dataset: Scale's SWE-Bench Pro public leaderboard has GPT-5.4 xHigh at **59.1%** and Opus 4.6 thinking at **51.9%**; Scale's private commercial set reshuffles to Opus 4.6 thinking **47.1%** vs GPT-5.4 xHigh **43.4%**; DeepSWE reports GPT-5.5 xHigh **70%** vs Opus 4.8 max **58%**; vendor-run SWE-Bench Pro claims put Opus 4.8 **69.2%** vs GPT-5.5 **58.6%**. The point is not to crown a model; it is that benchmark deltas are harness- and corpus-sensitive, so measure the agent against *your* repo. Show the one-line CLAUDE.md live — it gets a laugh and proves the point.

---

## Slide 5 — The thesis: AI-ready = onboarding-ready
**Key message:** The work to make a codebase legible to an agent is the same 20-year-old discipline that makes it legible to a new human — stated once, here.
- *"AI is not a super-powered developer. It's a new starter with no memory… What works for humans is also great for AI."* — Matt Pocock.
- *"The Venn diagram of 'readable to humans' and 'readable to machines' has massive overlap."* — Tian Pan. Both consumers share two constraints: limited working context and zero prior knowledge of your conventions.
- For an agent, the codebase *is* the prompt: it reconstructs context every session via glob and grep and pays per file, so every irrelevant or duplicated file costs tokens, latency, and accuracy — *legible-to-a-new-hire* and *cheap-to-an-agent* are the same property. (Empirically: *context rot* — accuracy degrading as the window fills — is documented across 18 models. **(vendor/correlational)**)
- John Ousterhout: design matters *more* in the AI era, not less, because AI generates maintainability debt fast — deep modules (simple interface, hidden complexity) minimize cognitive load on *whoever* consumes them.
- **DORA 2025** (leadership frame): AI is an *amplifier with a stability tax* — it lifts throughput but **degrades delivery stability** (change-fail, rework) *unless* strong foundations absorb it; it magnifies the strengths of disciplined teams and the dysfunctions of struggling ones. The harness is what buys back the stability the amplifier costs. **(peer-reviewed, large-N industry study)**
**Leadership takeaway:** Funding readable code, tests, and fast feedback is not an overhead tax — it's the multiplier that turns AI from a debt accelerator into a force multiplier, and it pays double by also speeding human onboarding.
**Speaker notes:** This is the thesis statement; say it plainly and only here. The strength of the claim is convergence: three independent authors plus DORA land in the same place. The honest caveat (raise it briefly, park the detail): AI-ready is a *superset* of onboarding-ready — agents add machine-specific needs and, unlike a human, build no durable mental model ("comprehension debt"). The shared goal — low cognitive load, no surprises — holds.

---

## Slide 6 — The orientation library: pointer at the top, recipes below
**Key message:** Musi's feedforward system is a nested day-one orientation — a one-line entry file, a 41-line pointer, then recipes and contracts — exactly what you'd hand a new hire.
- `CLAUDE.md` (1 line) → `AGENTS.md` (41 lines that *route*, e.g. "see docs/guides/ before tRPC, Prisma, socket… changes") → **16 task guides** → **42 module-doc orientation contracts** (38 `MODULE.md` + 4 `*-MODULE.md`) → `code:intel` graph CLI.
- Compactness is *enforced, not hoped*: a hook caps `AGENTS.md` at 250 lines — rationale baked in: "loaded into every agent session's context… push detail into linked docs." It's at 41, deliberate headroom.
- MODULE.md files answer three questions a senior dev would brief a newcomer on: *where do I start, what owns state here, and what must not drift?*
- This grounds the field consensus: keep always-loaded context to "the smallest possible set of high-signal tokens" (Anthropic); GitHub's 2,500-repo study found most agent files fail by being *too vague*. **(vendor studies)**
**Repo example:** `AGENTS.md` (41 lines) + `CLAUDE.md` (`@AGENTS.md`) under `scripts/doc-length-policy.sh` (250-line budget), routing to 16 `docs/guides/*.md` and 42 module docs (38 `MODULE.md` + 4 `*-MODULE.md`) governed by `docs/module-docs.md`.
**Leadership takeaway:** A short routing-style top doc plus an indexed library of recipes is cheap to build and compounds: every new hire and every agent session starts oriented instead of lost.
**Speaker notes:** Walk the nesting top-down and tie each rung to onboarding — a good README routes you, it doesn't dump everything; a senior hands you a recipe for common tasks; module docs tell you where state lives. The punchline that lands with both audiences: the most expensive context is treated like scarce memory, with a machine-enforced budget, and the team used only 41 of 250 lines on purpose.

---

## Slide 7 — Deep modules: one interface for humans and agents alike
**Key message:** A deep module — a thin interface hiding complex implementation — minimizes cognitive load on whoever consumes it, and that consumer is now equally a human and an agent.
- Ousterhout's deep-module principle, made structural: one named, logic-bearing facade gives callers a single import target while the complexity stays hidden.
- `combat-actions.ts` is that facade: it imports **5 siblings** (one providing 2 named exports) and exposes **~5 entry points** over **~9 internal source files** — composing them, not just re-exporting.
- It elegantly resolves a real sensor conflict: you want one import target, but the `no-barrel` lint rule bans dumb re-export `index.ts` files (they wreck tree-shaking and hide the dependency graph). A *logic-bearing* facade passes; a barrel doesn't.
- A folder is *earned, not defaulted*: `services/README.md` codifies a three-tier taxonomy (deep module / flat service / utils) with a "promote when ALL THREE hold" rubric — preventing both junior-dev sprawl and agent slop.
**Repo example:** `packages/server/src/services/combat-actions/combat-actions.ts` (named facade) reconciled with `eslint-rules/no-barrel.js`, governed by the rubric in `packages/server/src/services/README.md`.
**Leadership takeaway:** Clean module boundaries aren't aesthetic — they're a cost-control lever. Bad structure makes AI accelerate complexity *and* burns tokens; good structure makes both human comprehension and agent cost cheaper.
**Speaker notes:** This is the engineer-credibility slide. The unifying insight (Pocock, grounded in Ousterhout): the interface is what a human OR agent must understand; the implementation is what they can ignore. Use combat-actions as the worked example of resolving the one-import-target vs no-barrel tension with a real facade, not a barrel. The ALL-THREE promotion rubric is the where-does-code-go contract that stops sprawl.

---

## Slide 8 — AI makes stale context hurt immediately — and that's the gift
**Key message:** A missing, stale, or lying doc that a human might tolerate, an agent will confidently follow off a cliff — so AI turns "docs rot" into a visible, fixable defect class instead of silent decay.
- **Live, unfixed bug (shown on screen):** `character-live-state/MODULE.md` line 75 still claims *"`index.ts` is the public facade only"* — but that file was deleted to satisfy `no-barrel`. The doc now lies; 11 source files exist; routers reach in directly.
- The sensor built to catch it (`drift:ai module-doc-paths`) runs **report-only by default** (`runByDefault: false`) — so the drift survived. Proof of two truths at once: *stale docs are worse than none*, AND *a sensor you don't run in the loop doesn't protect you*.
- The remedy is to *sense the rot*: feedforward docs get paired feedback sensors (`harness-freshness`, `module:index:check`, `module-doc-paths`) so they can't silently lie.
- The team's own 2026-06-13 onboarding audit independently flagged the same class: "several authoritative docs point at deleted or renamed code."
**Repo example:** `packages/server/src/services/character-live-state/MODULE.md:75` (asserts an `index.ts` facade that no longer exists), cross-checked against `docs/agent_notes/backlog/codebase-audit/00-report.md`.
**Leadership takeaway:** Treating context (READMEs, module docs, setup paths) as a maintained, sensor-checked asset is the same hygiene that prevents new-hire confusion — and AI gives you a free, continuous test of whether that context is actually true.
**Speaker notes:** Show the real open wound; don't cherry-pick. The spoken line to deliver: *"AI is what makes this visible — a human shrugs at a slightly-wrong README; an agent follows it off a cliff, loudly, immediately."* Then flip to the optimistic close: that loudness converts slow silent doc-rot into a fast, fixable signal. (Re-verify before the talk; if the bug is fixed, reframe as "found and fixed by our own sensor.")

---

## Slide 9 — Linting is the cheapest unit of feedback in the loop
**Key message:** Deterministic static checks are the highest-leverage guardrail because they're fast, free per run, never flake, and the agent self-corrects against them before a human ever looks.
- *"Agents write the code; linters write the law."* Agents need machine-verifiable rules, not natural-language suggestions (Factory.ai). **Prose in `AGENTS.md` is a probabilistic nudge; a non-zero exit code is a contract** — the agent can ignore a suggestion in a doc, but it cannot ignore a failing gate.
- Deterministic vs LLM-judge for style/structure: <1ms vs 2–5s, reproducible vs flaky ("a JSON parse error is a JSON parse error"), roughly **10x cheaper**. **(illustrative, author-modeled)** Never spend a model call deciding whether an import is allowed.
- **Backpressure** *(definition):* feedback that reaches the agent before it reaches the human. Without it, "the human becomes the compiler, the test runner, the linter — that is not review, that is babysitting."
- Severity is engineered so "warn" is never an escape hatch: every gate runs `eslint . --max-warnings=0`, so advisory findings still fail the gate and can't quietly accumulate.
**Repo example:** All Musi gates run `eslint . --max-warnings=0` (`scripts/lint.sh:32`).
**Leadership takeaway:** The same quality check that costs an LLM-judge dollars and seconds costs a linter nothing and milliseconds — and runs on every edit. This is the highest return-per-dollar control you can buy.
**Speaker notes:** Reframe the audience's instinct that lint is nagging. The cost curve is the leadership hook: correction in the agent loop costs cents and seconds; in human review it's expensive and slow; in production it's very expensive. Lint pushes correction all the way left. Define "backpressure" in one clause and reuse it. On the cost figure: keep "<1ms vs 2–5s, ~10× cheaper" tagged *illustrative/author-modeled*, and remember **cost is the weakest of the three arguments** — the load-bearing case is reliability (a deterministic check can't drift) and that an LLM-judge carries position/verbosity/self-preference bias needing calibration to human labels (Cohen's κ ≥ 0.6) before it can gate. Attribute "linters write the law" to Factory.ai (vendor advocacy), with Montes's "Lint Against the Machine" as co-source — emerging advocacy, not a measured marginal-lift result.

---

## Slide 10 — 18 invariants the team refuses to re-explain
**Key message:** Musi encodes its taste, architecture, and hard-won bug knowledge as 18 custom lint rules in three intent categories — the same list you'd want a new hire to internalize, enforced identically on humans and agents.
- **18 hand-authored local ESLint rules**, split into exactly 3 intent categories: **7 maintainability / 6 architecture-fitness / 5 behavior**.
- The taxonomy maps cleanly to onboarding: *maintainability* = readability, *architecture-fitness* = keep the design from rotting, *behavior* = catch real bugs.
- Each rule carries a typed metadata contract (principle, category, paired guide, repair kind) re-projected into a human catalog AND an agent-readable JSON envelope — **one source, four audiences**: human reader, editor squiggle, CI gate, agent.
- These aren't off-the-shelf configs; they're bespoke invariants a human team agreed on, now machine-enforced for every contributor. (For scale: 18 bespoke rules sit on top of ~22 Vitest + ~9 Playwright plugin rules.)
**Repo example:** `eslint-config/local-plugin.js` registers 18 rules; `docs/generated/local-lint-rules.md` is auto-generated and grouped 7/6/5; `scripts/lint-agent.ts` re-projects the same metadata into a machine-readable diagnostics envelope.
**Leadership takeaway:** Eighteen things this team will never have to re-explain in a code review or a Slack thread again — the cost was paid once; the enforcement is free forever.
**Speaker notes:** Lead with the countable number — 18 — and the 7/6/5 split, because it makes "taste codified as code" concrete. *Hard checklist item before the talk: re-grep and say 18, never "30+" or "17."* The "one source, four audiences" point is the bridge back to the thesis: the same artifact onboards the human and steers the agent.

---

## Slide 11 — Every error message is a mini repair manual
**Key message:** The highest-leverage technique in linting is making the failure *teach the fix* — Musi enforces a "Why / How to fix" shape on every diagnostic, ships executable repairs, and even lints its own lint messages.
- Lead example — **`no-llm-artifacts`**: a rule that exists specifically to clean up after AI. It bans committed editing scars (`...existing code...`, "omitted for brevity"), `not implemented` stubs, and unanchored TODOs. Message: *"Remove this leftover editing note. Restore the real code or delete the comment."*
- Deeper example — **`concurrency-guard`**: a real lost-update race turned into a lint failure that names the exact locked helper AND a codemod (`bun run codemod:concurrency-guard`) AND links `docs/CONCURRENCY.md`. Detection + repair in one diagnostic.
- The meta-test punchline — **"we lint our own lint messages"**: a test requires every diagnostic to read *"Why: … How to fix: …"* with an action verb from a curated allowlist that *deliberately omits* Delete/Shrink/Suppress "because they steer low-quality fixes."
- Repair is executable, not prose: 5 rules ship runnable codemods, 1 ships an autofix.
**Repo example:** `eslint-rules/no-llm-artifacts.js` (the rule that cleans up after AI); `concurrency-guard.js:113` (bug + codemod + doom-loop tie); `eslint-rules/message-guidance.test.js` (the meta-test).
**Leadership takeaway:** A guardrail that only says "no" creates rework; a guardrail that says "here's the exact fix command" creates throughput — and a test enforces that ours always do the latter.
**Speaker notes:** `no-llm-artifacts` is the funny, on-thesis crowd-pleaser — a guardrail written specifically because AI agents leave these exact tells; show the verbatim message. Then concurrency-guard proves the rules carry deep domain bug-knowledge, not just style. The meta-test is the "we guardrail the guardrails" moment, and the verb allowlist shows the team has an opinion about which fixes produce good agent behavior — encoded as a tested invariant. (`no-async-array-callbacks` lives on a backup slide if asked.)

---

## Slide 12 — Debt that only moves one way: the lint ratchet
**Key message:** A symmetric ratchet drives selected legacy debt monotonically to zero without ever blocking forward work — the baseline can only go down — and escape hatches carry greppable receipts instead of silent disables.
- **Symmetric gate:** it fails on regressions (debt up) AND on un-acknowledged cleanups (improvements not locked in). "Debt cannot grow silently, and cleanup cannot go unacknowledged." The only direction the baseline moves is *down*.
- The append-only debt log's **12 entries are ALL retirements** — ratchets deleted because normal strict lint finally absorbed them. Read top-to-bottom, it *is* the monotonic-improvement story: the codebase deleting its own guardrails.
- Escape hatches with receipts: **49 governed `eslint-disable` directives** (32 inline / 17 broad, per the disable-register, each carrying a required `-- reason`) — you can't even paste the placeholder reason.
- Coverage is itself tracked: a ~230-row coverage map gives **every tracked file a declared lint owner** — answering "is anything silently unlinted?", which is exactly where AI-generated entropy hides.
**Repo example:** `scripts/lint-ratchet/lint-ratchet-baseline-compare.ts` (the symmetric gate); `lint-ratchet.debt-log.jsonl` (12 retirement entries); `docs/generated/lint-coverage-map.md` (~230-row owner inventory).
**Leadership takeaway:** This is what "compounding quality" looks like operationally: the standard tightens over time, debt only decreases, and not one commit is ever blocked waiting for a cleanup.
**Speaker notes:** This is the leadership payoff of the lint block. Animate the two failure arrows (debt up = blocked; cleanup not locked in = blocked) and the one escape (the update lowers the floor). Read one debt-log line aloud — it's the codebase deleting its own guardrails because the strict default finally swallowed them. *On numbers: "49 governed directives (32 inline / 17 broad) per the disable-register" — never imply a raw grep yields the number. The register currently exits non-zero on a couple of register-internal fixtures (a string literal containing `eslint-disable` in a test, plus a deliberate reasoned deprecation-test fixture) — these are not ungoverned disables; re-run `scripts/eslint-disable-register.sh` on the day.*

---

## Slide 13 — Behavior is the hardest axis — and the one tests own
**Key message:** Of maintainability / architecture / behavior, behavior (does it actually do the right thing?) is the weakest and most valuable, and tests are the only sensor for it.
- Böckeler (Thoughtworks) names three regulation dimensions; behavior is explicitly the unsolved one: *"we still have a lot to do to figure out good harnesses for functional behaviour."*
- Musi says the same about itself, in writing: *"Behavior confidence is still weaker than maintainability and architecture fitness."*
- Lint and readable code cover maintainability and architecture; neither can tell you the code is *correct*. Only tests re-derive intent.
- **The bottleneck didn't disappear — it *relocated*:** from writing code to comprehending, trusting, and merging it. Generation got cheap; the scarce resource is now human verification per merge — and behavior is the axis tests own. AI is excellent at the happy path, terrible at thinking like a skeptic.
**Repo example:** `docs/ai-harness.md:223` — the team self-declares behavior confidence its weakest harness axis, in the same document that maps all its guides and sensors.
**Leadership takeaway:** The expensive failures in production are behavior failures, not style failures. Tests are the only control that defends the axis where the costly bugs live.
**Speaker notes:** This sets up the whole tests block — the axis the previous two blocks can't touch. Don't oversell: say plainly that the industry considers behavior verification unsolved. That honesty (an external authority and the repo's own self-assessment agreeing) is what makes the rest land. Note the spelling: **Böckeler**. The newest delivery data fits the relocation (keep in *notes*, not on the face, to avoid a stat wall): feature-branch throughput up but main-branch pipeline success at a 5-year low (~70.8%, CircleCI 2026 — vendor/correlational); PR review time up ~91% (Faros AI, directionally corroborated by Google's DORA 2025 — vendor/correlational). Seed a one-clause callback on the payoff slide.

---

## Slide 14 — Coverage is theater: code ran does not mean bugs would be caught
**Key message:** Line coverage proves code executed; it does not prove your tests would notice if behavior broke — and AI-written tests make that gap a chasm.
- Lead with credible reproduced numbers — **Böckeler**: a file at **100% statement / 75% branch coverage** that had **zero unit tests** and left **13 mutants alive**. **(named practitioner, reproduced)**
- The illustrative kicker — **OutSight AI**: 100% line coverage with a **4% mutation score** — every line ran, 96% of injected bugs survived undetected. *One team's internal example; illustrative.*
- AI is great at happy-path tests and bad at adversarial assertions — exactly the tests that catch real regressions.
- So coverage % is a *false KPI* for an AI-written suite; you need a sensor that audits whether the tests have teeth.
**Repo example:** `vitest.config.ts:10-45` — Musi keeps strict coverage floors (shared 99% / server 93% / client 82% lines) but treats them as a floor to maintain, *not* proof of correctness; mutation testing is what audits the tests' catching power.
**Leadership takeaway:** If we report line coverage as our quality number, we are buying a false sense of safety. Green CI at 90% coverage can still ship a suite that catches almost nothing.
**Speaker notes:** Lead with Böckeler's reproduced numbers so the engineering half trusts it, then use OutSight's 100%/4% as the punchy restatement, explicitly tagged illustrative. The point isn't "coverage is useless" — Musi still enforces strict floors — it's "coverage alone is not behavior confidence." Guard: do **not** cite a bare "34% mutation" number — the circulating "93%/34%" framing isn't in the cited ploeh.dk post and has no traceable primary source; if used at all, restate as a ~34-*point* gap between a ~58.6% baseline and a ~93% post-work mutation score on one documented run, never a standalone score.

---

## Slide 15 — Mutation testing: the test for your tests
**Key message:** Mutation testing injects deliberate bugs and checks whether a test fails — it's the proof-of-work that a (largely AI-written) suite actually catches regressions.
- Musi wires **Stryker** with a real baseline (a dated **2026-05-08 pilot**, scope since drifted 16→18 rules files — so a fresh run won't reproduce it exactly): **70.25% mutation score, 258 survivors over 1,438 mutants** on `packages/shared/src/rules`.
- Four statuses give precise signal: *Killed* (test caught it), *Survived* (test ran but missed it = theater), *NoCoverage*, *CompileError*. Survivors quantify the behavior-confidence gap honestly — a sensor working, not a failure.
- Kept **off the gate by design** (`thresholds.break: null`; absent from the verify steps) — expensive truth lives out-of-band, not in the edit loop.
- Industry validation: **Meta** runs LLM test-generation + mutation testing in production, calling mutation testing "the most powerful form of software testing."
- The suite *can't lie*: **0 focused / 0 skipped / 0 commented-out tests** across the whole suite — enforced by lint, not vigilance. An agent physically cannot land a `.only` or a disabled test.
**Repo example:** `stryker.config.mjs` (mutate scope `packages/shared/src/rules/**`, `thresholds.break: null`) + the baseline in `docs/agent_notes/backlog/mutation-testing-stryker.md`.
**Leadership takeaway:** Mutation score, not line coverage, is the honest measure of whether tests protect us — the audit that tells us which AI-written tests are real and which are decoration.
**Speaker notes:** Make the mechanism vivid: comment out a line — do the tests still pass? If yes, that test is decoration. Present the 258 survivors as the sensor doing its job. Stress the budgeting decision: deliberately not a gate because it's slow, and a slow gate would poison the fast loop — same timing discipline as coverage. The 0/0/0 fact lands here as "the suite can't lie." Frame mutation-over-coverage as a 2026 *framing*, not new tooling — Stryker's Vitest runner shipped in 2023; present it (and fast-check / Pact / Playwright, if asked) as *more valuable under AI, not newer*. Avoid implying any mutation-score threshold (70%, 93–100%) is an industry standard — those round numbers are untraceable; Musi's measured 70.25% is the repo fact, and it's the dated pilot baseline, not a live re-run.

---

## Slide 16 — The managed test budget: the brake that lets you drive fast
**Key message:** Three tiers, each placed where its cost belongs — fast tests per-change in the loop, coverage weekly out-of-band, mutation as a deep audit — so behavior confidence is high without slowing the edit loop.
- **Fast loop:** ~6,500 product test cases across ~495 files (≈54 shared / 175 server / 266 client) run per-change via diff-aware `test:changed`, which *escalates* to a full project run when config/dependency edits could invalidate unchanged tests — so the cheap path can never produce a false green.
- High-fidelity yet cheap: server tests hit a real Postgres DB per worker; raising workers 4→6 cut the server suite ~134s → ~50s — integration tests stay in the loop *because* they're fast.
- **Out-of-band by design:** coverage is a weekly weekend ritual, explicitly forbidden from `verify:changed`/CI; mutation testing is a manual audit. Expensive signals don't compete with fast feedback.
- Flakes are root-caused, not silenced: **surgical retries** — a single annotated `{ retry: 3 }` on a documented crypto-RNG critical-miss flake, 0 in e2e — never blanket-retried, never disabled tests.
- **TDAD** evidence: giving agents the right tests to check cut regressions **~70%** (6.08% → 1.82%); telling an agent *how* to do TDD without naming *which* tests made it worse. The lesson: the test suite is the agent's behavioral contract. **(peer-reviewed)**
**Repo example:** `scripts/test-changed.sh` (diff-aware fast loop with escalation) + `packages/server/src/test/test-database-url.ts` (real-DB integration kept fast) + `docs/guides/coverage-cadence.md` (coverage deliberately out-of-band).
**Leadership takeaway:** Tests are not overhead that slows delivery — they are the brake that lets you drive fast. The ask: fund the test suite and mutation auditing as the precondition for accepting AI velocity safely.
**Speaker notes:** Land the metaphor: a race car with better brakes is faster, because the driver can commit to corners. Tie the tiering to timing discipline — fast checks in the loop, slow/expensive ones out-of-band. The TDAD result is the steering evidence: name the right tests and agent regressions drop ~70%.

---

## Slide 17 — It's a system, not a pile of tools
**Key message:** Guides + sensors + the Promotion Rule + a timing model compose into one self-reinforcing loop that can't grow lopsided.
- Musi names the model in-repo: *Guide = feedforward, Sensor = feedback, Computational (deterministic) vs Inferential (LLM)* — straight from the field's standard vocabulary.
- The keystone is the **Promotion Rule**: every new control ships **all three** — a guide (the path), a sensor (detects drift), AND repair text/codemod (how to recover) — or it doesn't ship. This caps the failure modes (feedback-only agents repeat mistakes; feedforward-only never learn if the rule worked).
- It also caps bloat: "Do not add more global instructions to AGENTS.md unless every agent needs them every session" — the harness grows in capability without growing context cost.
- The same **8-step verify gate** (lint, ratchet, zero-baseline, coverage-map, format-check, typecheck, test, scripts) is the agent's in-loop self-correction signal AND the bar that gates the change — byte-identical across all four consumers (local, changed, parallel, pre-commit) and mirrored by the CI run on main. The agent fixes against the *exact* check that later blocks the change, so its in-loop feedback is the merge bar, not a softer proxy.
- **Hooks are a shipped third sensor surface** (deterministic, in-loop): **10** wired hook commands — PreToolUse *hard-blocks* (e.g. `no-direct-db`, protected-files) plus PostToolUse *advisories* (doc-length, lint-coverage, ratchet-regression, tidy-on-edit) that re-prompt the agent after an edit (they can't revert it) and a Stop reminder. Only SessionStart/PreCompact rehydration is genuinely open.
- **The steering loop turns:** gaps named in the 2026-05-30 review (fusion consumer, scheduled drift lane, doc-path/layer sensors) were all *shipped* by 2026-06-13.
**Repo example:** `docs/ai-harness.md:238-248` (the written Promotion Rule) + `scripts/verify/steps.generated.sh` (one 8-step matrix, four consumers, generated from one schema).
**Leadership takeaway:** A harness isn't a checklist of tools you buy — it's a discipline you enforce once (every control ships steering + detection + a fix) so quality controls stay complete and don't decay into nags people ignore.
**Speaker notes:** Zoom out: the previous slides gave the parts; the value is the composition. Read the Promotion Rule aloud — it's the most quotable artifact tying the talk together. The dated review→ship delta is concrete proof for leadership that the harness self-corrects: it named its own gaps and closed them in ~2 weeks.

---

## Slide 18 — Timing + fusion: cheap in the loop, expensive on a schedule
**Key message:** Most teams over-build signal *emission* and under-build *consumption*; the maturity move is fusing every signal into one report on the cadence each check deserves.
- Cheap deterministic checks run in the edit loop on every change; slow, judgment-heavy checks run on a schedule. Fast iteration AND safety — not a tradeoff.
- **9 tools speak one structured dialect** (a shared diagnostics envelope) so one weekly report fuses them all into the drift sensor no single diff reveals.
- **Drift** *(definition):* gradual erosion — coupling creep, duplication, stale docs, layer-direction violations — that no individual commit looks guilty of, but the trend does.
- The continuous lane runs the fused report weekly, **report-only** (it summarizes, never gates). Mirrors the field: Böckeler's three cadences (session / CI / scheduled) and OpenAI's recurring "garbage collection" refactoring PRs.
**Repo example:** `scripts/harness-audit.ts` (the fusion consumer reading the shared envelope) + `.github/workflows/slow-drift.yml` (weekly cron that writes the fused report).
**Leadership takeaway:** Put cheap checks where they're felt instantly (the edit loop) and expensive checks where they don't tax delivery (a weekly background lane). You get fast iteration AND a standing early-warning system — without choosing one or the other.
**Speaker notes:** Lead with the leadership insight ("over-build emission, under-build consumption") — it's sharp and graspable by non-engineers. Keep the plumbing to one bullet: 9 tools, one dialect, one report. No cron syntax on the slide. Define "drift" in a single clause. The point is that the boring spine (one envelope, one consumer, one weekly report) is what most teams skip.

---

## Slide 19 — Security: constrain what the agent can DO, not what it reads
**Key message:** Prompt injection is an architectural fact, not a model bug — so you constrain the agent's *capability*, not its input. It's the same deterministic-enforcement discipline as lint and tests, applied where the stakes are highest.
- **The Rule of Two (lethal trifecta):** never let one unsupervised agent hold all three of *untrusted input*, *secret credentials*, and *egress*. Two is safe; three is an exfiltration tool. *(Willison; Meta "Practical AI Agent Security" — named-practitioner.)*
- **Deterministic controls beat model self-policing — and Musi already ships two:** a default-deny egress allowlist sandbox (`.devcontainer/init-firewall.sh` flips `OUTPUT` policy to `DROP`, breaking the exfiltration leg) and a **7-day dependency-install cooldown** (`bunfig.toml` `minimumReleaseAge=604800`) that filters smash-and-grab supply-chain attacks — including slopsquatting, where frontier models still hallucinate package names **~4.6–6.1%** of the time. **(peer-reviewed, arXiv 2605.17062)**
- **Assume AI code is insecure:** it introduces a known vulnerability **~45% of the time, unprompted (vendor: Veracode)** and leaks secrets at **~2× the human rate (vendor: GitGuardian)**. The one named *open item* is secret scanning at the merge gate (**design-gated, not yet shipped**).
**Repo example:** `.devcontainer/init-firewall.sh` (default-deny egress + `allowed-domains` ipset) and `bunfig.toml` (`minimumReleaseAge = 604800`); secret scanning tracked as a backlog item, not a shipped control.
**Leadership takeaway:** The highest-stakes instance of the whole talk's thesis: you don't ask the model to police itself, you *remove the capability* to do harm — and two of the three controls here are already dogfooded, at near-zero ongoing cost.
**Speaker notes:** This is the deck's one security slide and it answers a question a security-minded leader is already asking. Frame it strength-first (two of three bullets are live wins), keep the vendor tags visible (Veracode ~45% and GitGuardian ~2× are vendor/correlational, NOT peer-reviewed), and name secret scanning honestly as the open item. Tie back to Slide 9: a sandbox is the same idea as `--max-warnings=0` — a deterministic wall the model can't argue with. Pairs with the new fourth honesty category on the next slide (prompt injection is *architecturally* managed, not "cured").

---

## Slide 20 — What's proven vs. what's directional
**Key message:** Be honest about evidence tiers: the *problem* is rigorously measured; many *cure* stats are vendor/anecdotal; and behavior confidence is industry-unsolved.
- **PROVEN — the problem is measured:** CMU 807-repo study (warnings +30%, complexity +41% post-adoption, persistent) **(peer-reviewed)**; IEEE-ISTAS RCT (+37.6% critical vulns over 5 unreviewed iterations) **(peer-reviewed, single-model RCT)**.
- **CURRENT EVIDENCE — benchmark wins don't transfer cleanly:** Current coding leaderboards move sharply with harness and dataset: Scale SWE-Bench Pro public has GPT-5.4 xHigh **59.1%** vs Opus 4.6 thinking **51.9%**; Scale's private commercial set reshuffles to Opus 4.6 **47.1%** vs GPT-5.4 **43.4%**; DeepSWE reports GPT-5.5 **70%** vs Opus 4.8 **58%**. Distrust leaderboards; measure the agent against *your* repo. **(leaderboards/vendor, current)**
- **DIRECTIONAL — vendor/anecdotal:** GitClear (correlational, 2024-vintage, doesn't label which lines were AI-written); CircleCI 2026 70.8% main-branch (large-N but vendor delivery telemetry — relocation, not a causal AI-quality result); Veracode ~45%-unprompted **(vendor/correlational)**; OutSight 100%/4% (a practitioner blog); Morph 22-vs-1 (one team's reported measurement); "45%→5% violations in 4 weeks" (single-author, illustrative — a separate remediation claim, *not* the same datapoint as Veracode's 45%).
- **ARCHITECTURALLY MANAGED, not "cured":** prompt injection has no model-level fix yet has reliable *deterministic* controls (Rule of Two, sandbox, default-deny egress, cooldown) — a fourth category, neither a directional cure nor an honest gap. CaMeL (arXiv 2503.18813) is the high-confidence proof that structure beats self-policing. **(peer-reviewed)**
- **HONEST GAP:** behavior confidence is unsolved industry-wide; deterministic sensors carry maintainability and architecture, correctness stays hard. The lint/test *cure* is a high-confidence, low-cost bet — not a proven silver bullet.
- One line on credibility: *most sources here are commercially interested; the signal is that independent and often competing authors (Anthropic, Thoughtworks, OpenAI) converge on the same conclusions.*
**Leadership takeaway:** We're not selling a silver bullet. The rigorous evidence measures the risk; the guardrails are the cheapest, most reversible bet that pays back regardless of how the speed debate resolves.
**Speaker notes:** This single honest slide does triple duty: proven-vs-directional, vendor-self-interest disclosure, and pre-empting the "is this just context-engineering rebranded?" skeptic. Leadership reads bullets, not notes — so the tier tags live on the slide face. Conceding what's directional *strengthens* the argument with engineers; convergence across rivals is the real evidence, not any single number. Keep GitGuardian's ~2× secret-leak stat and Faros's +91% review-time in notes/Q&A only — security and the review-unit are deliberate omissions, so don't pull them onto the face. The CircleCI 70.8% directional line here is conditional on it also landing on Slide 3.

---

## Slide 21 — The payoff: compounding quality, safe speed, one set of artifacts
**Key message:** The system pays back four ways: quality compounds, iteration stays fast AND safe, risk drops, and the same artifacts onboard humans.
- **Compounding quality:** the lint ratchet's only direction is down — its debt log is 12 entries of debt being *deleted*, not added. Entropy can't accumulate silently.
- **Safe speed (DORA amplifier — with a stability tax):** AI lifts throughput but taxes delivery stability unless strong foundations absorb it; the harness buys that stability back. The bottleneck *relocated* from writing to verifying and merging — strong tests and review are what turn AI velocity into bankable throughput.
- **Risk drops:** the doom loop we measured up front (duplication, +37.6% vulns over unreviewed iterations) is exactly what this prevents — *callback, not a re-cite.*
- **One set of artifacts:** a pointer AGENTS.md, deep modules, self-correcting lint messages, fast local feedback — exactly a great onboarding kit. You don't choose between optimizing for AI and for humans; it's one list.
- **Honest close:** behavior confidence is our self-declared weakest axis — deterministic sensors carry maintainability and architecture; correctness stays hard, industry-wide.
**Repo example:** `lint-ratchet.debt-log.jsonl` — 12 append-only entries, every one a retirement of debt absorbed into strict default lint; read top-to-bottom it *is* the monotonic-improvement story.
**Leadership takeaway:** This is debt-prevention insurance with a second payout: the same dollar spent making the codebase agent-ready also speeds human onboarding and prevents the accelerated-chaos failure mode. Not overhead — the multiplier that makes AI velocity safe to bank.
**Speaker notes:** This is the ROI slide. Lead with the amplifier framing — it converts a scary risk into a fundable thesis. The "same artifacts" point is the central thesis cashed out. End on the honesty beat (behavior is the weak axis): for a mixed audience, calibrated honesty earns more trust than hype, and it sets up the close.

---

## Slide 22 — Where to start (and what's next)
**Key message:** Don't copy 108 controls — that's a ceiling, not a template. Start with the five cheapest, highest-leverage pieces and grow the rest from your own observed failures.
- **Start here (the repo's own prioritization):** (1) a pointer-style session-start file, (2) the guide+sensor+repair rule, (3) self-correcting lint messages, (4) deep modules with orientation contracts, (5) ONE scheduled drift lane.
- Sequencing logic: lint is the cheapest highest-leverage guardrail (the agent self-corrects before a human sees it); a robust test suite is the behavior backbone; fusion + a weekly lane come last, once you have signals worth fusing.
- The verbatim restraint line: *"These principles describe a ceiling… A smaller team should treat that as aspirational, not a starting template. Start with the cheapest, highest-leverage few… and grow the harness from observed failures, not from a checklist."*
- **Open items, named honestly:** SessionStart/PreCompact rehydration (re-seeding load-bearing state at session start) is the clearest unshipped principle; and since the sensors are all build-time, runtime agent telemetry (per-run cost/latency, a max-steps circuit breaker) is a second real hole. Plus a short *additive* backlog, each grown from an observed gap (proposed, not shipped): property tests on the rules engine, runtime a11y in e2e, and a token-aware design-lint rule — detailed in the Q&A backup.
- **Mic-drop:** when an agent does the wrong thing, the default diagnosis is the environment was underspecified — fix the harness, not just the output.
**Repo example:** `docs/agent_notes/harness-review-2026-05/05-generic-harness-principles.md:280` (the "ceiling, not a template" caveat, written to be lifted verbatim).
**Leadership takeaway:** The ask is small and sequenced, not a big-bang rewrite: fund a lint config the agent can't bypass, a test suite you trust, and one weekly drift report — then let real failures justify each next control. Low cost, high leverage, provably reversible.
**Speaker notes:** Close forward-looking and actionable. Credibility comes from the team that built 108 controls explicitly telling you NOT to start there. Order matters: lint first (cheapest), then tests, then fusion. Naming SessionStart rehydration as the one clean open item keeps the talk honest and non-victory-lap. End on principle 3 — the harness is the thing you steer. (Q&A backup slide carries the backlog in three tiers — **Ready/additive:** property-based fast-check tests (PB-1), runtime axe-core a11y in e2e (A11Y-1), token-aware design lint (DL-1, a measured ratchet — re-verify its finding count on the day), plus the M2 context-budget reporter and the scoped-Stryker survivor summarizer. **Design-gated (not committed):** golden-task eval harness (EV-1), secret scanning (SEC-1), ~300-line PR-size warn (PR-1), guardrail tripwire (GC-1). **Rehydration:** R11 SessionStart. Frame all as proposed/design-gated, not shipped; note that classic CODEOWNERS+required-review, merge queue, "agent can't approve its own PR", extended-DORA, and OIDC are deliberately N/A for this solo repo, and that SEC-1/PR-1 would be CI warn-first, not a hard block.)

---

## Slide 23 — One line to take home
**Key message:** Optimizing your codebase for AI is the same discipline as onboarding a great new hire — and a harness (cheap deterministic guardrails in the loop, expensive truth on a schedule) is what turns AI from a debt accelerator into a force multiplier.
**Speaker notes:** Leave them with the single sentence, then open for questions.
