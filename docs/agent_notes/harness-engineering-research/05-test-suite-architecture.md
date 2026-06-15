# Architecting Test Suites for an AI-Heavy Workflow

> **TL;DR** — When an agent writes most of your tests, the test suite's job inverts: it is no longer just "does the code work" but "did the agent fool itself." AI produces high *line coverage* with low *fault-detection power* — the canonical case study hit **93% line coverage while mutation score (MSI) was 58.6%**, a ~34-point gap of tests that ran the code but asserted nothing meaningful. Architect around three principles: **measure what tests catch, not what they touch** (mutation testing over coverage), **enforce test-first with a deterministic-ish gate** (TDD Guard), and **shape the suite as a Testing Trophy** (heavy integration, thin E2E, big static base) so agents write the cheap, high-value middle and you reserve scarce E2E budget for real user flows.

**Top actionable takeaways**

- **Gate on mutation score, not coverage.** Run Stryker on changed/critical modules; treat MSI as the real "did the AI's tests assert anything" signal. Set a per-package MSI threshold and ratchet it up.
- **Adopt the Testing Trophy** (static → integration → small E2E), not the pyramid. Let agents write the fat integration layer; keep E2E tiny and load-bearing.
- **Make test-first mechanical** with TDD Guard's PreToolUse hook — but know enforcement is *LLM-judged*, not a deterministic rule, so it can misfire.
- **Review AI tests for failure modes**, not just green checks: ban brittle full-DOM snapshots and "assert-everything" mocks in review/lint.
- **Use Storybook stories as the component contract** (`@storybook/addon-vitest`, `composeStories`, a11y) so component tests and docs are one artifact.
- **Quarantine flake; never blanket-retry.** Lean on Playwright's web-first auto-retrying assertions to kill the common race conditions at the source.
- **Property-based tests (fast-check)** for pure logic and **contract tests (Pact/OpenAPI)** for service seams catch the bug classes example-based AI tests systematically miss.
- **Turn on Vitest 4.1's agent reporter and test tags** to cut token spend on every agent test run.

See also: [Overview](00-overview.md) · [Static Analysis & CI/CD Gates](04-static-analysis-and-ci-cd-gates.md) · [TypeScript + React + Storybook](13-typescript-react-storybook.md) · [Linting for AI](09-linting-for-ai.md) · [Preventing AI Slop](08-preventing-ai-slop.md) · [Custom Hooks](12-custom-hooks.md)

---

## The core problem: AI optimizes for the metric you show it

An agent told to "add tests until coverage is green" will reliably produce tests that *execute* code without *constraining* it: calls with no assertions, assertions on mocks that can never fail, snapshots that ossify whatever the current (possibly wrong) output is. Coverage counts lines touched; it cannot see whether a test would *fail* if the code broke. That is the entire gap.

**The case study (confidence: high).** A documented run had an AI report **93.1% line coverage** on a module; a Stryker mutation run on the same code with **116 mutants** scored a **58.62% baseline MSI** — i.e., over 40% of injected bugs slipped past the "passing" suite. Iterating with the mutation report as the agent's feedback signal raised MSI to **93.10%** over three rounds. The lesson is not "93% is the target"; it is that **line coverage and fault-detection diverged by ~34 points**, and only the mutation score surfaced it.

This reframes the whole architecture: every layer below is chosen to produce *signals an agent cannot game by adding empty tests*.

---

## Measure fault detection: mutation testing over coverage

Mutation testing makes tiny semantic edits to your source (`>` → `>=`, `&&` → `||`, remove a statement) and checks whether your tests *fail*. A surviving mutant is a bug your tests would not catch. The **Mutation Score Index (MSI)** = killed / total mutants — the closest thing to a "would these tests catch a regression" number.

**StrykerJS** is the JS/TS standard. Its Vitest runner support has existed since **StrykerJS 7.0 (June 2023)** — this is *not* a 2026 development, despite occasional mislabeling; treat it as mature, stable tooling.

```jsonc
// stryker.conf.json
{
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "testRunner": "vitest",
  "reporters": ["html", "clear-text", "progress"],
  "coverageAnalysis": "perTest",
  // Don't mutate the whole repo every PR — scope to the module under change.
  "mutate": ["src/billing/**/*.ts", "!src/**/*.test.ts"],
  "thresholds": { "high": 80, "low": 60, "break": 65 }
}
```

