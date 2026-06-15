# Prompting & Driving Agents Effectively

> **TL;DR** — By mid-2026 the way you *drive* a coding agent matters more than the words in your prompt. The consensus shape is small and contract-first: state the **outcome**, the **constraints**, and a **checkable done-when**, then wire an *external* verification signal (tests, typecheck, lint, build, a fresh-context reviewer) so the agent can self-correct against ground truth instead of grading its own homework. Plan before you touch code on non-trivial work, decompose into reviewable steps sized to your model, and treat every new model *family* as a fresh prompting baseline rather than a stack to port. Iterate; don't one-shot.

**Top actionable takeaways**

- **Lead with outcome + constraints + a checkable done-when**, not step-by-step instructions. Keep the smallest prompt that preserves the product contract; tune `reasoning_effort`/`verbosity`, not prose.
- **Give the agent an external way to check its work.** Run typecheck/lint/tests after every change; never let it edit tests to pass. Add a *separate* skeptical evaluator (fresh context, no write tools, default-FAIL contract).
- **Use TDD as the verification backbone** — red first, then green, never modify the tests — but mutation-test periodically because LLM tests are coverage-rich and detection-poor.
- **Plan-then-execute** when a change touches 3+ files or you can't describe it in one sentence. Persist the plan as a markdown file so it survives context resets.
- **Decompose into small, independently reviewable steps**, committing after each green step — but size the chunks to the model (larger for Opus 4.8 / GPT-5.5).
- **Rebuild prompts per model family.** Start from the smallest prompt, add instructions only per observed failure, re-tune effort/verbosity.
- **Point at existing patterns** (a real component file, a Storybook story) instead of describing conventions in prose. Keep one short `AGENTS.md` at the repo root.
- **Iterate; feed review-bot/CI comments straight back as the next prompt.**

See also: [Overview](00-overview.md) · [Codebase Structure for Agents](03-codebase-structure-for-agents.md) · [Static Analysis & CI/CD Gates](04-static-analysis-and-ci-cd-gates.md) · [Preventing AI Slop](08-preventing-ai-slop.md) · [Linting for AI](09-linting-for-ai.md) · [Custom Hooks](12-custom-hooks.md) · [TypeScript + React + Storybook](13-typescript-react-storybook.md)

---

## 1. Shape the prompt: outcome + constraints + done-when

The 2026 consensus prompt shape is Codex's four elements:

- **Goal** — the outcome in one sentence.
- **Context** — the files/errors the agent needs, supplied directly (e.g. `@`-mentions or pasted error output) rather than described.
- **Constraints** — the guardrails: *no new dependencies*, *do not touch the tests*, *match existing naming*, *stay within `src/billing/`*.
- **Done-when** — a verifiable condition: *`pnpm typecheck && pnpm test` is green*, *the new route returns 200 for the fixture*, *the story renders without a11y violations*.

The failure mode this fixes is vagueness. A one-line ask ("make the checkout flow better") forces the model to guess thousands of unstated requirements; each guess is a chance to drift. The fix is **not** a longer prompt — it is a *more contractual* one. Keep the smallest prompt that preserves the product contract, and reach for the model's structural controls (`reasoning_effort`, `verbosity`) before adding prose.

```
Goal: Add server-side pagination to the /orders list endpoint.

Context:
  @src/routes/orders.ts  @src/db/orders.repo.ts
  Failing case: GET /orders?limit=50 currently loads all rows.

Constraints:
  - No new deps. Reuse the existing Drizzle query builder.
  - Do not modify the orders schema or the existing tests' assertions.
  - Match the cursor-pagination shape already used in src/routes/users.ts.

Done-when:
  - GET /orders?limit=N&cursor=C returns N rows + a nextCursor.
  - pnpm typecheck && pnpm test passes.
  - A new test covers the cursor round-trip.
```

> **Confidence: high.** The four-element shape is confirmed verbatim in Codex's best-practices guide. The "smaller prompt, tune the knobs" guidance aligns with both the Codex docs and the GPT-5.5 prompting guidance.

---

## 2. Give the agent an external way to check its work

Agents praise their own output. The single strongest lever is to remove self-evaluation from the loop and replace it with a signal that *correlates with correctness*: tests, typecheck, linters, a build, a Playwright interaction, a screenshot diff, an eval score. The agent runs the check, sees the failure, and corrects — no human in the loop for the mechanical part.

