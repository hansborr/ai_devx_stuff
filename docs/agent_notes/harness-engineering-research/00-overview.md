# Harness, Context & Agentic Engineering — Best Practices (mid-2026)

> **The one-line thesis:** When agents write most of the code, your codebase, your CI, and your guardrails stop being hygiene and become the *control surface*. A non-zero exit code is a contract the model cannot route around; a paragraph in `AGENTS.md` is a suggestion it discards as context fills. Build for **deterministic enforcement over probabilistic prompting** — and the same gate that blocks a bad human PR becomes the fast feedback signal an agent loops against to fix itself.

This is the index for a **20-part** research report on engineering software organizations and codebases for an AI-heavy workflow. Each section stands alone and is densely cited. This overview gives the executive summary, the core thesis, the consolidated top recommendations, a reading guide to all 19 sections, a TS/React/Storybook quick-start, a source-reliability callout, and the live debates and open questions.

---

## Executive summary: where we stand, mid-2026

The late-2025/2026 model jump — **Opus 4.8**, **GPT-5.5**, **Fable 5** — changed the calculus, but not in the direction most teams expected. Models got dramatically more capable and *more verbose*: they sustain longer coherent work (Anthropic removed explicit sprint-decomposition between Opus 4.5 and 4.6 because the stronger model no longer needs it) and emit far more code per turn. Generation got cheap; the scarce resource is now **human verification and integration per merge**. The bottleneck did not disappear — it *relocated*, from writing code to comprehending, trusting, and merging it.