Practical guidance:

- **Don't run Stryker on every PR over the whole repo** — it is minutes-to-hours. Run it **nightly** and/or **scoped to changed packages/critical modules** (billing, auth, money math). See the layered-gate ordering in [Static Analysis & CI/CD Gates](04-static-analysis-and-ci-cd-gates.md).
- **Set `break` (the failing threshold) and ratchet it.** Start at the current MSI, then nudge up; this stops agents from regressing test quality while staying achievable.
- **Feed the surviving-mutant report back to the agent.** The HTML/JSON report listing exact survived mutations is an excellent self-correction prompt: "here are the bugs your tests miss — add assertions that kill them."

**Caveat — Vitest *browser* mode (confidence: medium).** Stryker's instrumentation assumes **Node execution**; it does **not** instrument Vitest *browser mode*. If your component tests run in a real browser (the Storybook/Vitest browser path below), Stryker can't mutate them directly. The workaround is to have an **AI agent run the mutation loop manually** (apply a mutation, run the browser tests, record kill/survive) — viable but not push-button. Run Stryker against the Node-executed unit/logic layer where it works cleanly, and treat browser-mode mutation as best-effort.

---

## Shape: the Testing Trophy, not the pyramid

The classic pyramid (mostly unit, few integration, fewer E2E) optimizes for a world where integration tests were slow and flaky. With modern tooling (Vitest, Testing Library, MSW, Playwright) the **Testing Trophy** (Kent C. Dodds) is the better target:

```
        /\        E2E         — few, load-bearing user journeys (Playwright)
       /  \
      /____\      Integration — THE BULK: components + real-ish deps (MSW)
     /      \
    /________\    Unit        — pure logic, edge cases (Vitest + fast-check)
   /__________\   Static      — tsc --noEmit, ESLint, type tests (free, always-on)
```

Why this matters for AI workflows:

- **The static base is your cheapest, most reliable gate.** `tsc --noEmit` and lint catch a large class of agent mistakes before any test runs, deterministically. (See [Linting for AI](09-linting-for-ai.md).)
- **Integration is where agents add the most value safely.** A component test that renders with realistic data and asserts user-visible behavior is high-signal and hard to fake-pass. Let the agent live here.
- **Keep E2E tiny and curated.** E2E is slow, flake-prone, and expensive in agent loops. Reserve it for a handful of critical journeys (signup → pay → confirm). Do **not** let an agent "add E2E coverage" freely; it will generate brittle, redundant flows.

---

## Enforce test-first: TDD Guard (with honest caveats)

**TDD Guard** (by nizos) is a Claude Code **PreToolUse hook** on `Write`/`Edit`/`MultiEdit`: before an agent edits implementation, it checks that there is a *failing* test justifying the change, enforcing red-green discipline an agent would otherwise skip.

The important nuance for an AI-heavy workflow: **enforcement is performed by an LLM** analyzing test results, file paths, and todos — **not a deterministic rule**. So:

- It catches the common "wrote code with no test" pattern well, and nudges agents into red-green-refactor.
- It can **misjudge** edge cases (refactors, config files, generated code) — both false blocks and occasional false passes. Treat it as a strong *behavioral nudge*, not a hard invariant.
- Pair it with **deterministic** gates downstream (the mutation threshold, changed-line coverage, CI `--max-warnings 0`) so a misfire never silently ships untested code.

```jsonc
// .claude/settings.json — illustrative
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Write|Edit|MultiEdit",
        "hooks": [{ "type": "command", "command": "tdd-guard" }] }
    ]
  }
}
```

See [Custom Hooks](12-custom-hooks.md) for hook-authoring patterns and [Agent Guidance & Context](10-agent-guidance-and-context.md) for encoding the TDD policy in `AGENTS.md`.

---

## Review AI tests for failure modes (not just green)

A passing AI test suite is necessary but nowhere near sufficient. The recurring failure modes to **ban in review and, where possible, in lint**:

| Anti-pattern | Why it's bad with AI | Counter-measure |
|---|---|---|
| **Full-DOM / large snapshots** | Agents regenerate snapshots to match output; the snapshot ossifies bugs and breaks on trivial change | Forbid `toMatchSnapshot` on big trees; prefer targeted assertions / inline snapshots for small values |
| **Assert-everything mocks** | `expect(mock).toHaveBeenCalled()` on a mock that *can't* not be called — tautology | Assert on **observable behavior** (rendered text, returned value), not call counts |
| **Testing implementation details** | Internal state/private method tests that break on refactor, not on bugs | Test through the public interface (Testing Library philosophy) |
| **Conditional assertions** | `if (x) expect(...)` — silently passes when branch not taken | Lint rule banning assertions inside conditionals (`eslint-plugin-jest`/`vitest`) |
| **No-assertion tests** | Coverage-padding with zero `expect` | `expect-expect` lint rule + the mutation gate (a no-assertion test kills zero mutants) |

The mutation score is the backstop here: **all of these anti-patterns produce surviving mutants**, so a real MSI threshold mechanically catches what review misses. Lint rules are the fast first pass; MSI is the truth.

---

## TypeScript / React / Storybook specifics

This is where the suite architecture gets concrete. See [TypeScript + React + Storybook](13-typescript-react-storybook.md) for the broader stack.

### Stories as the component contract

A **CSF3 story** is simultaneously documentation, a manual sandbox, and a test fixture. With **`@storybook/addon-vitest`**, stories run as **browser-mode component tests** (real DOM, real events), and the `play` function becomes the test body. This collapses "write a story" and "write a component test" into one artifact — ideal when an agent authors both.

```tsx
// Button.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, within } from 'storybook/test';
import { Button } from './Button';

const meta: Meta<typeof Button> = { component: Button };
export default meta;
type Story = StoryObj<typeof Button>;

export const ClicksOnce: Story = {
  args: { children: 'Save' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};
```

Key Storybook 10.3 levers for an AI workflow:

- **`composeStories`** lets you import stories into plain Vitest/RTL tests and reuse their args/decorators — reuse the agent's story fixtures in unit tests instead of duplicating setup.
- **A11y addon (axe)** runs accessibility checks inside the test run — a deterministic gate agents otherwise ignore.
- **Storybook MCP server (`@storybook/addon-mcp`, Storybook 10.3+)** exposes real props/stories/tests to the agent so it stops hallucinating component APIs. Confidence: high that this reduces invented props; note it is React-only and **Vite-only** today (e.g. `@storybook/react-vite`, `@storybook/nextjs-vite`), serving at `/mcp` on the dev server.

### Web-first assertions kill races at the source

For E2E and browser component tests, **Playwright's web-first assertions** (`expect(locator).toBeVisible()`, `toHaveText()`, etc.) **auto-retry** until a timeout (default ~5s). This eliminates the single biggest source of AI-written flake: hard-coded waits and "assert immediately after click." Prefer `await expect(locator).toHaveText('Done')` over `expect(await locator.textContent()).toBe('Done')`.

### Vitest 4.1: cheaper agent runs

Two 4.1 features are directly aimed at AI workflows (confidence: high):

- **Agent reporter** — a minimal reporter that suppresses passing-test output and console noise to cut token usage; it can auto-enable (via `std-env`) when an AI agent is detected.
- **Test tags** — tag tests (`@slow`, `@flaky`, `@critical`) and filter/configure by tag, so agents run a relevant subset instead of the whole suite.

```ts
// vitest.config.ts (4.1)
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    reporters: process.env.CI ? ['default'] : ['default'],
    // 'agent' reporter auto-engages under detected AI agents; can be set explicitly.
  },
});
```

> Note: the GitHub CLI (`gh`) is a fine way to drive CI from an agent, but that is general practice — it is **not** a Vitest 4.1 feature. Don't conflate the two.

---

## Eliminate flake: quarantine, don't retry

Blanket test retries (`retries: 2`) hide flake and let real regressions slip through intermittently — corrosive when an agent reads "green" as "correct." The documented community consensus is **quarantine, not retry**:

1. **Detect** flaky tests (re-run failures off the critical path, or use a flake-detection job).
2. **Quarantine** them — move to a non-blocking lane, file a ticket — so they stop blocking merges *without* masking new failures.
3. **Fix the root cause** (usually a missing web-first wait, a shared-state leak, or time/ordering dependence), then return to the blocking lane.