Two reinforcing patterns from Anthropic's harness-engineering write-ups:

1. **A separate skeptical evaluator.** Anthropic's guidance is blunt: agents praise their own work, so a *separate* evaluator — fresh context, no write/edit tools, and a **default-FAIL contract that requires evidence to pass** — is far more reliable than asking the same agent "did you do it right?" The evaluator returns a PASS / NEEDS_WORK verdict, not a rewrite.
2. **A per-turn completion check.** Both Codex and Claude Code expose a `/goal` mechanism where a *separate, fast model* (Haiku, in Claude Code's case) checks a completion condition after each turn and tells the main agent whether it is actually done. This is the cheap, always-on version of the skeptical evaluator.

**Actionable:**

- Run `typecheck` → `lint` → `tests` after **every** change, not just at the end.
- **Never let the agent edit the tests to make them pass.** Make this an explicit constraint, and ideally enforce it mechanically (see §3 and [Custom Hooks](12-custom-hooks.md)).
- For long runs, set a `/goal` so a fast model gates "done" each turn.
- For high-stakes diffs, spin up a fresh-context reviewer that sees only the diff + criteria (see §8).

> **Confidence: high.** The "agents praise their own work → use a separate skeptical fresh-context evaluator returning a PASS/NEEDS_WORK-style verdict" framing matches the Anthropic effective-harnesses article closely. `/goal` with a separate fast evaluator model per turn is confirmed in both Codex and Claude Code.

---

## 3. TDD as the verification backbone

Red-green-refactor gives the agent stable external ground truth that it did not author for its own convenience. The Codex-endorsed loop:

1. Write the failing tests **first**.
2. Run them and **confirm they FAIL** (this proves the test actually exercises the new behavior).
3. Implement until they pass.
4. **Do not modify the tests** to get to green.

**The caveat that matters:** LLM-generated tests are systematically *coverage-rich but detection-poor*. One widely-cited write-up reports an AI test suite hitting **93% line coverage but only a 59% mutation score — a 34-point gap** between "lines executed" and "bugs actually caught." High coverage masks weak detection. The number to watch is the mutation score, not the coverage percentage.

**Actionable:**

- Enforce red-first with **TDD Guard** (a Claude Code hook that blocks implementation edits until a failing test exists). See [Custom Hooks](12-custom-hooks.md).
- Run **mutation testing** (e.g. Stryker for TS/JS) periodically — not every commit, but often enough to catch a suite that has quietly become assertion-light. See [TypeScript + React + Storybook](13-typescript-react-storybook.md).

> **Confidence: high** on the workflow (Codex) and on TDD Guard. The 93%/59% figures are the *line-coverage* vs *mutation-score* split from the cited write-up; the 34 is the **gap**, not a standalone "mutation-effective" rate.

---

## 4. Plan-then-execute on non-trivial tasks

For anything beyond a small, fully-specified change, get a plan before code touches disk.

- **Claude Code Plan Mode** (Shift+Tab twice) is a read-only mode with an approval gate: the agent investigates and proposes a plan, but cannot edit until you approve.
- **Heuristic for when to use it:** the change touches **3+ files**, *or* you can't describe it in one sentence. Below that bar, plan mode is overhead.
- **Spec-driven development** (GitHub's **Spec Kit**: `/constitution`, `/specify`, `/plan`, `/tasks`, `/implement`) treats the spec as the living artifact. The point is that you regenerate code from an *updated spec* rather than re-prompting from scratch when requirements shift — the spec, not the chat transcript, is the source of truth.

**Actionable:** ask for a **step-by-step plan with no code**, tighten and approve it, then **persist the approved plan as a markdown file in the repo** so it survives context compaction/reset and can be re-fed after a fresh start.

> **Confidence: high** on Plan Mode and the Spec Kit command set. **Caveat:** there is no published metric quantifying how much spec-driven development reduces regenerate-from-scratch cycles — treat the benefit as qualitative (the spec is the durable artifact you regenerate from), not as a measured "order-of-magnitude" win.

---

## 5. Decompose into small, verifiable, reviewable steps

Small chunks each carry context forward, fit the TDD loop, and keep diffs reviewable. Anthropic's long-running app harness builds **one feature at a time from a spec**, with the generator using **git for version control** as it goes; it tests through Playwright MCP and runs a planner/generator/evaluator three-agent loop.

**But granularity is model-dependent, and over-decomposition is a real cost.** Anthropic *removed* explicit sprint decomposition between Opus 4.5 and 4.6 because the stronger model sustains longer coherent work on its own — chopping a task into micro-steps for a capable model wastes tokens and breaks coherence. The lesson: decompose to fit the *weakest link*, and give larger chunks to stronger models.

**Actionable:**

- Have the agent emit a task list, then implement **task by task**, committing after each green step.
- Size the chunks to the model: tighter steps for smaller/cheaper models; larger, more autonomous chunks for **Opus 4.8 / GPT-5.5**-class models.
- Keep each diff small enough that a human (or a reviewer agent) can actually read it.

> **Confidence: high** on the "one feature at a time from a spec, generator has git" description and on the Opus 4.5→4.6 sprint-decomposition removal. (Do not over-specify the harness internals beyond "spec-driven, git-backed, three-agent.")

---

## 6. Treat each new model family as a fresh baseline

This is the least intuitive and most important 2026 shift. **Do not port your old prompt stack to a new model family — rebuild it.**

The GPT-5.5 guidance (Apr 2026) is explicit: begin migration from a *fresh baseline*, because some patterns that helped GPT-5.2/5.4 actively make GPT-5.5 *worse*. The mechanism is over-specification: legacy prompts that enumerate the process narrow the model's search space and suppress a stronger model's own planning. The same theme appears in Anthropic's Opus migration guidance — prompts written for older models are often too prescriptive and *reduce* output quality on the newer one.

**Actionable rebuild procedure:**

1. Start from the **smallest** prompt that states the goal and constraints.
2. Test on **representative examples**.
3. Add an instruction **only when you observe a specific failure** it fixes — not preemptively.
4. **Re-tune `reasoning_effort` and `verbosity`** for the new model rather than inheriting the old values.

> **Confidence: medium-high.** The fresh-baseline guidance, the "some GPT-5.2/5.4 patterns make GPT-5.5 worse," and the "legacy prompts over-specify the process and narrow the search space" claims are supported. The specific further claim that GPT-5.5 *literally ignores emphasis cues* (ALL CAPS / bold / "IMPORTANT") could **not** be confirmed against a reachable primary source — treat it as unverified, and rely on the well-supported "don't over-specify the process" point instead.

---

## 7. Calibrate eagerness and reasoning effort

GPT-5.x exposes two relevant knobs:

- **`reasoning_effort`** — `minimal` → `xhigh`. **Medium is the interactive-coding default; High/xhigh for the hardest tasks.**
- **`verbosity`** — how much the model writes.

Steering eagerness:

- **Less eager / faster:** lower `reasoning_effort`, and add an **escape hatch** — explicitly permit the model to *proceed under uncertainty* rather than stalling to ask. Cap exploration.
- **More persistent:** add a **persistence preamble** — instruct the model to keep going until the query is fully resolved before yielding the turn. Useful on long autonomous runs.

> **Cross-model note (Anthropic).** The Claude family does **not** use `reasoning_effort`/`verbosity`. Its analogs are adaptive thinking (`thinking: {type: "adaptive"}`) plus the GA **effort** control inside `output_config` — `low | medium | high | xhigh | max`, where the current Opus default is `xhigh` and `high` is a sensible minimum for intelligence-sensitive work. If your harness is Claude-driven, calibrate *those* knobs, not OpenAI's. See [claude-api] guidance for exact parameters.

**Actionable:** default `reasoning_effort: medium`, bump to High/xhigh for hard refactors, cap exploration to control cost, and add the persistence preamble for long runs.

> **Confidence: high** on the GPT-5.x knobs (cookbook + Codex). The Claude analog (`effort` in `output_config`, adaptive thinking) is from current Anthropic API guidance.

---

## 8. Point at existing patterns; force reuse over invention

The cheapest way to stop an agent hallucinating a new component, helper, or convention is to point it at a *canonical example that already exists in your codebase* rather than describing the convention in prose.

- Tell the agent to **build from existing design-system components and match a specific existing file**, e.g. *"implement this the way `src/components/DataTable.tsx` is structured; reuse `<Button>` and `<Field>` from the design system — do not introduce new primitives."*
- Keep **durable conventions in `AGENTS.md`** (one short file at the repo root) or in skills — not re-pasted into every prompt.

### TypeScript / React / Storybook specifics

This is where "point at what exists" has the strongest tooling support.

- **Storybook exposes your real component surface** — production components, props, stories, and JSDoc — so an agent can assemble UI from what genuinely exists instead of inventing props. Wire the **Storybook MCP server** (React-only since **2026-03-25**) to give the agent an autonomous correction loop: read the real props → build → check.
- **The strongest TS/React agent loop in 2026:**
  - **`tsconfig` strict** + `tsc --noEmit` as a hard gate (a type error is a wall the agent cannot prompt its way past).
  - **ESLint** with custom rules — structured error messages teach the agent determinism on the hot path. See [Linting for AI](09-linting-for-ai.md).
  - **Vitest 4.1** in **browser mode** for component/interaction/a11y tests, with its **`agent` reporter** enabled to stream lean, token-efficient results back to the agent (it suppresses passing-test output and prints only failures plus the summary; auto-enabled when Vitest detects it is running inside an AI agent). Vitest 4.1 also adds test tags and native Node execution.
  - **Storybook component testing** (CSF `play` interactions + a11y) running in a real browser.

```
Agent loop (TS/React):
  implement → write a Storybook story + interaction test
  → run tsc --noEmit && vitest (browser mode, `agent` reporter)
  → read structured failures → fix → repeat until green
```

See [TypeScript + React + Storybook](13-typescript-react-storybook.md) and [UI Design Systems Enforcement](07-ui-design-systems-enforcement.md) for the full stack.

> **Confidence: high.** Storybook AI best practices, Storybook MCP React-only since 2026-03-25, and the Vitest 4.1 `agent` reporter are all confirmed against primary/secondary sources.

---

## 9. Subagents and parallelism — when warranted

Subagents earn their keep in two situations:

1. **Bounded offloaded work** — exploration, test runs, triage — that you want to keep *out of* the top-level context window. A **read-only Explore subagent** is the canonical example: it searches the codebase and reports back a map, without polluting or consuming the main session's context.
2. **Fresh-context review** — the highest-value pattern. A reviewer subagent sees *only* the diff plus the acceptance criteria (no write/edit tools, no prior context) and reports gaps. This is the §2 skeptical evaluator, implemented as a subagent.

**The honest trade-off:** a single, well-scoped agent solves most tasks. Multi-agent adds latency, token cost, and merge-conflict risk. Don't reach for it reflexively.

**Actionable:**

- Use an **Explore subagent** to map the code, **implement in the main session**, then run a **fresh-context reviewer** before merge.
- For genuinely independent features, use **separate git worktrees**, and **never let concurrent agents edit the same files.**

> **Confidence: high** on the Explore subagent and fresh-context-review patterns; the single-agent-default trade-off is well-supported practitioner consensus.

---

## 10. Iterate — don't one-shot — and feed CI/review back as prompts

Beyond trivial, fully-specified changes, **iterative beats one-shot.** The 2026 workflow (Osmani and others) carries context forward across turns with human verification, and **feeds review-bot and CI comments back in as the next prompt.**

The hybrid default that has emerged:

- **Plan** in your IDE (Plan Mode / spec).
- **Execute** in a sandbox.
- **Require CI + PR review** before merge.
- **One-shot only** for small, fully-specified changes with an unambiguous done-when.

**Actionable:** wire CI checks and let the agent **iterate to green before review**; when the review bot or CI leaves comments, **paste them straight back as the next prompt** rather than re-describing the problem.

> **Confidence: medium-high.** This is well-argued practitioner guidance (Osmani, Kilo) rather than a controlled measurement. Note the broader uncertainty: the METR early-2025 study found experienced OSS developers were measurably *slower* with AI tools on familiar codebases even while *feeling* faster — a reminder that "iterate with the agent" is a craft, and that subjective speed-up is not evidence of objective speed-up.

---

## Freshness (2026)

**Current / load-bearing now:**

- The **outcome + constraints + done-when** prompt shape (Codex four elements).
- **`/goal` completion checks** in both Codex and Claude Code, evaluated by a *separate fast model*.
- **Spec Kit** spec-driven flow; **Claude Code Plan Mode**.
- **TDD Guard** for red-first enforcement; **mutation testing** as the real coverage signal.
- **Storybook MCP** (React-only since 2026-03-25) and the **Vitest 4.1 `agent` reporter** (token-efficient, failures-only output for AI agents).
- **Per-model-family rebuilds** — assume your prompt stack has a short shelf life.

**Now stale / changed post-late-2025 model jump:**

- **Heavy sprint/micro-step decomposition** for top-tier models — Anthropic removed it between Opus 4.5 and 4.6; stronger models sustain longer coherent work, so over-decomposing now *costs* tokens and coherence.
- **Aggressive, over-specified, emphasis-heavy prompts** ("CRITICAL: YOU MUST…", enumerated process steps) — newer model families respond worse to over-specification; lead with goal + constraints and let the model plan.
- **Porting a prior model's prompt stack wholesale** — rebuild from a fresh baseline instead.

**Unsettled / treat with caution:** the specific claim that GPT-5.5 ignores emphasis markers (unverified); spec-driven development's magnitude of benefit (no published metric); and whether iterative agent workflows produce *objective* (not just felt) speed-ups (METR casts doubt).

---

## Sources

- [Codex best practices](https://developers.openai.com/codex/learn/best-practices) — OpenAI (2026): four-element prompt shape, TDD loop, effort/escape-hatch guidance.
- [Using Goals in Codex](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex) — OpenAI cookbook: `/goal` per-turn completion checks.
- [GPT-5 prompting guide](https://cookbook.openai.com/examples/gpt-5/gpt-5_prompting_guide) — OpenAI cookbook: `reasoning_effort`, verbosity, eagerness, persistence preamble.
- [GPT-5.5 prompting guide](https://simonwillison.net/2026/apr/25/gpt-5-5-prompting-guide/) — Simon Willison (Apr 25, 2026): fresh-baseline migration, over-specification harms.
- [GPT-5.5 needs cleaner prompts](https://webiano.digital/gpt-5-5-needs-cleaner-prompts-not-longer-instructions/) — Webiano (2026).
- [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) — Anthropic: separate skeptical evaluator, default-FAIL contract.
- [Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps) — Anthropic: one-feature-at-a-time, planner/generator/evaluator, Opus 4.5→4.6 decomposition change.
- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — Anthropic: Explore subagent, fresh-context review.
- [Spec Kit](https://github.com/github/spec-kit) — GitHub: constitution/specify/plan/tasks/implement.
- [Spec-driven development with AI](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/) — GitHub blog.
- [Claude Code Plan Mode](https://www.sitepoint.com/claude-code-plan-mode-the-readfirst-workflow-for-complex-refactors/) — SitePoint: read-first workflow.
- [TDD Guard](https://github.com/nizos/tdd-guard) — red-first enforcement hook.
- ["AI reported 93% coverage; it was 34" (point gap)](https://dev.to/jghiringhelli/the-ai-reported-931-coverage-it-was-34-290k) — dev.to: 93% line coverage vs 59% mutation score.
- [Storybook AI best practices](https://storybook.js.org/docs/ai/best-practices) — Storybook MCP, stories-as-tests.
- [Vitest 4.1 for AI agents](https://www.infoq.com/news/2026/05/vitest-4-1-ai-agents/) — InfoQ (May 2026): `agent` reporter, test tags, native Node execution.
- [Custom ESLint rules for determinism](https://understandingdata.com/posts/custom-eslint-rules-determinism/) — teaching agents via structured lint errors.
- [Addy Osmani — AI coding workflow 2026](https://addyosmani.com/blog/ai-coding-workflow/) — iterate, carry context, feed review back.
- [Beyond autocomplete](https://kilo.ai/articles/beyond-autocomplete) — Kilo: hybrid plan/execute/review default.
- [METR early-2025 productivity study](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/) — measured slowdown vs perceived speed-up.
- [Agentic anti-patterns](https://simonwillison.net/guides/agentic-engineering-patterns/anti-patterns/) — Simon Willison.
