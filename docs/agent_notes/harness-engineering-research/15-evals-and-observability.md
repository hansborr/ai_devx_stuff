# Evals, Metrics & Observability for AI-Heavy Workflows

## TL;DR

Measuring an AI-heavy engineering org by mid-2026 takes three instrumented layers: (1) **codebase-grounded evals** — a small golden task set built from real failures, graded by deterministic checks first (tsc, ESLint, Vitest, build) and LLM-as-judge only after human calibration, gated in CI like a failing test; (2) **observability** — per-run traces emitting OpenTelemetry GenAI spans (tokens, cost, tool calls, latency/TTFT, errors) piped into Langfuse/Braintrust/LangSmith; and (3) **org metrics** — DORA extended (not replaced) with quality and comprehension-debt signals, unified by DX Core 4. Trust YOUR harness over public leaderboards: 70%+ SWE-bench Verified scores collapse to ~15-23% on unseen commercial code. For TS/React/Storybook teams, you have unusually strong deterministic graders — lean on them before reaching for a judge.

### Top actionable takeaways

- **Build `/evals` with 20-50 fixtures** from your bug tracker and agent post-mortems; grade with `tsc --noEmit && eslint . && vitest run` + Stryker on touched files. Add new production failures weekly.
- **Gate evals in CI with an explicit regression threshold** (e.g. pass-rate must not drop >2 points vs `main`); post scores as a PR comment so reviewers see them inline.
- **Calibrate any LLM judge against humans** (100-300 traces, 2-3 annotators, Cohen's kappa ≥ 0.6) before gating on it; control for position and verbosity bias. Never gate a merge on an uncalibrated judge score alone.
- **Stand up an internal SWE-bench-style harness on your own repo** — apply the agent's patch, run pass-to-pass tests, track resolution-rate weekly. Distrust leaderboard numbers.
- **Emit one OTel GenAI trace per agent run** with tokens/cost/tool-calls/latency; alert on rolling-p95 cost spikes and >80-90% context-window utilization; add a max-steps/max-cost circuit breaker.
- **Extend DORA, don't report it alone** — segment the four keys by AI-authored vs human, and pair throughput with rework/change-fail/review-queue depth.

---

## 1. Codebase-grounded evals

### Build a golden-task suite from real failures — small, code-graded first

Start with **20-50 tasks** drawn from actual agent failures and user-reported bugs rather than amassing hundreds. Anthropic's rules:

- Write each task so **two domain experts independently reach the same pass/fail verdict**.
- Ship each with a **known-good reference solution** that proves the task is solvable and the grader works.
- **Grade what the agent produced, not the path it took**; build in **partial credit** for multi-step tasks.
- Treat the suite as a **living artifact with a named owner**; watch for **saturation** (an eval pinned at 100% gives no signal).

Prefer **code-based graders** — your test suite, type-check, lint, build, schema validation — because they are fast, cheap, objective, and reproducible. Escalate to an LLM judge only for genuinely open-ended quality.

```
/evals/
  fixtures/            # 20-50 cases from bug tracker + agent post-mortems
    issue-1423/        # known-good reference solution + failing repro
  graders/
    deterministic.ts   # tsc --noEmit && eslint . && vitest run && stryker run
  run.ts               # apply agent patch, score, emit JSON + PR comment
```

For a TS/React repo the grader is literally `tsc --noEmit && eslint . && vitest run` plus a Stryker run on touched files. **Add new production failures weekly** — this is the self-improving loop.

### Gate evals in CI with an explicit regression threshold

Wire the suite into CI exactly like tests: a change that drops the score below a defined threshold is **blocked from merge automatically**. Use a staged model — a fast subset on every push during development, the full golden set before promotion to staging/prod.

```yaml
# .github/workflows/evals.yml (sketch)
- run: pnpm eval:run --golden --report=evals.json
  # fail if pass-rate drops >2 points vs main, or any per-scorer threshold breached
- run: pnpm eval:gate --baseline=main --max-regression=2 \
       --threshold goal_completion=0.8 --threshold mutation_score=0.55
```

Braintrust ships a native GitHub Action that runs eval suites per PR, posts scores as PR comments, and blocks merges below threshold. For TS/Node teams, Vitest-style agent runners (e.g. Agentest) let you set per-metric thresholds (`goal_completion >= 0.8`, `helpfulness >= 3.5`) and fail the run when the average slips. **Without an automated gate, eval scores drift and regressions reach production.**

### Calibrate any LLM-as-judge against humans before gating

LLM judges are **not plug-and-play**. Before trusting one:

1. Sample **~100-300 production traces**; have **2-3 humans label** them.
2. Compute inter-annotator agreement: **Cohen's kappa > 0.6 acceptable, > 0.8 strong**.
3. Score the same traces with the judge; require comparable **judge-to-human** agreement.

Mitigate documented biases:

- **Position bias** — run both orderings and average. (Frontier-judge flip rates run roughly in the 5-15% range; treat as directional.)
- **Verbosity bias** — length-normalize or add a length penalty. Verbose answers are measurably over-preferred (one systematic study found ~+13% length bias vs human evaluators); the exact magnitude varies by study, so do not quote a hard "15-30 point" figure.
- **Self-preference bias** — a model rates its own family higher; consider a different judge family.

Give the judge an **escape hatch** (return `Unknown` when evidence is insufficient) and **isolate each rubric dimension into its own judge call** rather than one mega-prompt. **Recompute judge-vs-human kappa whenever you change the judge model or prompt** — an uncalibrated judge drifts silently when the underlying model is upgraded. Never gate a merge purely on an uncalibrated LLM score; pair it with deterministic graders.

### Build an internal SWE-bench-style harness; distrust leaderboards

The most credible measure of "can this agent work in OUR codebase" is a **private harness** that applies the agent's patch and runs your existing **pass-to-pass (P2P) tests**: the patch must fix the target issue **AND** not break any pre-existing passing test.

Public benchmarks overstate real ability. On SWE-bench Pro (arXiv 2509.16941, v2 Nov 2025; 1,865 tasks = 731 public / 858 held-out / 276 commercial, across Python/Go/TypeScript/JavaScript), agents scoring 70%+ on SWE-bench Verified drop sharply: **Claude Opus 4.1 ~22.7% → 17.8%** and **GPT-5 ~23.1% → 14.9%** moving from public to private commercial subsets.

```
nightly harness:
  for issue in curated[30..100]:        # resolved issues from git history + fixing tests
    checkout pre-fix commit
    agent.attempt(issue)
    score: resolution_rate, p2p_pass_rate
  alert if success_rate regresses week-over-week after a model/prompt upgrade
```

Track per-agent success rate on your own harness as the **headline**, and surface regression behaviour explicitly (most public harnesses run P2P tests but don't report them). **Only your own tasks measure your actual risk.** See [05-test-suite-architecture.md](05-test-suite-architecture.md) for the underlying test infrastructure.

---

## 2. Observability

### Adopt OpenTelemetry GenAI semantic conventions — but pin a version

OTel GenAI semantic conventions are the emerging vendor-neutral standard, supported by Datadog, Honeycomb, New Relic, and major frameworks. The span tree:

- top-level **`invoke_agent`** span
- child **`chat`** spans per LLM call
- **`execute_tool`** spans per tool invocation

Key attributes: `gen_ai.operation.name` (values `create_agent`, `invoke_agent`, `execute_tool`, `chat`), `gen_ai.request.model`, and `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens` (input tokens SHOULD include cached tokens).

**Critical caveat:** most of these conventions are still in **Development/experimental** status and not API-stable — attribute names can change. Pin behaviour:

```bash
export OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental
# record which semconv version you're on; capture prompt/completion CONTENT
# only behind an opt-in flag (privacy + cost)
```

### Log per-run: tokens, cost, tool calls+args+results, latency/TTFT, errors

For every agent run capture a **hierarchical trace** where each LLM call and tool invocation is a span carrying: prompt tokens, cached tokens, completion tokens, reasoning tokens, estimated cost, tools considered vs invoked, args passed and responses returned, latency and time-to-first-token per hop, and any errors.

Maintain token visibility at **three levels**, each answering a different operational question:

| Level | Field | Question it answers |
|---|---|---|
| Per-call | prompt/completion tokens | Why is latency rising? |
| Per-request | context-window utilization | Are we near truncation? |
| Per-step in trace | tokens-per-step | Is there a runaway loop? |

**Alerts** (use rolling percentiles, not absolutes — specific thresholds are team-specific):

- tokens/cost-per-run exceeding rolling **p95** → runaway-loop / prompt-bloat detector
- context-window utilization above **~80-90%** → truncation risk
- tool-error-rate spikes
- **hard `max-steps` / `max-cost` circuit breaker per run**

Pipe OTel into **Langfuse** (MIT-licensed core, self-hostable, OTLP endpoint `/api/public/otel`), **Braintrust** (eval-driven, native GitHub Action CI gate), or **LangSmith** (deepest LangChain/LangGraph integration). Without per-step token/cost/latency you cannot debug loops, attribute spend, or catch regressions.

### Cost and per-seat usage dashboards (Copilot telemetry caveat)

Token spend is now a material line item; dashboard it **per-seat AND per-repo/per-team**. Usage-based and hybrid billing means heavy agentic users can run **2-5x base subscription cost** — attribute spend and alert on seats exceeding rolling p95 monthly spend.

**Freshness-critical:** GitHub's Copilot **usage metrics dashboard reached GA in February 2026** (Enterprise → AI Controls → Copilot → Metrics), and the **legacy Copilot Metrics API was sunset April 2, 2026**. Many tutorials still reference retired endpoints — verify you are on the new Usage Metrics endpoints. **Seat/license data is NOT in the usage metrics report**; the Copilot user-management API is the source of truth for seats. Open-source dashboards exist (`microsoft/copilot-metrics-dashboard`, `copilot-metrics-viewer`).

---

## 3. Org metrics

### Extend DORA, do not replace it

The **2025 DORA report** (Google Cloud / dora.dev), with ~90% of developers using AI tools, found AI adoption correlates **positively with throughput but continues to increase delivery instability** unless the org has strong foundations: a clear AI stance, healthy/AI-accessible internal data, strong version control, working in small batches, user-centric focus, and quality internal platforms.

**Reporting only the four keys is misleading** when much committed code is AI-generated: deployment frequency can rise purely because AI emits more code while change-fail rate quietly worsens.

- **Keep** the four keys (deployment frequency, lead time, change-fail rate, MTTR).
- **Segment** every key by **AI-authored vs human-authored** changes.
- **Report change-fail-rate and rework on the same dashboard as throughput** so a throughput gain coupled with a quality drop is visible.

### Track quality and comprehension debt as leading indicators

AI accelerates code production faster than humans can review or understand it, creating **comprehension debt** — the widening gap between code an org has and code it understands (Addy Osmani / O'Reilly Radar).

**Leading indicators** (predict trouble): review-queue depth, PR size, rework rate, judge-vs-human kappa drift.
**Lagging indicators**: deployment frequency, change-fail rate.

```
Dashboard panels:
  median + p90 PR review time   # high performers review within ~4h; >24h avg = red flag
  PR size distribution           # enforce a max-PR-size limit
  % PRs merged with zero review  # alert if rising
  rework / revert rate within 30 days
```

Add comprehension checkpoints: require the author to **explain AI-generated changes**, cap PR size, and use AI-assisted review specifically on AI-generated diffs. (Confidence: **medium** — widely cited 2026 figures on PR-review-time multiples and AI bug-rates are directional, not precise; present them qualitatively.) See [17-team-process-and-org.md](17-team-process-and-org.md).

### Unify with DX Core 4

**DX Core 4** (from getDX — created by Laura Tacho and Abi Noda in collaboration with the DORA/SPACE/DevEx authors, including Nicole Forsgren, as advisors; introduced **December 2024**) unifies DORA, SPACE, and DevEx into four dimensions: **speed, effectiveness, quality, business impact**. It is explicitly positioned to expose the AI productivity gap (individual output rising while org delivery stays flat, plus rising AI-driven technical debt).

The value is the **deliberate pairing of a speed metric with a quality metric** so you cannot game one without the other showing. Adopt one speed metric (PR throughput or lead time) explicitly balanced by one quality metric (change-fail rate, rework, or mutation score) and one effectiveness/DevEx survey signal — segmented by AI-authored vs human where possible. (Confidence: **medium**.)

---

## TypeScript / React / Storybook specifics

This stack has unusually strong deterministic graders that should form the backbone of agent evals and the CI quality gate for AI-generated code. **Lean on these before any LLM judge** — they are reproducible, fast, and bias-free.

```jsonc
// stryker.config.json — CAVEAT: defaults are high:80, low:60, break:0,
// and break:0 means Stryker NEVER fails the build. You MUST set break
// explicitly to gate CI; below break, Stryker exits non-zero.
{
  "thresholds": { "high": 80, "low": 60, "break": 50 }, // 50-60 on touched files
  "coverageAnalysis": "perTest"                          // keeps CI runtime sane
}
```

```js
// .storybook/preview.js — addon-a11y wraps axe-core; 'error' FAILS CI on WCAG violations
export const parameters = { a11y: { test: 'error' } };
```

**CI gate for AI-authored PRs**, in order (cheap → expensive):

1. `tsc --noEmit` — catches a large class of AI errors for free
2. `eslint .`
3. `vitest run` — fast unit/component runner
4. `stryker run` — test-strength score beyond coverage (set `break` explicitly, 50-60 on touched files)
5. Storybook 9 Vitest-based test-runner — interaction tests, visual regression, a11y (`parameters.a11y.test = 'error'`)
6. **Only after these pass**, optionally run a calibrated LLM rubric for readability/maintainability.

See [13-typescript-react-storybook.md](13-typescript-react-storybook.md) and [04-static-analysis-and-ci-cd-gates.md](04-static-analysis-and-ci-cd-gates.md).

---

## Freshness (2026)

Current as of June 2026. Moving targets: **OTel GenAI semconv is still Development/experimental** — attribute names can change, so pin `OTEL_SEMCONV_STABILITY_OPT_IN`. **Copilot usage dashboard went GA Feb 2026; the legacy Metrics API was sunset April 2, 2026** — many tutorials reference retired endpoints. SWE-bench Pro and the DORA 2025 report are the most recent primary sources. **Stryker's `break` threshold defaults to 0 (never fails the build)** — you must set it. PR-review-time multiples and AI bug-rate figures circulating in 2026 are directional, not precise.

## Trade-offs & confidence

- **High confidence:** deterministic graders, eval-in-CI, internal harness over leaderboards, OTel GenAI spans, per-run trace fields, DORA-extension, the TS/React/Storybook tool config. These are primary-sourced and verified.
- **Medium confidence:** comprehension-debt thresholds, DX Core 4 framing, and any specific PR-review-time / verbosity-bias / AI-bug-rate magnitude — present these qualitatively.
- **Cost vs signal:** LLM judges are slower, costlier, and driftier than code graders; reserve them for genuinely open-ended quality and always pair with a calibration set.

---

## Sources

- [Anthropic — Demystifying evals for AI agents](https://anthropic.com/engineering/demystifying-evals-for-ai-agents) (2026)
- [Braintrust — Eval-driven development](https://www.braintrust.dev/articles/eval-driven-development) (2026)
- [Braintrust — Best AI evals tools for CI/CD](https://www.braintrust.dev/articles/best-ai-evals-tools-cicd-2025) (2025)
- [Braintrust — Agent observability complete guide](https://www.braintrust.dev/articles/agent-observability-complete-guide-2026) (2026)
- [Braintrust — How to track LLM token usage](https://www.braintrust.dev/articles/how-to-track-llm-token-usage-2026) (2026)
- [LangChain — Agent evaluation readiness checklist](https://www.langchain.com/blog/agent-evaluation-readiness-checklist) (2026)
- [Agentest — Vitest-style E2E testing for AI agents](https://dev.to/raffael_p/agentest-vitest-style-e2e-testing-for-ai-agents-44j1) (2026)
- [Future AGI — LLM-as-judge best practices](https://futureagi.com/blog/llm-as-judge-best-practices-2026) (2026)
- [Future AGI — Evaluating LLM judge bias mitigation](https://futureagi.com/blog/evaluating-llm-judge-bias-mitigation-2026/) (2026)
- [Deepchecks — LLM judge calibration](https://deepchecks.com/llm-judge-calibration-automated-issues/) (2026)
- [SWE-bench Pro (arXiv 2509.16941)](https://arxiv.org/pdf/2509.16941) (v2, Nov 2025)
- [Scale — SWE-bench Pro blog](https://scale.com/blog/swe-bench-pro) (2025)
- [Scale — SWE-bench Pro public leaderboard](https://labs.scale.com/leaderboard/swe_bench_pro_public) (2026)
- [OpenTelemetry — GenAI spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/) (2026)
- [OpenTelemetry — GenAI agent spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/) (2026)
- [Greptime — OpenTelemetry GenAI semantic conventions](https://greptime.com/blogs/2026-05-09-opentelemetry-genai-semantic-conventions) (May 2026)
- [DORA report 2025](https://dora.dev/dora-report-2025/) (late 2025)
- [Google Cloud — Announcing the 2025 DORA report](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report) (2025)
- [getDX — Introducing DX Core 4](https://getdx.com/news/introducing-the-dx-core-4/) (Dec 2024)
- [getDX — DX Core 4](https://getdx.com/dx-core-4/) (2025)
- [LeadDev — DX Core 4 aims to unify developer productivity frameworks](https://leaddev.com/reporting/dx-core-4-aims-to-unify-developer-productivity-frameworks) (2025)
- [O'Reilly Radar — Comprehension debt](https://www.oreilly.com/radar/comprehension-debt-the-hidden-cost-of-ai-generated-code/) (2026)
- [Addy Osmani — Comprehension debt](https://addyosmani.com/blog/comprehension-debt/) (2026)
- [CodeRabbit — 2025 was the year of AI speed, 2026 the year of AI quality](https://www.coderabbit.ai/blog/2025-was-the-year-of-ai-speed-2026-will-be-the-year-of-ai-quality) (2026)
- [Stryker — Configuration](https://stryker-mutator.io/docs/stryker-js/configuration/) (2026)
- [Storybook — Accessibility testing](https://storybook.js.org/docs/writing-tests/accessibility-testing) (2026)
- [Storybook — Component testing with Storybook and Vitest](https://storybook.js.org/blog/component-test-with-storybook-and-vitest/) (2026)