Pair this with deterministic test ordering and isolated fixtures. An agent is excellent at fixing a *specific* flaky test when handed the failure and the web-first-assertion pattern; it is terrible at deciding *which* flake matters — so keep quarantine a human-curated lane.

---

## Catch the bugs example-based tests miss

AI writes example-based tests: a few hand-picked inputs. Two techniques cover the systematic blind spots.

### Property-based testing — fast-check (pure logic)

For pure functions (parsers, formatters, money math, reducers), **fast-check** generates hundreds of inputs against an invariant and **shrinks** any counterexample to a minimal failing case — exactly the edge cases an agent forgets.

```ts
import fc from 'fast-check';
import { test } from 'vitest';
import { slugify } from './slugify';

test('slugify is idempotent and url-safe', () => {
  fc.assert(fc.property(fc.string(), (s) => {
    const once = slugify(s);
    return once === slugify(once) && /^[a-z0-9-]*$/.test(once);
  }));
});
```

### Contract tests — Pact / OpenAPI (service seams)

When an agent edits a backend endpoint, the consumer's mocks happily keep passing while the real contract drifts — a silent break. **Consumer-driven contract tests (Pact)** and **OpenAPI/schema validation** catch provider drift at the seam, before integration. They are complementary: OpenAPI validates the schema shape; Pact validates the *actual* consumer expectations against the provider. Add a contract check to CI for every cross-service boundary an agent can touch.

---

## Freshness (2026)

**Current / post-late-2025:**

- **Vitest 4.1 agent reporter + test tags** (May 2026) — genuinely new, AI-workflow-specific; turn it on.
- **Storybook 10.3 MCP server / A11y / Vitest addon** (2026) — current; MCP exposure of components to agents is the fresh capability.
- **TDD Guard** (active 2026) — current; remember enforcement is LLM-judged.
- **Mutation-over-coverage as the AI-era test-quality gate** — the framing crystallized in 2026 case studies, even though the tooling predates it.

**Stable, *not* new (don't market as 2026):**

- **StrykerJS Vitest runner** — shipped in **Stryker 7.0, June 2023**. Mature, not a 2026 feature.
- **Testing Trophy, fast-check, Pact/OpenAPI, Playwright web-first assertions** — all pre-2026, well-established. They are *more* valuable in an AI workflow, but they are not new.

**Honest trade-offs / open debates:**

- **Mutation testing cost.** Real but minutes-to-hours; the live debate is *scoping* (changed-files/nightly) vs. coverage-gate-only. Recommendation: scoped + nightly, MSI threshold on critical packages. (confidence: medium-high)
- **TDD-Guard reliability.** LLM enforcement is a soft gate; some teams find it noisy. (confidence: medium)
- **Browser-mode mutation testing.** No first-class support today; the agent-driven manual loop is a workaround, not a product. (confidence: medium)

---

## Sources

- [Anthropic — Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) (2025-11-26)
- [OpenAI Codex — Best practices](https://developers.openai.com/codex/learn/best-practices) (2026)
- [Mutation-testing case study — "I Had 93% Test Coverage. Then I Ran Mutation Testing."](https://dev.to/jghiringhelli/the-ai-reported-931-coverage-it-was-34-290k) (2026)
- [StrykerJS 7.0 announcement (Vitest + Tap runner support)](https://stryker-mutator.io/blog/announcing-stryker-js-7/) (2023-06-05)
- [Mutation Testing with AI Agents when Stryker doesn't support Vitest browser mode — alexop.dev](https://alexop.dev/posts/mutation-testing-ai-agents-vitest-browser-mode/) (2026)
- [TDD Guard (nizos) — PreToolUse hook](https://github.com/nizos/tdd-guard) (2026-05)
- [Storybook 10.3 — MCP, A11y, Vitest addon](https://storybook.js.org/blog/storybook-10-3/) (2026)
- [Vitest 4.1 for AI agents — InfoQ](https://www.infoq.com/news/2026/05/vitest-4-1-ai-agents/) (2026-05)
- [Playwright — web-first / auto-retrying assertions](https://playwright.dev/docs/test-assertions) (2026)
- [fast-check — why property-based testing](https://fast-check.dev/docs/introduction/why-property-based/) (2026)
- [Pact — consumer-driven contract testing](https://docs.pact.io/) (2026)
- Kent C. Dodds — [The Testing Trophy](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications) (concept reference)
