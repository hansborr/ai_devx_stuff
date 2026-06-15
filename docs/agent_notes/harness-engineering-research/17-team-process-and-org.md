# Team, Process & Organizational Change (the new SDLC)

> **TL;DR** — By mid-2026 the SDLC bottleneck has moved from *writing* code to *reviewing and integrating* it. When agents emit diffs faster than humans can vet them, the review queue becomes the binding constraint, and the failure mode is rubber-stamping. The two highest-leverage process changes are (1) shrinking the review unit (small/atomic/stacked PRs behind a merge queue) and (2) running a two-tier review where automated gates clear mechanical issues before a human judges architecture, threat model, and business logic. Everything else — accountability, apprenticeship, governance tiers, and metrics — exists to keep humans *in the loop and on the hook* as delegation scales.

## Top actionable takeaways

- **Shrink the unit of review.** Warn at ~300 changed lines, hard-block above a cap, require a plain-language intent statement on every PR. Adopt stacked PRs (Graphite or GitHub-native) plus a merge queue so work continues while earlier PRs are in review.
- **Run a two-tier review.** Machine tier (lint, type-check, tests, SAST on auth/data paths, hallucinated-import verification, visual regression) must be green before a human tier reviews design and logic. Add an adversarial pass with a second model against a checklist of known AI failure modes.
- **Accountability never transfers to the AI.** Name a human sponsor per AI PR; the AI cannot be approver-of-record; the merger owns the on-call page; no "the model did it" in postmortems.
- **Protect human skill.** Review-first apprenticeship, weekly AI-diff teardowns, and periodic no-AI work to counter the comprehension gap.
- **Govern with tiered autonomy** (T1 autonomous → T4 prod/secrets/auth requires human approval), enforced in CI/CD, not in a wiki.
- **Fix your metrics.** Extend DORA with AI attribution, churn/durability, and review-load. Never reward lines or PRs merged.

---

## 1. The bottleneck moved

The economics of generation collapsed; the economics of *trust* did not. A single engineer can now spin up multiple agents, each producing review-ready diffs in minutes. The constraint is the human (and human-supervised) verification capacity downstream. Two second-order effects dominate:

- **Rubber-stamping rises with diff size.** Both human reviewers and AI review tools give markedly worse signal on large diffs; review quality declines once a PR exceeds roughly **300 changed lines** ([Codacy](https://blog.codacy.com/ai-breaking-code-review-how-engineering-teams-survive-pr-bottleneck)). Big AI-generated PRs are where defects slip through *because* they look plausible.
- **Integration is harder, not easier.** CircleCI's 2026 data shows **main-branch pipeline success at ~70.8%** — the lowest in five years against a historical ~90% benchmark — attributed to AI-generated code being harder to validate when validation lags generation ([Thoughtworks on CircleCI 2026](https://www.thoughtworks.com/insights/blog/generative-ai/a-thoughtworks-perspective-on-circleci-s-2026-state-of-software-)).

The rest of this document is the process response.

---

## 2. Shrink the review unit + run a two-tier review

### 2.1 Small, atomic, stacked PRs

The single most effective fix is making each PR small enough that both a human and an AI reviewer can actually reason about it.

- **Atomic PRs:** one logical change per PR. A plain-language *intent statement* ("what this should do and why") is mandatory — it is the spec the reviewer checks the diff against, and it is where AI-written code most often diverges from intent.
- **Stacked PRs:** break a feature into a dependent chain so each link is small and reviewable in isolation, and later links keep moving while earlier ones are in review. Use **Graphite** (stacked PRs + merge queue + review agent) or **GitHub-native stacked PRs** (shipped April 2026).
- **Merge queue:** required for trunk-based development to work at AI throughput. Trunk-based fits AI *only* with a merge queue plus fast, blameless revert as the default recovery action.

```yaml
# Example PR-size gate (CI). Warn early, block late.
pr_size_gate:
  warn_threshold_changed_lines: 300   # research shows review quality drops past ~300
  block_threshold_changed_lines: 800  # hard cap; force a split or explicit override
  require_intent_statement: true      # PR body must contain a non-boilerplate "## Intent" section
```

> **Trade-off:** stacking adds rebase/coordination overhead and tooling lock-in. Worth it once a team regularly produces >1 PR per feature per day; overkill for a solo maintainer.

### 2.2 Two-tier review: machines first, humans second

Gate the human's attention behind automation so reviewers spend it on the things only humans can judge.

**Tier 1 — Machine (must be green before a human looks):**

- Formatting + lint + type-check
- Unit/integration/e2e tests
- **SAST on auth/data-handling code paths** (auth, crypto, PII, query construction)
- **Hallucinated-import verification** — confirm every imported package/symbol actually exists and is the intended one (a top AI failure mode and a supply-chain vector; see [14-security-and-supply-chain.md](14-security-and-supply-chain.md))
- **Visual regression** for UI changes (see §5 and [07-ui-design-systems-enforcement.md](07-ui-design-systems-enforcement.md))

Automated checks reliably clear a *large share of low-level, mechanical issues* — formatting, lint, obvious type errors, and known-vulnerability patterns — so humans don't burn attention on them. (Avoid quoting a hard "catches X% of trivia" number: it isn't well-sourced, and SAST in particular is known to surface only a fraction of real security flaws while producing false positives. Treat Tier 1 as *necessary, not sufficient*.)

**Tier 2 — Human (judges what machines can't):**

- Architecture and boundaries (does this belong here? see [06-enforcing-architecture-and-standards.md](06-enforcing-architecture-and-standards.md))
- Threat model and business-logic correctness
- Whether the diff matches the stated intent

**Adversarial tier (cheap, high-value):** run a *second* model over the diff with an explicit checklist of AI failure categories — hallucinated APIs, plausible-but-wrong logic, dropped error handling, security regressions, over-broad refactors, test theater. This is a different prompt and ideally a different model than the one that wrote the code (see [15-evals-and-observability.md](15-evals-and-observability.md) and [08-preventing-ai-slop.md](08-preventing-ai-slop.md)).

---

## 3. Accountability: it never transfers to the AI

Diffusion of responsibility is the org-level risk that the [Ubi Interactive](https://www.ubi-interactive.com/technology/2026/05/23/ai-is-writing-the-code-but-accountability-is-becoming-harder-to-prove/) analysis flags: when "the AI wrote it," nobody owns it. Counter it with explicit, machine-recorded ownership.

- **Named human sponsor per AI PR.** Record it in commit metadata, not just the PR UI:

```text
feat(billing): prorate mid-cycle plan changes

Generated-by: claude-agent (orchestrated)
Reviewed-by: A. Engineer <a.engineer@example.com>
Signed-off-by: A. Engineer <a.engineer@example.com>
```

- **The AI cannot be the approver of record.** A human approval is required to merge; agent "LGTM" comments are advisory.
- **The merger owns on-call.** Whoever clicks merge carries the page for that change.
- **No blaming the AI in postmortems.** Root-cause the *process* that let an unreviewed/under-reviewed diff ship.

---

## 4. People: skills, roles, and hiring

### 4.1 Skill atrophy is a real risk — calibrate the evidence

Heavy delegation erodes the comprehension that makes review possible. Anchor this on Anthropic's reported **comprehension gap** — engineers increasingly ship code they don't fully understand ([Anthropic 2026 agentic-coding trends](https://resources.anthropic.com/2026-agentic-coding-trends-report)) — and on developer-frustration signals such as **~45% of developers finding AI worse at debugging / hard-to-trust answers** in Stack Overflow's 2025 survey.

> **Caveat on the METR data (read before citing it).** The widely-quoted "developers ~19–20% *slower* with AI" result is from METR's **July 2025** RCT, which measured *early-2025* tools on experienced open-source devs — cite [that study](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study) if you use the figure. METR's **Feb 2026 update** does **not** confirm a slowdown/atrophy story: it walks back generalizability, says the newer experiment gives an unreliable signal, and suggests speedups have *likely grown* since early 2025 ([uplift update](https://metr.org/blog/2026-02-24-uplift-update/)). Do not present the 2026 update as evidence of slowdown. The atrophy concern stands on the comprehension-gap finding, not on METR.

### 4.2 Review-first apprenticeship

- Pair one senior over a junior + their agents (one human accountable for the output).
- **Weekly AI-diff teardowns:** the team reads a real agent-generated PR together and dissects what was right, wrong, and subtly wrong.
- **Periodic no-AI work** to keep fundamentals (debugging, reading unfamiliar code, designing from scratch) alive.

### 4.3 Role shift

Engineering work shifts toward **specifying, reviewing, and orchestrating**. Anthropic's data shows usage clustering around **~60% AI involvement** with only **~0–20% full delegation** — the "delegation gap": people use AI heavily but rarely hand off end-to-end. Keep agent instruction files tight: `AGENTS.md` / `CLAUDE.md` work best under roughly **150–200 instructions** before they degrade (see [10-agent-guidance-and-context.md](10-agent-guidance-and-context.md)).

### 4.4 Hire for judgment

Replace (or supplement) the from-scratch coding screen with a **flawed-agent-PR review exercise**: hand the candidate a realistic AI-generated PR seeded with a hallucinated import, a plausible-but-wrong branch, and a silent security regression. You're testing whether they can *find* the problems and articulate *why* — the actual job.

---

## 5. Governance: AI policy + tiered autonomy

A written AI policy is necessary but inert on its own. Pair it with **tiered autonomy enforced in CI/CD**:

| Tier | Scope | Gate |
|------|-------|------|
| **T1** | Docs, tests, internal tooling, low-blast-radius refactors | Autonomous; machine tier only |
| **T2** | Feature code in well-tested modules | Auto-merge if Tier 1 green + 1 human approval |
| **T3** | Shared libraries, schema/migrations, public APIs | Mandatory senior human review |
| **T4** | Production config, **secrets**, **auth**, payments, infra | Human approval required; agents may propose, never apply |

```yaml
# CI enforcement of autonomy tiers, by touched path
autonomy_tiers:
  T4_requires_human_approval:
    paths: ["**/auth/**", "**/secrets/**", "infra/**", "**/*migration*", "**/payments/**"]
    block_agent_self_merge: true
```

See [04-static-analysis-and-ci-cd-gates.md](04-static-analysis-and-ci-cd-gates.md) for how to wire these gates.

---

## 6. Metrics: extend DORA, and stop rewarding volume

DORA's four keys still matter, but at 30–70% AI-authored code they need extension and careful reading.

- **What DORA 2025 actually found:** AI now has a **positive** relationship with delivery *throughput* (a reversal from 2024) and a **negative** relationship with *stability* ([DORA AI Capabilities Model](https://services.google.com/fh/files/misc/2025_dora_ai_capabilities_model.pdf)). So don't claim "throughput stalls" as a DORA finding — it doesn't. The real risk DORA flags is **stability erosion**, which lines up with the CircleCI main-branch-success drop.
- **MTTR/change-fail-rate stay valid and become more important** as your tripwires for that stability risk.
- **Deploy-frequency and lead-time can mislead** as *productivity* signals when much of the code is AI-authored — they measure motion, not value, and are gameable. (This "they didn't improve as expected" framing comes from secondary commentary, not DORA itself — treat it as a caution, not a DORA result.)
- **Add three AI-era dimensions** ([Oobeya](https://oobeya.io/blog/dora-metrics-not-enough-2026), [LinearB benchmarks](https://linearb.io/resources/engineering-benchmarks)):
  - **AI attribution** — what fraction of merged code originated from agents.
  - **Durability / churn** — how much code is rewritten or reverted within N days (high churn = throughput masking rework).
  - **Review-load** — diffs per reviewer, time-in-review, queue depth. This is your *bottleneck* metric.

> **Never reward lines of code or PRs merged.** Under agentic generation these become trivially gameable and actively harmful incentives.

---

## 7. TypeScript / React / Storybook specifics

Strong types and strict lint are guardrails that let agents move fast without silently breaking things, and they shift bugs left into Tier 1. (Full detail in [13-typescript-react-storybook.md](13-typescript-react-storybook.md) and [09-linting-for-ai.md](09-linting-for-ai.md).)

```jsonc
// tsconfig.json — strict beyond "strict"
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,     // arr[i] is T | undefined — kills a common AI off-by-one bug
    "exactOptionalPropertyTypes": true,   // optional props can't be set to `undefined` — no sloppy assignment
    "noImplicitOverride": true
  }
}
```

```bash
# Gate in CI — type errors block merge (Tier 1)
tsc --noEmit
```

```jsonc
// typescript-eslint — rules that catch real AI failure modes
{
  "rules": {
    "@typescript-eslint/no-floating-promises": "error",      // dropped awaits / unhandled async
    "@typescript-eslint/strict-boolean-expressions": "error",// no truthiness footguns
    "@typescript-eslint/no-unsafe-assignment": "error",      // the no-unsafe-* family: contains `any` leakage
    "max-lines-per-function": ["warn", 50],                  // size caps fight agent over-generation
    "max-params": ["warn", 3]
  }
}
```

- **Linters:** [**Biome**](https://www.codewithseb.com/blog/advanced-linting-type-safety-eslint-typescript-guide) or **Oxlint** for fast feedback (run in pre-commit and CI); keep typescript-eslint for the type-aware rules above.
- **Tests:** **Vitest** + **React Testing Library** (RTL). RTL's behavior-focused queries resist the "tests that assert implementation detail" pattern agents tend to produce — see [05-test-suite-architecture.md](05-test-suite-architecture.md).
- **Visual regression on Storybook (Tier 1 for UI):** **Chromatic** (Storybook-native VRT) or **Applitools Eyes** (shipped a Storybook addon in early 2026). This catches the silent visual drift that unit tests miss when an agent restyles a component — see [07-ui-design-systems-enforcement.md](07-ui-design-systems-enforcement.md).

```bash
# CI snippet: type + lint + test + visual, as the machine tier
tsc --noEmit && biome ci . && vitest run && chromatic --exit-zero-on-changes
```

---

## Freshness (2026)

Current as of June 2026. Time-sensitive points: GitHub-native stacked PRs shipped **April 2026**; Applitools Eyes' Storybook addon shipped **early 2026**; CircleCI's **70.8%** main-branch success figure is from the **2026** state-of-software report; the METR situation is explicitly the **Feb 2026** update (which revises, not confirms, earlier slowdown claims). Tooling in this space moves fast — re-verify version-specific claims before acting.

## Confidence

**Medium-high.** All named tools, TS compiler flags, typescript-eslint rules, and the CircleCI / Stack Overflow / Anthropic figures are verified real and correctly characterized. The two-tier and stacked-PR practices are well-supported. Deliberately *softened or corrected* here: the "machine tier catches ~70–80% of trivia" number (unsourced — stated qualitatively), the METR citation (the 2026 update does not show slowdown), and the DORA throughput framing (DORA 2025 found AI *positive* for throughput, *negative* for stability — the inverse of a "throughput stalls" reading).

## Sources

- [Codacy — AI is breaking code review: how teams survive the PR bottleneck](https://blog.codacy.com/ai-breaking-code-review-how-engineering-teams-survive-pr-bottleneck) (2026)
- [Thoughtworks — perspective on CircleCI's 2026 State of Software](https://www.thoughtworks.com/insights/blog/generative-ai/a-thoughtworks-perspective-on-circleci-s-2026-state-of-software-) (2026) — 70.8% main-branch success
- [Anthropic — 2026 Agentic Coding Trends report](https://resources.anthropic.com/2026-agentic-coding-trends-report) (2026) — comprehension gap, 60%/0–20% delegation
- [METR — early-2025 AI / experienced OSS dev study](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study) (Jul 2025) — original ~19–20% slowdown result
- [METR — uplift update](https://metr.org/blog/2026-02-24-uplift-update/) (Feb 2026) — revises generalizability; suggests speedups likely grew
- [Rafay99 — AI coding skill atrophy (Anthropic research)](https://www.rafay99.com/blog/ai-coding-assistance-skill-atrophy-anthropic-research) (2026)
- [Ubi Interactive — AI writes the code, accountability gets harder to prove](https://www.ubi-interactive.com/technology/2026/05/23/ai-is-writing-the-code-but-accountability-is-becoming-harder-to-prove/) (May 2026)
- [Google / DORA — 2025 AI Capabilities Model (PDF)](https://services.google.com/fh/files/misc/2025_dora_ai_capabilities_model.pdf) (2025) — throughput positive, stability negative
- [Oobeya — DORA metrics aren't enough in 2026](https://oobeya.io/blog/dora-metrics-not-enough-2026) (2026)
- [LinearB — engineering benchmarks](https://linearb.io/resources/engineering-benchmarks)
- [Code with Seb — advanced linting & type safety (ESLint + TypeScript)](https://www.codewithseb.com/blog/advanced-linting-type-safety-eslint-typescript-guide)

*Related: [00-overview.md](00-overview.md) · [01-challenges-of-ai-development.md](01-challenges-of-ai-development.md) · [02-mitigations-and-best-practices.md](02-mitigations-and-best-practices.md) · [15-evals-and-observability.md](15-evals-and-observability.md) · [16-multi-agent-orchestration.md](16-multi-agent-orchestration.md)*
