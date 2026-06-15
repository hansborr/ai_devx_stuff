# Mitigations & Best Practices (the meta-answer)

> **TL;DR** — Every credible source converges on one meta-principle: **give the agent a verification loop it can run itself, and make the guardrails deterministic rather than advisory.** A prompt in `CLAUDE.md` is a suggestion the model discards as context fills; a non-zero exit code from a hook, a pre-commit script, or a required CI check is a contract it cannot route around. The highest-leverage human work moves *up the stack* — to specs, plans, and review-for-comprehension — because a bad line in a plan becomes hundreds of bad lines of code. The practices below are the consolidated answer to "what actually works," ordered roughly by leverage.

**Top actionable takeaways**

- **Wire one `verify` command** (`typecheck && lint && test`) into the agent loop and name it in `CLAUDE.md`/`AGENTS.md` as the definition of done. This is the single most-cited practice across Anthropic, OpenAI, and every field report.
- **Make enforcement deterministic, layered, and unbypassable**: hooks (in-loop) → pre-commit (local gate) → required CI checks (hard gate). Don't rely on prose the model can ignore.
- **TDD as external source of truth**: tests first, confirm they *fail*, implement to green, and **never let the agent edit/weaken the tests** (install [TDD Guard](https://github.com/nizos/tdd-guard)).
- **Don't trust coverage** — high line coverage routinely coexists with low mutation scores. Add [StrykerJS](https://stryker-mutator.io/) on critical modules and feed surviving mutants back to the agent.
- **Work spec-first**: research → plan → review the plan yourself → execute in a fresh session. Move review effort to the artifact where it's cheapest to fix.
- **Keep changes small and atomic**: one feature/bugfix per PR, each independently revertible and green; reject the "did-everything" PR.
- **Max out type strictness** — `noUncheckedIndexedAccess` and friends are free, deterministic, in-loop guardrails.
- **Manage context aggressively**: clear between tasks, compact intentionally, delegate research to subagents, persist state to a NOTES file.
- **Prefer fewer, sharper tools** (CLI + skills) over a sprawling MCP surface; design for *agent experience (AX)*.

See also: [Overview](00-overview.md) · [Challenges of AI Development](01-challenges-of-ai-development.md) · [Codebase Structure for Agents](03-codebase-structure-for-agents.md) · [Static Analysis & CI/CD Gates](04-static-analysis-and-ci-cd-gates.md) · [Preventing AI Slop](08-preventing-ai-slop.md) · [Linting for AI](09-linting-for-ai.md) · [Agent Guidance & Context](10-agent-guidance-and-context.md) · [Prompting Agents](11-prompting-agents.md) · [Custom Hooks](12-custom-hooks.md) · [TypeScript / React / Storybook](13-typescript-react-storybook.md)

---

## The meta-principle: deterministic enforcement beats probabilistic prose

There are two ways to make an agent behave. The first is to *ask* — write the rule in `CLAUDE.md`/`AGENTS.md` and hope the model honors it. The second is to *enforce* — wire the rule into something that runs regardless of the model and returns a non-zero exit code when broken. Advisory context degrades as the window fills (see [context rot](#manage-context-aggressively)); deterministic enforcement does not. The entire practice set below is a strategy for converting "please do X" into "you cannot proceed unless X."

This produces a defense-in-depth ladder, fastest-feedback-first:

1. **In-loop hooks** — Claude Code `PostToolUse` auto-fix/feedback, `PreToolUse` blocking, `Stop` completion-gating. Sub-second to sub-minute.
2. **Pre-commit** — the same commands as a local git gate, before code leaves the machine.
3. **Required CI checks** — the hard gate; the same commands again, with `--max-warnings 0`, where a red check blocks merge.

Mirror the *same commands* across all three layers so the agent's in-loop signal is identical to what blocks the PR.

---

## 1. Give the agent a self-runnable verification loop (highest leverage)

This is the most-repeated finding in every primary source. An agent that can run its own checks self-corrects; one that cannot, drifts. **ACTION:** define a single composite command and name it as the definition of done.

```jsonc
// package.json
{
  "scripts": {
    "verify": "tsc --noEmit && eslint . --max-warnings 0 && vitest run"
  }
}
```

```markdown
<!-- CLAUDE.md / AGENTS.md -->
## Definition of done
Run `npm run verify` and ensure it exits 0 before claiming a task complete.
```

For UI work, the loop needs *visual* ground truth, not just text: give the agent a Playwright or Puppeteer MCP server plus Storybook so it can render, screenshot, and diff (see [TS / React / Storybook specifics](#typescript--react--storybook-specifics)). For unattended/overnight runs, add a `Stop` hook that blocks completion until `verify` passes — the `Stop` hook can force the agent to keep working by exiting with code 2. *(Confidence: high — converges across [Anthropic best-practices](https://code.claude.com/docs/en/best-practices) and [OpenAI Codex](https://developers.openai.com/codex/learn/best-practices).)*

---

## 2. Make guardrails deterministic and unbypassable

**The trap:** rules that live only in `CLAUDE.md` are advisory. As the model's context fills, it will quietly stop honoring them. **The fix:** push every rule that *can* be mechanized down into hooks, git hooks, and CI.

```jsonc
// .claude/settings.json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": "eslint --fix \"$CLAUDE_FILE_PATH\"; tsc --noEmit"
      }]
    }],
    "PreToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": ".claude/guard-protected-paths.sh"
      }]
    }]
  }
}
```

**Important mechanics (get this right or you'll think you have a gate you don't):**

- `PostToolUse` runs *after* the edit and **cannot block it** — it is for **auto-fix and feedback only** (run `eslint --fix`, surface `tsc` errors back to the agent so it self-corrects on the next turn).
- The **hard, blocking** gate must come from **`PreToolUse`** (e.g. refuse edits to `migrations/**` or lockfiles by exiting non-zero), **pre-commit**, and **required CI checks**.

So: use `PostToolUse` to make the agent *want* to fix things in-loop, and `PreToolUse`/pre-commit/CI to make sure it *can't* ship things that are broken. Mirror the commands across all three. See [Custom Hooks](12-custom-hooks.md) for the full hook taxonomy. *(Confidence: high — hook semantics verified against current Claude Code docs.)*

---

## 3. Enforce TDD as the agent's external source of truth — and protect the tests

OpenAI and Anthropic converge on test-driven development as the cleanest way to give an agent an objective target. The discipline:

1. Write the tests **first**.
2. **Confirm they fail** (otherwise they assert nothing).
3. Implement until green.
4. **Never let the agent edit or weaken the tests** to make them pass.

**ACTION — prompt:**

> Write failing tests for *X*, show me they fail, then implement until they pass. Do **not** edit the tests.

Make this mechanical, not aspirational: install [TDD Guard](https://github.com/nizos/tdd-guard) (a hook-based enforcer that blocks the agent from modifying tests to cheat its way to green), and put your test command in `AGENTS.md`/`CLAUDE.md` so the agent always knows how to run it. *(Confidence: high — [OpenAI Codex best-practices](https://developers.openai.com/codex/learn/best-practices).)*

---

## 4. Don't trust coverage — use mutation testing

AI tests are usually written *after* seeing the implementation, so they tend to confirm "the function returned *something*," not "the function returned the *right* thing." The result is the classic AI failure mode: **high line coverage that protects against almost nothing.** Mutation testing exposes it by introducing small faults and checking whether any test catches them.

**ACTION:** add [StrykerJS](https://stryker-mutator.io/) to critical modules, pick a mutation-score threshold appropriate to criticality (set the bar high on the critical path; this is a per-team judgment, not a universal industry number), and feed surviving mutants back to the agent: *"here are the mutations your tests failed to catch — write tests that kill them."*

```jsonc
// stryker.conf.json
{
  "mutate": ["src/payments/**/*.ts", "src/auth/**/*.ts"],
  "testRunner": "vitest",
  "thresholds": { "high": 80, "low": 70, "break": 60 }
}
```

> ⚠️ **Caveat:** specific figures sometimes quoted ("93–100% coverage hiding 4–34% mutation scores," "gate at 70%") are *not* traceable to a single primary source and should not be cited as industry standards. The *qualitative* claim — high coverage routinely coexists with low mutation scores, and mutation testing catches tests that pass but don't protect — is well-supported. Choose your own threshold. *(Confidence: high on the mechanism; the precise numbers are unsourced.)*

See [Static Analysis & CI/CD Gates](04-static-analysis-and-ci-cd-gates.md) for wiring this into CI.

---

## 5. Work spec-first; move human review *up* the stack

Code is now cheap to produce, so leverage shifted to the artifacts *upstream* of code. **A bad line in a plan becomes hundreds of bad lines of code** — so that's where your attention buys the most. The [advanced context engineering](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/ace-fca.md) workflow:

1. **Research** in plan mode or via a subagent — understand the code *before* changing it.
2. Have the agent **write a plan / `SPEC.md`** naming the exact files to touch, explicit *out-of-scope* items, and the verification steps.
3. **Review the plan yourself** — this is the high-leverage human checkpoint.
4. **Execute in a fresh session** so implementation context isn't polluted by exploration.

*(Confidence: high.)*

---

## 6. Keep changes small, atomic, and merge-ready

Agents bias toward doing *too much at once*. Incrementalism is the counter: keep the tree continuously merge-ready with a commit per verified change so any step is revertible.

**ACTION:** cap PRs by **scope, not line count** — one feature or bugfix per PR, each green and revertible on its own. Commit after each verified step, use feature flags to keep half-finished work dark, and **reject the giant "did-everything" PR.** This is widely-held engineering practice reinforced by Anthropic's [long-running-agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) guidance; treat it as a strong default rather than a hard empirical law. *(Confidence: high as practice; the framing is normative, not measured.)*

---

## 7. Reframe review around comprehension and accountability

The reviewer's question is no longer "is this correct?" but **"do I understand this well enough to *own* it?"** Comprehension debt — code that merges green but that nobody can explain — is invisible in velocity metrics and compounds silently (see [comprehension debt](https://addyosmani.com/blog/comprehension-debt/)).

**ACTION:**

- Require a **PR template**: what/why, evidence (test output, screenshots), risk tier, which portions were AI-generated, and where to focus review.
- Add a **comprehension gate**: author self-scores understanding 1–5; reject below 3. Read the largest-diff files first.
- Use a **fresh-context reviewer** (a clean agent session or a second human) scoped *only* to correctness, with no memory of how the code was produced.

See [Challenges of AI Development](01-challenges-of-ai-development.md) for the underlying data on the review bottleneck. *(Confidence: high.)*

---

## 8. Encode architecture as machine-checkable rules

Agents optimize for *immediate completion*, not architectural coherence, so they erode boundaries incrementally — and `tsc` will not stop them, because the type checker validates types, not the dependency graph.

**ACTION:** define your layers as lint rules with [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) and/or [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries): *ui cannot import from infra; features cannot import each other.* Write **teaching error messages** so the agent learns the rule from the failure. Run in pre-commit *and* CI, and codify each new drift pattern you spot as a custom rule.

```js
// .dependency-cruiser.js
module.exports = {
  forbidden: [{
    name: "ui-not-to-infra",
    comment: "UI must not import infrastructure directly — go through a feature/service.",
    severity: "error",
    from: { path: "^src/ui" },
    to:   { path: "^src/infra" }
  }]
};
```

*(Confidence: high — [enforcing architecture in an agent-driven codebase](https://www.phoebe.work/blog/enforcing-architecture-in-an-agent-driven-codebase).)* See [Linting for AI](09-linting-for-ai.md).

---

## 9. Maximize type strictness (free, deterministic, in-loop)

The compiler is a deterministic feedback channel the agent already runs. Strict flags catch entire classes of the bugs AI code is prone to — `noUncheckedIndexedAccess`, for instance, appends `| undefined` to indexed access and so catches the "Cannot read properties of undefined" crash before runtime.

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "noUnusedLocals": true
  }
}
```

Pair with ESLint `@typescript-eslint/no-explicit-any` and a ban on `@ts-ignore` (`@typescript-eslint/ban-ts-comment`). Run `tsc --noEmit` in the `PostToolUse` hook (feedback) **and** CI (gate). *(Confidence: high — [advanced tsconfig settings, Apr 2026](https://blog.webdevsimplified.com/2026-04/advanced-tsconfig-settings/).)*

---

## 10. Defend refactoring cadence and DRY explicitly

AI biases toward **duplication over consolidation** — it re-emits a near-identical block rather than refactoring to share one. [GitClear's 2025 study](https://www.gitclear.com/ai_assistant_code_quality_2025_research) (211M lines) found copy-pasted **line share rose from 8.3% to 12.3%**, while refactoring's share of changes **fell from ~25% to under 10%**. (GitClear titles this a *"4x growth in code clones"*; in the body it reports the *frequency* of duplicated blocks rising roughly eightfold — these are two different metrics, so don't conflate the 8.3→12.3 line-share figure with the "4x"/"8x" block-frequency headline.)

**ACTION:** add [Knip](https://knip.dev/) to CI to fail on unused files/exports/deps, plus a duplication threshold (e.g. `jscpd`). Run a slop scanner like [deslop](https://github.com/dabit3/deslop) on the **branch diff** before review and encode the top recurring patterns as lint rules. Schedule **explicit refactoring sprints** — the agent will not initiate them. *(Confidence: high.)* See [Preventing AI Slop](08-preventing-ai-slop.md).

---

## 11. Curate durable, layered project context

A lean `AGENTS.md`/`CLAUDE.md` measurably helps: [arXiv 2601.20404](https://arxiv.org/abs/2601.20404) reports **−28.6% runtime and −16.6% tokens** with a well-formed AGENTS.md. But it must stay **lean** — a bloated file gets ignored as context fills.

**ACTION:** keep `CLAUDE.md`/`AGENTS.md` short and high-signal — commands, the `verify` command, conventions, invariants, environment quirks. Push *situational* knowledge into on-demand `.claude/skills/*/SKILL.md` files that load only when relevant. Prune ruthlessly: if the agent starts ignoring a rule, the file is too long. *(Confidence: high.)* See [Agent Guidance & Context](10-agent-guidance-and-context.md).

---

## 12. Manage context aggressively

Performance degrades as the context window fills — *context rot*, a gradient not a cliff ([Anthropic on context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).

**ACTION:**

- **Clear** between unrelated tasks and after ~2 failed correction attempts (a stuck agent rarely un-sticks with more of the same context).
- **Delegate exploration to subagents** that return short summaries, not raw file dumps.
- Aim to keep context utilization ~40–60% via **intentional compaction**.
- **Persist state** to a `progress`/`NOTES.md` file so a fresh session can resume without re-deriving everything.

*(Confidence: high.)*

---

## 13. Prefer fewer, sharper tools (design for AX)

A sprawling tool/MCP surface degrades agent performance; the field is consolidating hard. **GitHub Copilot cut its tools 40 → 13**, **Block reduced a Linear MCP from 30+ tools to 2**, and **[Nx deleted most of its MCP tools](https://nx.dev/blog/why-we-deleted-most-of-our-mcp-tools)** in favor of letting the agent drive the CLI plus `jq`.

**ACTION:** audit your MCP/tool surface and cut to the high-impact few. Namespace what remains, resolve opaque IDs to human-readable names, and prefer **CLI access (`gh`, your build CLI) plus a SKILL** over bespoke tools. Make tests granular and builds fast — *build speed is an agent feature.* This is the **agent-experience (AX)** mindset: minimize and sharpen the surface the agent operates against. *(Confidence: high.)*

---

## TypeScript / React / Storybook specifics

- **Strict tsconfig is your cheapest gate** (§9). `noUncheckedIndexedAccess` alone removes a large fraction of AI's runtime crashes. Run `tsc --noEmit` as a dedicated CI check — bundlers transpile without type-checking.
- **Storybook stories as executable specs.** Stories are the UI analog of TDD: each is simultaneously a spec and a test fixture. **ACTION:** require a story per component state/edge case, run Storybook Component Testing via Vitest plus the type checker in CI *and* the agent loop, and add **screenshot-diff** verification so visual regressions block the PR. *(Confidence: medium — strong as practice.)*
- **Storybook MCP server** exists and gives the agent first-class access to stories, but as of **March 2026 it is React-only**. If you're on Vue/Svelte/Angular, lean on Playwright/Puppeteer MCP for the visual loop instead. *(Confidence: medium — capability and React-only scoping verified; check current status before relying on it.)*
- **Visual ground truth in-loop:** pair Storybook with a Playwright/Puppeteer MCP so the agent renders and screenshots its own UI work rather than guessing.

See [TypeScript / React / Storybook](13-typescript-react-storybook.md) and [UI Design Systems Enforcement](07-ui-design-systems-enforcement.md) for depth.

---

## Freshness (2026)

- **Current and load-bearing:** the deterministic-enforcement thesis; one composite `verify` command; TDD + test protection; mutation testing over coverage; architecture-as-lint; strict tsconfig; lean AGENTS.md (the arXiv 2601.20404 numbers are recent and specific); context-rot management; and the **fewer-tools / AX** consolidation (Copilot, Block, Nx are all 2025–2026 moves).
- **Time-sensitive — verify before relying on it:** the **Storybook MCP server is React-only as of March 2026** and may expand; tool counts (Copilot 40→13, Block 30+→2) are snapshots that will drift; exact tsconfig flag names occasionally change across TS releases.
- **Now stale / treat with care:** any specific mutation-score thresholds quoted as "industry standard" (e.g. the 70% / "93–100% coverage → 4–34% mutation" figures) are not traceable to a primary source — use them as illustrations, not benchmarks. Pre-late-2025 advice that leaned on prompting/`CLAUDE.md` *alone* (without deterministic gates) is superseded: as models got more capable and verbose, the bottleneck moved decisively to verification, making enforcement — not persuasion — the durable strategy.

---

## Debates & trade-offs (stated honestly)

- **How strict is too strict?** Maximal tsconfig + zero-warning lint can stall an agent in a loop of self-corrections on legacy code. Mitigation: ratchet strictness on *new* code, not the whole tree at once.
- **Hooks vs. CI as the gate.** In-loop hooks give the fastest feedback but `PostToolUse` *cannot block* — over-trusting it gives a false sense of safety. The blocking gate must live in `PreToolUse`/pre-commit/CI. Use both layers, but know which one actually stops a bad change.
- **TDD-first vs. explore-first.** Strict tests-first works for well-specified changes; for genuinely exploratory work, an agent may need to spike first, then backfill protected tests. Don't let "TDD always" become a reason to skip the spec step (§5).
- **Subagent delegation has a cost.** It saves context but adds latency and can lose nuance in summarization. Delegate *research*, keep *decisions* in the main thread.

---

## Sources

- [Claude Code best practices](https://code.claude.com/docs/en/best-practices) — Anthropic (current)
- [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) — Anthropic
- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — Anthropic
- [Codex best practices](https://developers.openai.com/codex/learn/best-practices) — OpenAI
- [Advanced context engineering for coding agents (ACE-FCA)](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/ace-fca.md) — HumanLayer
- [TDD Guard](https://github.com/nizos/tdd-guard)
- [Keep your coding agent on task with mutation testing](https://testdouble.com/insights/keep-your-coding-agent-on-task-with-mutation-testing) — Test Double
- [Comprehension debt](https://addyosmani.com/blog/comprehension-debt/) — Addy Osmani
- [AI Assistant Code Quality Research 2025](https://www.gitclear.com/ai_assistant_code_quality_2025_research) — GitClear (211M lines)
- [Enforcing architecture in an agent-driven codebase](https://www.phoebe.work/blog/enforcing-architecture-in-an-agent-driven-codebase) — Phoebe
- [Why we deleted most of our MCP tools](https://nx.dev/blog/why-we-deleted-most-of-our-mcp-tools) — Nx
- [Storybook AI best practices](https://storybook.js.org/docs/ai/best-practices) — Storybook (React MCP, Mar 2026)
- [AGENTS.md impact study (−28.6% runtime, −16.6% tokens)](https://arxiv.org/abs/2601.20404) — arXiv 2601.20404
- [Advanced tsconfig settings](https://blog.webdevsimplified.com/2026-04/advanced-tsconfig-settings/) — Web Dev Simplified (Apr 2026)
- [Early-2025 AI experienced OS-dev study](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/) — METR
