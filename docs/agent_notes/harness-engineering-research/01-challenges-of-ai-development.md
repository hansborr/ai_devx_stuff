# Challenges of Heavy AI Reliance in Software Development

> **TL;DR** — By mid-2026, the bottleneck in AI-assisted software development has moved from *writing* code to *verifying* it. Agents emit 5–7x more code than a human can read, that code degrades over long sessions ("erosion"), and the type checker silently lets architectural decay through. The defense is not better prompting — it is **machine-checkable gates** (architecture rules, mutation testing, supply-chain scanning, slop scanners) wired into CI, plus a **human comprehension contract** that refuses to merge code nobody can explain. The throughput, cost, and non-determinism of agents are now first-order engineering constraints, not afterthoughts.

**Top actionable takeaways**

- **Make architecture machine-checkable.** `tsc` checks types, not layers or cycles — add `dependency-cruiser` + `eslint-plugin-boundaries` as required CI gates. Structural erosion rises in ~80% of long agent trajectories (and verbosity in ~90%) ([SlopCodeBench](https://arxiv.org/abs/2603.24755)); only enforced gates halt it.
- **Gate AI tests on mutation score, not line coverage.** Run StrykerJS at a 60–80% mutation threshold on critical paths. In one case study a "93% coverage" suite had a far lower (~58.6%) mutation score — line coverage overstates protection (treat the exact figures as illustrative, not a benchmark).
- **Defend against slopsquatting.** ~20% of AI-recommended packages do not exist; use lockfiles, frozen installs (`npm ci` / `pnpm --frozen-lockfile`), allowlists, and Socket/Snyk on every PR.
- **Budget for the review bottleneck.** PR review time is up ~91%, median main-branch throughput is *down* ~7% YoY; keep PRs small and single-feature, front-load gates, never measure productivity by PRs merged.
- **Counter comprehension debt with a human in the loop.** Anthropic's RCT found AI-delegators scored 17 points lower on comprehension. Require authors to explain submitted code; treat "passes-but-unexplained" as a blocker.
- **Manage context deliberately.** All 18 frontier models degrade as input grows; use just-in-time retrieval (`grep`/`head`, not file dumps) and sub-agent summaries.
- **Treat cost and non-determinism as constraints.** Agentic tasks burn ~1000x the tokens of chat with up to 30x run-to-run variance; set per-seat caps, pin temperature 0, and eval on semantic equivalence.

See also: [Overview](00-overview.md) · [Codebase Structure for Agents](03-codebase-structure-for-agents.md) · [Static Analysis & CI/CD Gates](04-static-analysis-and-ci-cd-gates.md) · [Preventing AI Slop](08-preventing-ai-slop.md) · [Linting for AI](09-linting-for-ai.md) · [Agent Guidance & Context](10-agent-guidance-and-context.md)

---

## The core shift: the constraint moved from writing to verifying

For decades the scarce resource in software was *producing* working code. Agents have collapsed that cost and exposed the next bottleneck: **human verification per merge**. Three structural problems follow, and every practice below is a response to one of them.

1. **Volume outpaces comprehension.** Agents generate 5–7x more code than reviewers can absorb, and agent code is measurably more verbose — SlopCodeBench measured agent output at ~2.2x the size of maintained open-source repositories ([arXiv 2603.24755](https://arxiv.org/abs/2603.24755)).
2. **Quality degrades over time and context.** Long-running agents *erode* their own work, and every frontier model loses coherence as its context fills.
3. **The cheap checks don't catch the expensive failures.** A type checker, line-coverage number, or a green CI run can all be true while the architecture rots, the tests assert nothing, and a dependency is a hallucinated package.

The throughline: **deterministic, enforced gates beat prompting.** A prompt is a suggestion; a non-zero CI exit code is a contract. Treat every guardrail in this report as something the agent must *fail against*, not be *asked to honor*.

---

## 1. Make architecture and dependency rules machine-checkable

**The trap:** TypeScript's type checker validates types. It does *not* stop layer violations (UI importing from the data layer), import cycles, or god-modules. Agents, lacking a persistent mental model of your architecture, drift toward these constantly. SlopCodeBench found structural erosion (complexity concentrating in already-complex functions) rising in **~80% of long agent trajectories** — with redundant/duplicated-code verbosity rising in **~90%** — and no agent solving any of its 20 iterative problems end-to-end across 11 models (highest checkpoint solve rate 17.2%). Enforced gates, not prompting, are what arrests this drift.

**The fix:** add architecture linting as a required CI gate.

```js
// .dependency-cruiser.js — forbid layer-up imports and cycles
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'ui-not-import-data',
      severity: 'error',
      from: { path: '^src/ui' },
      to:   { path: '^src/data' },
    },
  ],
};
```

```json
// .eslintrc — boundaries by feature/layer tag
{
  "plugins": ["boundaries"],
  "settings": {
    "boundaries/elements": [
      { "type": "ui",   "pattern": "src/ui/*" },
      { "type": "data", "pattern": "src/data/*" }
    ]
  },
  "rules": {
    "boundaries/element-types": ["error", {
      "default": "disallow",
      "rules": [{ "from": "ui", "allow": ["ui"] }]
    }]
  }
}
```

Add `no-restricted-syntax` rules for project-specific bans (e.g. forbidding direct `process.env` access outside a config module). **Equivalents in other ecosystems:** ArchUnit (Java), NetArchTest (.NET), import-linter (Python), depguard (Go).

> **Confidence: high.** This is the most consistently validated finding in the source set. See [Codebase Structure for Agents](03-codebase-structure-for-agents.md) and [Static Analysis & CI/CD Gates](04-static-analysis-and-ci-cd-gates.md) for full layering setups.

---

## 2. Gate AI-written tests with mutation testing, not coverage

Coverage measures which lines *ran*, not whether any assertion would *fail* if the code broke. AI-written tests are especially prone to high coverage with hollow assertions: in one widely-cited case study a suite at **~93% line coverage** scored a **58.6% baseline mutation score** — a ~34-point gap between lines exercised and behavior actually protected — before targeted work raised it. Treat the specific numbers as one illustrative data point, not an industry constant; the durable lesson is that line coverage systematically overstates AI test strength, so gate on mutation score instead. (See [04](04-static-analysis-and-ci-cd-gates.md) and [05](05-test-suite-architecture.md) for the full case study and the [overview's source-reliability note](00-overview.md#source-reliability--verify-before-citing).)

```bash
npx stryker run   # StrykerJS — fails CI below threshold
```

```json
// stryker.config.json
{ "thresholds": { "high": 80, "low": 60, "break": 60 } }
```

Run StrykerJS at a **60–80% mutation-score threshold on critical paths** rather than chasing line coverage above 80%. Verify end-to-end behavior via Playwright or a Puppeteer MCP server — a passing unit test against a mocked world proves little. Vitest 4.1 ships an **AI Agent Reporter** that suppresses passing-test and console noise to cut the agent's token spend while it iterates.

> **Debate (confidence: medium).** Advocates call mutation testing table-stakes for AI code; skeptics call it slow. The honest middle: scope it to critical paths, not the whole repo, and run it as a nightly/PR gate rather than on every inner-loop save. See [Preventing AI Slop](08-preventing-ai-slop.md).

---

## 3. Defend the supply chain against slopsquatting

Agents hallucinate package names, and attackers register those names. The [USENIX Security 2025](https://socket.dev/blog/slopsquatting-how-ai-hallucinations-are-fueling-a-new-class-of-supply-chain-attacks) study found **~19.7% of recommended packages do not exist** (21.7% for open-source models, 5.2% for commercial), and **43% of hallucinated names recur** when you rerun the same prompt — making them predictable, registrable targets. A fake `huggingface-cli` package planted as a demonstration drew **30,000+ downloads**.

**Defenses (layer all of these):**

- **Lockfiles + frozen installs:** `npm ci` or `pnpm install --frozen-lockfile` so no new resolution happens in CI.
- **Dependency allowlists** and **registry-existence checks** on every new dependency in a PR.
- **Socket and Snyk scanning on every PR** to flag malware, typosquats, and install-time scripts.
- Follow **OWASP AISVS Appendix C** (AI for Code Generation) as the guardrail checklist.

> **Confidence: high.** Figures verified against the USENIX study. See [Static Analysis & CI/CD Gates](04-static-analysis-and-ci-cd-gates.md) for CI wiring.

---

## 4. Manage context deliberately to fight context rot

**All 18 frontier models tested by [Chroma](https://research.trychroma.com/context-rot) degrade as input length grows** — with the steepest degradation reported in the **100k–500k-token range**, well before any context-window limit, even on long-context models. Counterintuitively, a *coherent* haystack of distractors degrades performance worse than a shuffled one. A big context window is a budget to spend carefully, not a dumping ground.

**Practices:**

- **Just-in-time retrieval, not file dumps.** Have the agent `grep`/`head` for the specific lines it needs instead of reading whole files.
- **Compaction that preserves signal:** when summarizing a long session, keep architectural decisions and the ~5 most recently touched files verbatim.
- **A `NOTES.md` working-memory file** the agent updates across a session.
- **Sub-agents that return 1,000–2,000 token summaries** rather than raw transcripts, keeping the parent context lean.

See [Agent Guidance & Context](10-agent-guidance-and-context.md) for the full context-engineering playbook. **Freshness caveat:** the Chroma study predates the late-2025 model jump; the *direction* (longer = worse) holds, but exact degradation thresholds on 2026 models may differ.

---

## 5. Budget for the review bottleneck

Faster generation has not produced faster delivery. The data shows the bottleneck simply relocated:

- **PR review time rose ~91%** as reviewers face larger, denser diffs — a [Faros AI study](https://www.faros.ai/blog/ai-software-engineering) of 10,000+ developers across 1,255 teams (teams completed 21% more tasks and merged 98% more PRs, but review time rose 91% and PR size +154%); Google's 2025 DORA report independently lands on the same +91%.
- **Median main-branch throughput fell ~7% YoY**, even as *feature-branch* throughput rose ~15% for the median team — the [CircleCI 2026 State of Software Delivery Report](https://circleci.com/blog/five-takeaways-2026-software-delivery-report/) (28M+ workflows; median main-branch success rate fell to 70.8%, its lowest in 5+ years). Top-performing teams split +85% feature / +26% main; the median team's main-branch number is *negative*. Work is being produced faster but merged slower.
- **AI-authored code surfaces ~1.7x more review issues** — 10.83 vs 6.45 issues per PR across 470 open-source PRs ([CodeRabbit, *State of AI vs Human Code Generation*](https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report)).
- **Perception inverts reality:** [METR's early-2025 RCT](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/) found experienced open-source developers *felt* ~20% faster with AI but were measured **~19% slower** on real tasks.

**What to do:**

- Keep PRs **small and single-feature** so a human can actually review them.
- **Front-load automated gates** (architecture, mutation, slop scanners, supply-chain) so review focuses on logic and intent, not mechanics.
- **Require a verification trail** (what was run, what passed) on each PR.
- **Do not measure productivity by PRs merged** — that metric is precisely what AI inflates while real delivery stalls.

> **Source-hygiene note:** The "felt 20% faster / 19% slower" finding is **METR's**, *not* LinearB's (a common mis-attribution). On the CircleCI numbers, keep the *team-tier* split straight: across all projects, aggregate feature-branch activity rose **+59% YoY** while main-branch activity fell **−7%**; for the **median team** specifically the figures are **+15% feature / −7% main**, and the **top 5%** of teams hit **+85% feature / +26% main**. Do not present the aggregate +59% as the median team's number.

---

## 6. Counter comprehension debt and skill atrophy

When agents emit 5–7x more code than a human can read, the gap between *code that exists* and *code anyone understands* becomes "comprehension debt." [Anthropic's skill-formation RCT](https://arxiv.org/html/2601.20245v1) makes the cost concrete: developers who **delegated to AI scored 17 points lower** on a comprehension quiz about their own deliverable (**50% vs 67%** for those who hand-coded), and *pure* code-delegators scored **below 40%**.

**Keep a human in the loop:**

- **Require authors to explain submitted code** in the PR — agent-authored or not. "It passes but I can't explain it" is a **blocker**, not a nuance.
- **Cap unreviewed AI output** per change; a 2,000-line all-green diff is comprehension debt, not progress.
- **Rotate engineers through manual work on core paths** so skill doesn't atrophy on the systems that matter most.

This pairs with the "golden rule" merge gate in [Preventing AI Slop](08-preventing-ai-slop.md): never merge what you couldn't explain to a colleague.

> **Freshness caveat:** related scale figures from GitClear's code-quality work run through 2024 data; cite them for *trend*, not 2026 magnitude.

---

## 7. Run deterministic slop scanners on diffs before review

Before a human ever opens a PR, run cheap deterministic scanners on the **changed lines** to strip the signatures of low-value agent output: narrative "now we do X" comments, swallowed exceptions, `as any` casts, and dead code.

- **`deslop`** ([github.com/dabit3/deslop](https://github.com/dabit3/deslop)), **`aislop`** ([scanaislop](https://github.com/scanaislop/aislop), 50+ deterministic rules, no LLM), and **KarpeSlop** (`npx karpeslop`) — TS/JS/React slop detection.
- **`eslint-plugin-llm-core`** — ~20 rules that complement typescript-eslint with AI-specific smells.
- **[Knip](https://knip.dev)** for dead code and unused dependencies — it replaces the now-deprecated `ts-prune`.

Wire these into CI on changed files **and** a pre-commit hook so the feedback hits the agent's hot path.

> **Maintenance caveat (confidence: medium).** These are fast-moving, often single-maintainer tools. Verify each is actively maintained before making it a required gate; the *category* is durable even as specific tools churn. See [Linting for AI](09-linting-for-ai.md).

---

## 8. Maintain a single `AGENTS.md` source of truth

Keep **one short, version-controlled `AGENTS.md`** with the most critical rules first, **referenced (via `@import`), not duplicated**, by `CLAUDE.md` and other tool-specific files. Update it in the *same PR* that introduces a convention, and list the **enforced gate commands** so the agent can self-verify before handing back.

One controlled study ([arXiv 2601.20404](https://arxiv.org/abs/2601.20404)) — 10 repos / 124 PRs, agents run with vs without an `AGENTS.md` — found a hand-curated agent context file produced **~29% lower median runtime and ~17% fewer output tokens**.

> **Debate (confidence: contested).** Evidence is early and **partially contradictory** — a more skeptical follow-up ([arXiv 2602.11988](https://arxiv.org/abs/2602.11988)) found auto-generated context files can *hurt* success and inflate cost. The reconciliation: this is a **quality question, not an existence one** — a tight, developer-authored file helps; a bloated, LLM-generated one can hurt. Never ship an LLM-drafted `AGENTS.md` unsupervised. Full treatment in [Agent Guidance & Context](10-agent-guidance-and-context.md).

---

## 9. Checkpoint long-running agents so erosion is recoverable

Because long agent runs erode, make every bad change *one revert away*. [Anthropic's long-running-agent harness guidance](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) provides the primitives:

- A **JSON feature list** (`feature-list.json`) that resists overwrite — the agent does **one feature at a time**.
- A **progress log** (`claude-progress.txt`) the agent appends to.
- **Frequent git commits** so any regression is a single `git revert`.
- An **init script** (`init.sh`) and a **session-startup ritual** to rebuild context deterministically.
- **Playwright / Puppeteer MCP browser verification** for real-render ground truth.

Keep the working tree **merge-ready at all times** and **commit often**.

> **Open question:** one general-purpose agent vs. specialized multi-agent orchestration is unresolved — both are defensible in mid-2026.

---

## 10. Treat cost and non-determinism as engineering constraints

Agentic workflows are economically and operationally different from chat:

- **~1000x more tokens** than a chat turn, with **run-to-run variance up to 30x** ([arXiv 2604.22750](https://arxiv.org/abs/2604.22750)).
- **Higher spend does not mean higher accuracy** — there is no reliable "pay more, get better."
- **Uber burned through its 2026 Claude Code budget in four months** and imposed a **~$1,500/month per-seat cap** (some engineers had been running $500–$2,000/month in tokens) — a cautionary data point on uncapped agent spend ([TechCrunch](https://techcrunch.com/2026/06/02/uber-caps-employee-ai-spending-after-blowing-through-budget-in-four-months/)).

**Controls:**

- **Per-seat token caps** and a preference for token-efficient models.
- **Pin the model, set temperature 0, and use a seed** where the provider supports one — note **Anthropic exposes no `seed` parameter today.**
- **Eval on semantic equivalence**, not byte-for-byte output, since determinism is unattainable.

**On determinism:** temperature 0 is *necessary but insufficient*. The dominant source of LLM non-determinism is **batch-variance in the forward pass** — the same prompt yields different tokens depending on how requests are batched on the server. The foundational analysis and the batch-invariant-kernel fix come from **[Thinking Machines Lab](https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference)** (Sept 2025); morphllm published a secondary explainer. Plan for variance; don't expect to eliminate it.

---

## TypeScript / React / Storybook specifics

The same deterministic signals that catch human mistakes are exactly what an agent loops against to self-correct, which makes a strict TS/React stack the cheapest scaffolding you can hand an agent.

- **Strict `tsconfig`.** Beyond `strict`, add `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, and `noFallthroughCasesInSwitch`. `tsc --noEmit` in the loop is the single best feedback signal.
- **Storybook 10.3+ MCP server** (`npx storybook add @storybook/addon-mcp`, **React + Vite-based setups only today**) so agents read *real* component props and stories instead of hallucinating them — directly attacking the duplication/invention failure mode.
- **Stories as ground truth:** **Storybook + Vitest + Playwright MCP** runs your stories as real-browser tests, giving the agent render-level truth rather than mock-level assumptions.
- **Mutation testing** via StrykerJS and **boundary linting** via `eslint-plugin-boundaries` are both first-class in this ecosystem — wire them as the architecture + test-quality gates described above.

See [TypeScript + React + Storybook](13-typescript-react-storybook.md) and [UI Design Systems Enforcement](07-ui-design-systems-enforcement.md) for the full stack.

---

## Freshness (2026)

- **Current and load-bearing:** the architecture-erosion finding (SlopCodeBench, Mar 2026), token-cost economics (arXiv 2604.22750, 2026), the review-bottleneck/main-branch-throughput data (CircleCI 2026), Vitest 4.1's AI Agent Reporter (May 2026), Storybook 10.3 MCP, and Knip-over-`ts-prune`.
- **Directionally true but pre-jump — cite for trend, not magnitude:** Chroma context-rot (Jul 2025, pre-late-2025 models — *flag*), METR's 19% slowdown (early-2025 study, Cursor + Claude 3.5/3.7 — *flag*), and GitClear quality data (through 2024).
- **Contested / early:** the `AGENTS.md` productivity claim (one supportive study, one skeptical) and one-general-agent vs. multi-agent orchestration. Treat both as live debates, not settled practice.
- **Stable definitional sources:** Anthropic's context-engineering and long-running-harness guidance, and OWASP AISVS Appendix C — durable references unlikely to be invalidated by a model jump.

---

## Sources

- [SlopCodeBench — agent code degrading over iterations (arXiv 2603.24755)](https://arxiv.org/abs/2603.24755) — 2026-03
- [Context Rot — 18 frontier models (Chroma)](https://research.trychroma.com/context-rot) — 2025-07 *(flag: pre-late-2025 models)*
- [Effective context engineering for AI agents (Anthropic)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — 2025-09
- [Effective harnesses for long-running agents (Anthropic)](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) — 2025-11
- [Early-2025 AI Productivity RCT — 19% slowdown (METR)](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/) — 2025-07 *(flag: early-2025)*
- [Slopsquatting — USENIX Security 2025 package-hallucination study (Socket)](https://socket.dev/blog/slopsquatting-how-ai-hallucinations-are-fueling-a-new-class-of-supply-chain-attacks) — 2025
- [Token consumption — 1000x tokens, 30x variance (arXiv 2604.22750)](https://arxiv.org/abs/2604.22750) — 2026
- [Defeating nondeterminism in LLM inference (Thinking Machines Lab)](https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference) — 2025-09
- [Debt behind the AI boom — 24.2% of AI debt persists (arXiv 2603.28592)](https://arxiv.org/html/2603.28592v1) — 2026-03
- [Vitest 4.1 AI Agent Reporter (InfoQ)](https://www.infoq.com/news/2026/05/vitest-4-1-ai-agents/) — 2026-05
- [OWASP AISVS Appendix C — AI for Code Generation](https://github.com/OWASP/AISVS/blob/main/1.0/en/0x92-Appendix-C_AI_for_Code_Generation.md) — 2026
- [CircleCI 2026 State of Software Delivery Report](https://circleci.com/blog/five-takeaways-2026-software-delivery-report/) — 2026 *(main-branch throughput −7% median; success rate 70.8%)*
- [AI software engineering — PR review time +91% (Faros AI)](https://www.faros.ai/blog/ai-software-engineering) — 2026
- [State of AI vs Human Code Generation — ~1.7x more issues (CodeRabbit)](https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report) — 2025-12
- [How AI Impacts Skill Formation — 17-point comprehension gap (Anthropic, arXiv 2601.20245)](https://arxiv.org/abs/2601.20245) — 2026-02
- [On the Impact of AGENTS.md Files (arXiv 2601.20404)](https://arxiv.org/abs/2601.20404) — 2026 · [Evaluating AGENTS.md (arXiv 2602.11988)](https://arxiv.org/abs/2602.11988) — 2026-02
- [Knip — dead code & unused deps](https://knip.dev) · [deslop](https://github.com/dabit3/deslop) · [aislop](https://github.com/scanaislop/aislop)