The data is blunt about the relocation. PR review time is up ~91% as reviewers face larger diffs (Faros AI; corroborated by Google's 2025 DORA report). Median *main-branch* throughput fell ~7% YoY even as feature-branch throughput rose ~15% for the median team (CircleCI 2026, 28M+ workflows); main-branch pipeline success sits at **~70.8%** — its lowest in five years against a historical ~90% benchmark. Work is produced faster but merged slower and lands less reliably. AI-authored code surfaces ~1.7x more review issues (CodeRabbit) and review quality itself degrades past roughly **300 changed lines** (Codacy). And the perception gap is real: METR's July-2025 RCT found experienced developers *felt* ~20% faster but were measured ~19% *slower* — though METR's Feb-2026 update walks back the generalizability of that result and suggests speedups have likely grown since, so cite it for the perception/measurement gap, not as proof of persistent slowdown.

The quality signals that used to reassure us lie under AI. A "93% line coverage" suite can carry a far lower mutation score (tests that run the code but assert nothing); structural erosion appears in ~80% of long agent trajectories and verbosity in ~90% (SlopCodeBench, with no model solving its tasks end-to-end and a top checkpoint solve rate of 17.2%); 24.2% of AI-introduced issues still persist at a repo's latest revision (*Debt Behind the AI Boom*); and public benchmark scores collapse on real code — agents at 70%+ on SWE-bench Verified drop to ~15–23% on unseen commercial code (SWE-bench Pro).

Two forces sharpened the picture this cycle. First, **security moved from footnote to first-order constraint**: prompt injection is now understood as *architectural* (the lethal-trifecta / Meta's Rule of Two — never let one unsupervised agent hold untrusted input + sensitive credentials + egress), AI code introduces vulnerabilities (~45% of generations carry a known flaw unprompted, Veracode) and leaks secrets at ~2x the human rate (GitGuardian), and the supply chain is under active worm attack — so deterministic controls (OS sandboxes, default-deny egress, lockfile-only installs with release-age cooldown, least-privilege identity) became mandatory, not optional. Second, the discipline **named its sub-fields**: memory-as-a-layer, token economics, **evals/observability**, **multi-agent orchestration**, MCP/tool design, and **team/process/org change** each matured into their own playbook this cycle — the three most recently crystallized (15, 16, 17) are the ones least covered by earlier guidance and most worth reading fresh.

The strategic response, converged on by Anthropic, OpenAI, and every serious field report, is **harness engineering**: treat the codebase as the prompt, push every mechanizable rule down into deterministic gates (hooks → pre-commit → CI), measure the agent against *your* repo (evals, observability, extended-DORA) rather than leaderboards, and move scarce human attention *up the stack* to specs, plans, and comprehension-for-ownership. The stronger models reward this more, not less — a more capable, more confident agent that gets blocked will try harder to route *around* a boundary, which is exactly why `CODEOWNERS`-locked config, unbypassable `PreToolUse` guards, and OS sandboxes matter more in mid-2026 than a year ago. Prose guidance has not gotten more reliable; executable rules have only gotten more necessary.

---

## The core thesis: the codebase-quality ⇄ guardrails ⇄ agent-performance feedback loop

There is a tight, compounding loop at the heart of every section of this report:

1. **The codebase is the prompt.** An agent has no persistent working memory; it reconstructs context every session via grep/glob and file reads, paying a token + tool-call cost per file and degrading in accuracy as its window fills ("context rot," documented across 18 frontier models). A legible, well-structured repo — vertical slices, small files, narrow public APIs, one pattern per job — therefore *directly* raises agent accuracy and lowers cost. A scattered one raises hallucination rates even when the whole repo would technically fit in the window.

2. **Guardrails are the agent's self-correction signal.** A linter, type error, failed test, architecture-rule violation, SAST finding, or surviving mutant is not just a gate that blocks a bad PR — it is a precise, machine-readable, line-localized error the agent reads and fixes *on its next turn*, with no human in the loop. The same wall serves two masters. This is why "the linter beats the prompt": intent encoded as an autofixable rule with a teaching error message re-prompts the model for free, every time, exactly when it is relevant — leverage `AGENTS.md` cannot match.

3. **Hygiene compounds with AI — and degrades it when neglected.** This is the load-bearing insight. A strict, well-gated codebase makes the agent *better* (tight loops, fast walls, unambiguous structure), and the agent's output keeps the codebase strict (because it can't merge anything that breaks the gates). Neglect the hygiene and the loop runs in reverse: the agent copies the most-recently-seen pattern or invents a new one, drift becomes the example the *next* agent imitates, comprehension debt accumulates silently, and quality erodes one green PR at a time. The agent is a mirror and an amplifier of the discipline already encoded in your repo.

The three new sub-disciplines extend this loop outward. **Evals/observability** (15) close it at the org level — you cannot tell whether a harness change helped without a golden-task suite graded by your own deterministic checks and per-run traces of cost/tokens/latency. **Multi-agent orchestration** (16) multiplies the loop's *throughput* but only when subtasks are genuinely independent, and adds one structural reliability lever above all others: separate the agent doing the work from the agent judging it (planner / generator / evaluator), because agents confidently praise their own mediocre work. **Team/process/org** (17) is the loop's human enclosure: small stacked PRs behind a merge queue, two-tier review (machines clear mechanics, humans judge architecture and intent), and accountability that never transfers to the AI.

---

## Top actionable recommendations

Grouped by theme. Each is concrete and load-bearing; depth and caveats live in the linked section.

**Codebase structure (→ [03](03-codebase-structure-for-agents.md))**
1. **Organize by vertical slice, not technical layer.** One feature owns its UI, logic, data, tests, and stories in a folder with a single public `index`, so a change fits one context window. Kill internal barrel files; keep at most one curated public-API barrel per package. Standardize on **one pattern per job** (one validation lib, one data-fetching pattern) and run **Knip** to delete the dead code and duplication agents accrete.

**Static analysis & CI gates (→ [04](04-static-analysis-and-ci-cd-gates.md))**
2. **Build a layered gate stack, fastest-first:** editor/`PostToolUse` hook → pre-commit → required CI checks → nightly. Mirror the *same commands* across layers. Turn on TypeScript's strictest flags (`strict` + `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, …) and make `tsc --noEmit` a dedicated required check — the bundler's transpile does not typecheck.
3. **Never give agents a fast-path that bypasses review on security-critical files** (OWASP AISVS AC.4/AC.8): an agent must not approve, merge, or deploy what it generated.

**Testing (→ [05](05-test-suite-architecture.md))**
4. **Gate on mutation score, not line coverage.** Run Stryker scoped to changed/critical modules nightly; line coverage routinely hides assertion-free tests. Shape the suite as a **Testing Trophy** (heavy integration, thin E2E, big static base); enforce test-first with **TDD Guard** (knowing it is LLM-judged, not deterministic); **quarantine flake, never blanket-retry**; add property-based (fast-check) and contract (Pact/OpenAPI) tests for the blind spots example-based AI tests miss.

**Architecture & standards (→ [06](06-enforcing-architecture-and-standards.md))**
5. **Add a third CI gate for architecture** (`dependency-cruiser` + `eslint-plugin-boundaries`): `tsc` and tests never enforce the dependency graph. Use **allow-lists, not deny-lists**, and write every custom rule's error message as a *teaching string* with a correct example inline.
6. **Lock the guardrails under `CODEOWNERS`** — the dep-cruiser config, ESLint config, `AGENTS.md`, `tsconfig`. Blocked agents try to loosen their own leash (`eslint-disable`, `@ts-ignore`, `any`); a human owner's review on those files shuts that down.

**UI / design systems (→ [07](07-ui-design-systems-enforcement.md))**
7. **Run a two-sided UI pipeline:** feed the design system *in* via the **Storybook MCP server** (so agents reuse real components instead of inventing them) and gate violations *out* with token-aware lint (`@lapidist/design-lint` for raw hex, `stylelint-plugin-rhythmguard` for scale discipline) plus **two layers of a11y** (static `jsx-a11y` + runtime axe with `parameters.a11y.test = 'error'`) and visual regression (Chromatic + TurboSnap).

**Context & agent guidance (→ [10](10-agent-guidance-and-context.md), [03](03-codebase-structure-for-agents.md))**
8. **Keep one lean, version-controlled `AGENTS.md`** at repo root (nest per package in monorepos), referenced not duplicated by tool-specific files. Apply the per-line test — *"would removing this cause a mistake?"* — and **never ship an LLM-drafted context file unsupervised** (auto-generated bloat measurably hurts).
9. **Match the mechanism to the rule:** always-on broad rules → `AGENTS.md`; sometimes-relevant knowledge → a Skill (progressive disclosure); must-fire-every-time → a hook; file-heavy investigation → a subagent. Prefer just-in-time retrieval (grep/`head`, install CLIs) over context stuffing.

**Prompting (→ [11](11-prompting-agents.md))**
10. **Lead with outcome + constraints + a checkable done-when**, not step-by-step instructions; give the agent an external way to check its work and a *separate* skeptical evaluator (fresh context, no write tools, default-FAIL). **Plan-then-execute** when a change touches 3+ files; **persist the plan as markdown** so it survives context resets.
11. **Treat each new model family as a fresh prompting baseline** — rebuild from the smallest prompt, add instructions only per observed failure, re-tune effort/verbosity. Size task chunks to the model (larger for Opus 4.8 / GPT-5.5); over-decomposition now costs tokens and coherence.

**Hooks (→ [12](12-custom-hooks.md))**
12. **Learn the block-and-feedback primitive** (`echo reason >&2; exit 2`): the reason re-enters the model's context, which is what makes a hook *steer*. Use `PostToolUse` for autofix/feedback (it cannot revert the edit), `PreToolUse`/pre-commit/CI for hard blocks. Wire **format-on-save**, a **fast changed-file typecheck/test gate**, **deny-guards** for dangerous commands and protected paths, and treat **git hooks as the enforcement floor** that applies to humans and agents alike.

**Security & supply chain (→ [14](14-security-and-supply-chain.md))**
13. **Enforce the Rule of Two**: split untrusted-input handling (read-only discovery agent) from credentialed action (separately-scoped action agent), or insert a human gate. **Turn network OFF by default** for CLI agents and enable the OS sandbox.
14. **Lock the supply chain:** `npm ci` / `--frozen-lockfile`, `--ignore-scripts`, dependency **cooldown** (`minimumReleaseAge`), and a human gate on any package not already in the lockfile — slopsquatting (hallucinated package names attackers pre-register) is a live attack class. Block merges on SAST + secret-scanning (gitleaks/trufflehog in pre-commit *and* CI). Treat `github.event.*` as hostile data; publish via OIDC, not long-lived PATs.

**Evals & observability (→ [15](15-evals-and-observability.md))**
15. **Build a `/evals` golden-task suite (20–50 fixtures) from real failures**, graded deterministically (`tsc && eslint && vitest` + Stryker) first and an LLM judge only after human calibration (Cohen's kappa ≥ 0.6, controlling for position/verbosity bias). **Gate evals in CI** with an explicit regression threshold and stand up a **private SWE-bench-style harness on your own repo** — distrust leaderboards.
16. **Emit one OpenTelemetry GenAI trace per agent run** (tokens, cost, tool calls, latency, context-window utilization) into Langfuse/Braintrust/LangSmith; alert on rolling-p95 cost spikes and >80–90% context utilization, and add a **max-steps/max-cost circuit breaker**.

**Orchestration (→ [16](16-multi-agent-orchestration.md))**
17. **Default to single-agent; parallelize only when subtasks are genuinely independent** (no shared file writes, no shared state). Pick the right primitive (subagent / agent view / agent teams / dynamic workflow), isolate files with **git worktrees** (plus per-worktree runtime isolation — ports, DBs, env), and **tier models** (strongest for the orchestrator/planner, Sonnet for workers, Haiku for read-only search). Build a **planner → generator → evaluator** loop and gate every parallel PR behind a merge queue.

**Team, process & org (→ [17](17-team-process-and-org.md))**
18. **Shrink the unit of review:** warn at ~300 changed lines, hard-cap higher, require a plain-language intent statement, adopt stacked PRs + a merge queue. Run a **two-tier review** (machine gates clear mechanics → human judges architecture, threat model, business logic) with an **adversarial second-model pass** against known AI failure modes.
19. **Keep humans on the hook and skills alive:** a named human sponsor per AI PR (the AI cannot be approver-of-record; the merger owns on-call), review-first apprenticeship and periodic no-AI work, **tiered autonomy enforced in CI/CD** (T1 autonomous → T4 prod/secrets/auth needs human approval), and metrics that **extend DORA** (segment by AI-vs-human, add churn/rework and review-load) — **never reward lines or PRs merged**.

**Tool / MCP design (→ [18](18-mcp-and-tool-design.md))**
20. **Build fewer, higher-level, workflow-shaped tools** (prefer `search_*`/`filter_*` over `list_all_*`); shape responses for token efficiency (high-signal fields, a `concise`/`detailed` enum, `ResourceLink` for big blobs, stay under the 25k-token cap); write descriptions as if onboarding a new hire (97% of real MCP descriptions carry a "smell"); use **progressive disclosure** (`defer_loading` ≈ −85% definition tokens; code-execution wrappers collapse 150k→~2k); and treat the tool surface as a **security boundary** (pin/scan servers, scoped tokens, sandbox, no wildcard allowlists).

**Cross-cutting**
21. **Treat cost and non-determinism as engineering constraints** (→ [01](01-challenges-of-ai-development.md), [19](19-emerging-themes-and-frontier.md)): agentic tasks burn ~1000x chat tokens with up to 30x run-to-run variance; pin the model version, evaluate with N rollouts scored by semantic equivalence, cap autonomous steps before checkpoints, and exploit prompt caching (stable prefix first, volatile last; verify the `cache_read` field).

---

## Adoption roadmap — what to do in what order

You cannot do all 21 at once, and the order matters: **lay the deterministic floor first**, because every later practice (testing depth, evals, orchestration) only pays off once the agent has fast, machine-readable walls to loop against. A team retrofitting an existing codebase should ratchet on *new* code and avoid boiling the ocean. Rough sequencing (calendar markers are for a typical team; compress or stretch to taste):

**Phase 0 — Deterministic floor (week 1, do before pointing agents at the repo).** The non-negotiable base layer. *Recs 2, 8, 12, 13, 14a.*
- Strict `tsconfig` + `tsc --noEmit` as a dedicated required check; ESLint 9 flat + typescript-eslint `strictTypeChecked`; Prettier/Biome.
- One lean, hand-written `AGENTS.md` (never `/init`-and-ship).
- The block-and-feedback hook primitive: format-on-save + a fast changed-file typecheck/test `PostToolUse` hook; the same commands wired into pre-commit and required CI.
- Security floor: agent network **off by default** + OS sandbox; lockfile-only installs (`npm ci --ignore-scripts`).

**Phase 1 — Structure & boundaries (days 7–30).** Make the repo legible and lock the leash. *Recs 1, 5, 6, 9, 10, 14b.*
- Vertical slices, kill barrel files, `Knip` for dead code; the architecture gate (`dependency-cruiser` + `eslint-plugin-boundaries`, allow-lists, teaching error messages).
- `CODEOWNERS`-lock the guardrail configs (tsconfig, ESLint, dep-cruiser, `AGENTS.md`).
- SAST + secret-scanning in pre-commit *and* CI; dependency cooldown + human gate on new packages.
- Establish prompting norms (outcome + constraints + done-when; plan-then-execute, persisted as markdown) and the four-way mechanism choice (AGENTS.md / Skill / hook / subagent).

**Phase 2 — Verification depth (days 30–60).** Move from "it compiles" to "it's actually tested and on-pattern." *Recs 3, 4, 7.*
- Testing Trophy + **mutation gate** (Stryker on changed/critical modules), TDD Guard, flake quarantine, property (fast-check) + contract tests.
- The two-sided UI pipeline: Storybook MCP *in*, token-lint + two-layer a11y + visual regression *out*.
- Separation of duties: no agent approves/merges/deploys what it generated (OWASP AISVS AC.4/AC.8).

**Phase 3 — Measure & govern (days 60–90).** You can't manage the loop you can't see. *Recs 15, 16, 18, 19, 21.*
- A `/evals` golden-task suite (20–50 fixtures from real failures) graded deterministically, gated in CI; one OpenTelemetry trace per run into Langfuse/Braintrust/LangSmith; cost/context-utilization alerts + a max-steps/max-cost circuit breaker.
- The new SDLC: shrink the review unit (~300-line warn, stacked PRs, merge queue), two-tier review, named human sponsor, tiered autonomy enforced in CI/CD, **extended-DORA metrics that never reward lines/PRs merged**.
- Cost/non-determinism controls (pin model, N rollouts, prompt caching).

**Phase 4 — Scale out, when warranted (ongoing).** Only after the floor and feedback loops exist. *Recs 17, 20, plus 19's frontier.*
- Multi-agent orchestration **only for genuinely independent work** (worktrees, planner/generator/evaluator, model tiering, merge queue).
- Internal MCP/tool design (fewer workflow-shaped tools, token-shaped responses, tools-as-a-boundary).
- Memory-as-a-layer and self-improving-harness experiments — behind human/second-model review.

> **If you do only five things:** strict TS + `tsc` gate (Phase 0), block-and-feedback hooks (Phase 0), the architecture gate under `CODEOWNERS` (Phase 1), the mutation gate (Phase 2), and two-tier review with PR-size caps (Phase 3). These five carry most of the loop.

---

## Reading guide

| # | Section | One-line description |
|---|---|---|
| 01 | [Challenges of heavy AI reliance](01-challenges-of-ai-development.md) | The constraint moved from writing to verifying: volume, erosion, comprehension debt, cost, non-determinism. |
| 02 | [Mitigations & best practices](02-mitigations-and-best-practices.md) | The meta-answer — give the agent a self-runnable verification loop and make guardrails deterministic, not advisory. |
| 03 | [Structuring a codebase for agents](03-codebase-structure-for-agents.md) | The codebase is the prompt: vertical slices, small files, narrow APIs, machine-checked boundaries, lean docs-as-context. |
| 04 | [Static analysis & CI/CD gates](04-static-analysis-and-ci-cd-gates.md) | The layered gate stack — strict TS, `tsc --noEmit`, architecture-as-code, mutation testing, supply-chain, separation of duties. |
| 05 | [Test suite architecture](05-test-suite-architecture.md) | Mutation score over coverage, the Testing Trophy, TDD Guard, flake quarantine, property + contract tests. |
| 06 | [Enforcing architecture & standards](06-enforcing-architecture-and-standards.md) | The three-gate CI, allow-lists, teaching lint messages, `CODEOWNERS`-locked guardrails, vertical slices made physical. |
| 07 | [Enforcing UI design systems](07-ui-design-systems-enforcement.md) | Feed the system in (Storybook MCP), gate violations out (token lint, two-layer a11y, visual regression). |
| 08 | [Preventing AI slop](08-preventing-ai-slop.md) | The comprehension contract + deterministic slop detectors, mutation gates, second-pass `/simplify`, explicit ownership. |
| 09 | [Linting & AI-targeted lint tooling](09-linting-for-ai.md) | The linter beats the prompt: ESLint 9 + typescript-eslint gate, fast accelerators, custom teaching rules, lint-in-the-loop. |
| 10 | [Agent guidance & context engineering](10-agent-guidance-and-context.md) | Guidance files as a context-budget instrument; the efficacy debate; lean files, skills, the four-way mechanism choice. |
| 11 | [Prompting & driving agents](11-prompting-agents.md) | Outcome+constraints+done-when, external verification, TDD backbone, plan-then-execute, per-model-family rebuilds. |
| 12 | [Custom hooks (Claude/Codex/Cursor)](12-custom-hooks.md) | The block-and-feedback primitive, the consensus hook set, git hooks as the floor, harness config quick-reference. |
| 13 | [TypeScript + React + Storybook](13-typescript-react-storybook.md) | The strict-TS stack as agent scaffolding: runtime validation, Storybook MCP + stories-as-tests, mechanical guardrails. |
| 14 | [Security & supply-chain](14-security-and-supply-chain.md) | Prompt injection as architecture; Rule of Two, sandboxes, lockfile-only + cooldown, MCP-as-untrusted-dep, Clinejection. |
| 15 | [Evals, metrics & observability](15-evals-and-observability.md) | Codebase-grounded evals in CI, calibrated LLM judges, private harness over leaderboards, OTel traces, extended DORA. |
| 16 | [Multi-agent orchestration & parallelism](16-multi-agent-orchestration.md) | The independence precondition, the four primitives, worktree isolation, planner/generator/evaluator, model tiering. |
| 17 | [Team, process & organizational change](17-team-process-and-org.md) | The new SDLC: shrink the review unit, two-tier review, accountability, apprenticeship, tiered autonomy, fixed metrics. |
| 18 | [MCP & tool design for agents](18-mcp-and-tool-design.md) | Fewer workflow-shaped tools, token-shaped responses, new-hire descriptions, progressive disclosure, tools as a boundary. |
| 19 | [Emerging themes & the frontier](19-emerging-themes-and-frontier.md) | Memory-as-a-layer, token economics, surface selection, reliability under non-determinism, spec-driven dev, self-improving harnesses. |

---

## TypeScript + React + Storybook quick-start checklist

The fastest path to a stack that doubles as agent scaffolding — the same deterministic signals that catch human mistakes are what an agent loops against to self-correct.

- [ ] **Strict `tsconfig`** — `strict: true` plus the four flags it omits: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noFallthroughCasesInSwitch` (+ `verbatimModuleSyntax`, `noImplicitOverride`).
- [ ] **`tsc --noEmit` as a dedicated required check** — in the agent loop *and* CI; the bundler transpile does not typecheck.
- [ ] **ESLint 9 flat config + typescript-eslint `strictTypeChecked`** with `projectService: true`; keep `no-floating-promises`, `no-misused-promises`, `no-unnecessary-condition`, `no-explicit-any`, and `ban-ts-comment` at `error`. Add **Prettier/Biome** and a fast accelerator (oxlint/Biome) for the inner loop.
- [ ] **Architecture-as-code** — `eslint-plugin-boundaries` (in-editor) + `dependency-cruiser` (CI), allow-lists; lock the configs under `CODEOWNERS`.
- [ ] **Runtime-validate every boundary** with **Zod v4** (`z.infer` as the single source of truth) — HTTP, env, `localStorage`, forms.
- [ ] **Kill barrel files, co-locate by feature**; gate dead code with **Knip** and duplication with **jscpd**.
- [ ] **Storybook 10.3+ MCP server** (`npx storybook add @storybook/addon-mcp`; React + Vite only today) so agents read real props/stories instead of hallucinating them.
- [ ] **Stories ARE your tests** — `@storybook/addon-vitest` runs CSF3 `play` functions as real-browser interaction tests; set `parameters.a11y.test = 'error'` to make axe a hard gate.
- [ ] **Vitest 4.1** — leave `reporters` unset in agent runs so the token-efficient **agent reporter** auto-engages; use test tags to scope runs.
- [ ] **Mutation testing** with **StrykerJS** scoped to critical paths (set `break` explicitly — it defaults to 0/never-fails); add **fast-check** for pure logic.
- [ ] **TDD Guard** (`/plugin marketplace add nizos/tdd-guard`) for red-first enforcement; native Vitest/Jest/Storybook reporters.
- [ ] **State split:** TanStack Query **v5** for server state (there is no React v6), Zustand for client state; let the React Compiler own memoization (verify the TanStack Query #9571 referential-stability caveat).
- [ ] **Visual regression** (Chromatic + TurboSnap) as the UI machine-tier gate; supply-chain hygiene for Storybook addons (pin versions, keep the dev server off the public network).

---

## Source reliability — verify before citing

These reports were assembled under real research constraints (WebFetch was intermittently unavailable; several figures rest on WebSearch summaries cross-checked against verification notes). **The pass-1 citations were independently audited.** Two honest results from that audit:

- **The arXiv papers flagged as possibly fabricated turned out to be REAL.** SlopCodeBench (2603.24755), the two AGENTS.md studies (2601.20404 and 2602.11988), token-consumption (2604.22750), *Debt Behind the AI Boom* (2603.28592), the comprehension/skill-formation RCT (2601.20245), SWE-bench Pro (2509.16941), the MCP-description study (2602.14878), and the package-hallucination study (2605.17062) are all genuine sources. Do not silently drop them as hallucinated.
- **Several figures were re-attributed or corrected for precision.** Notable examples: the "93% coverage / 34%" framing is a *gap size* (58.6% baseline → ~93% after work), and the bare "34% mutation" number appears in some places with no traceable primary source; the ~57% a11y figure is a **Deque/axe-core vendor stat measuring issue volume**, not WCAG criteria and not jsx-a11y; the "felt 20% faster / 19% slower" result is **METR's, not LinearB's**; the ~85% MCP token reduction belongs to Anthropic's *advanced tool use* article (not the code-execution one); Haiku is **~5x cheaper than Opus, not 15x**; the CircleCI numbers must keep the team-tier split straight; and the "150 lines → +20% cost" causal link is manufactured (the cost figure is file-vs-no-file). The per-section "Freshness (2026)" and "Confidence" callouts flag the rest.

**Bottom line:** the *directional* claims and the *mechanisms* are well-supported and converge across independent sources; the *precise magnitudes* and *attributions* are where errors cluster. **Confirm primary sources before quoting any specific number externally**, and prefer the qualitative claim when the figure is contested. Pre-late-2025 sources (Chroma context-rot, METR, GitClear-through-2024) are directionally true but cite for *trend*, not 2026 magnitude.

---

## Key debates & open questions

- **Do context files (`AGENTS.md`) help or hurt?** Split evidence: one study finds a hand-curated file cuts ~29% runtime / ~17% tokens; another finds LLM-generated files *reduce* success and raise cost >20%. The reconciliation is **quality, not existence** — a tight developer-authored file helps; bloated auto-generated bloat hurts. Never `/init` and ship.
- **One general agent vs. multi-agent orchestration?** Unresolved. Parallelism pays only on genuinely independent work; for most sequential feature coding, a single well-scoped agent plus in-session subagents wins. The one durable multi-agent lever is structural: separate the doer from the judge.
- **How strict is too strict?** Maximal tsconfig + zero-warning lint can trap an agent in self-correction loops on legacy code. Ratchet strictness on *new* code; don't boil the ocean.
- **Mutation testing cost vs. signal.** Real (minutes-to-hours), so the debate is scoping — consensus lands on changed-files/nightly with an MSI threshold on critical packages, not whole-repo per-PR.
- **Is prompt injection solvable within current architectures?** Consensus: **no.** Manage it structurally (Rule of Two, default-deny egress, CaMeL-style provenance), never expect the model to police itself.
- **Determinism is unattainable.** Even at temperature 0, batch-variance in the forward pass yields run-to-run differences; Anthropic exposes no `seed`. Batch-invariant kernels fix it but ~double inference cost — reserve for eval, not production. Plan for variance.
- **Long-horizon autonomy ceiling.** No frontier model yet solves long iterative tasks end-to-end; structural degradation past ~100 steps is unsolved. Cap autonomous steps before human checkpoints.
- **Do iterative agent workflows produce *objective* speed-ups?** METR's perception/measurement gap is a standing caution: subjective speed-up is not evidence of objective speed-up. Measure throughput *and* stability/rework, never volume alone.
- **Self-improving harnesses (learnings loops, SIA-style weight+harness updates)** are promising but unproven at scale — keep a human or separate reviewing agent in the approval path.

---

*Start with [01](01-challenges-of-ai-development.md) for the problem framing and [02](02-mitigations-and-best-practices.md) for the consolidated answer; jump to any section above by theme. Sections 15–17 are the newest and least redundant with prior guidance.*
