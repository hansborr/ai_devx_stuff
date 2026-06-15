# Agent Guidance & Context Engineering (CLAUDE.md / AGENTS.md / skills)

> **TL;DR** — Agent guidance files (`CLAUDE.md`, `AGENTS.md`) and skills are not documentation; they are **context-budget instruments** that get loaded into a finite, degrading context window every session. The dominant constraint is *context rot*: as the window fills, the model forgets earlier instructions and makes more mistakes, so the winning move is to keep guidance **lean and high-signal** and load everything else *just-in-time*. The 2026 efficacy evidence is genuinely **split** — one ETH Zurich study found LLM-generated context files can *hurt* success and inflate cost, while a separate study found a hand-curated `AGENTS.md` cut agent runtime ~28% — and the honest reconciliation is that this is a **quality question, not an existence one**: a tight, developer-authored file helps; a bloated, auto-generated one can hurt.

**Top actionable takeaways**

- **Run `/init`, then ruthlessly prune** against the official include/exclude table. The per-line test is the rule: *"Would removing this cause the agent to make a mistake?"* If not, cut it.
- **Keep the root file short.** ~150 lines is a widely-cited *third-party heuristic* (the official docs give no number — they say "keep it short" and "bloated files cause the model to ignore your instructions"). Treat it as a smell threshold, not a hard limit.
- **Never ship an LLM-drafted `AGENTS.md` unsupervised.** Treat any agent-generated file as a *first draft to aggressively cut* (`confidence: contested` — see the debate below).
- **Prefer just-in-time retrieval over context stuffing.** Link to docs instead of pasting them; install `gh` and other CLIs (the most context-efficient external interface).
- **Move sometimes-relevant knowledge into Skills**, broad always-on rules into `CLAUDE.md`, must-happen-every-time rules into **hooks**, and file-heavy investigation into **subagents**.
- **Keep ONE source of truth** (`AGENTS.md` at repo root, version-controlled) and **nest per package** in monorepos; tool-specific files should reference it, not duplicate it.

See also: [Overview](00-overview.md) · [Codebase Structure for Agents](03-codebase-structure-for-agents.md) · [Linting for AI](09-linting-for-ai.md) · [Preventing AI Slop](08-preventing-ai-slop.md) · [Custom Hooks](12-custom-hooks.md) · [TypeScript + React + Storybook](13-typescript-react-storybook.md)

---

## Why guidance files are a context-budget problem

Every persistent guidance file is prepended to the conversation at session start and consumes tokens for the entire session. The constraint that drives every best practice here is stated plainly in the Claude Code docs:

> "Claude's context window fills up fast, and performance degrades as it fills… When the context window is getting full, Claude may start 'forgetting' earlier instructions or making more mistakes."

This is the *context rot* phenomenon (Chroma's research quantifies it as non-uniform degradation across the window). The operational consequence is counterintuitive and load-bearing:

> **A bloated file does not make the agent follow *more* rules — it makes the agent follow *fewer*.** The official docs: "Bloated CLAUDE.md files cause Claude to ignore your actual instructions!" When important rules are buried in noise, the model stops filtering and starts ignoring wholesale.

So guidance is a **subtractive** discipline. The goal is the smallest set of statements that changes behavior, not the most complete description of the project.

---

## The include / exclude table (authoritative)

This table is from the Claude Code best-practices page — it is the canonical rubric for what earns a line in a context file.

| ✅ Include | ❌ Exclude |
| --- | --- |
| Bash commands the agent can't guess | Anything discoverable by reading code |
| Code-style rules that **differ from defaults** | Standard language conventions the model already knows |
| Testing instructions and preferred test runners | Detailed API docs (link to docs instead) |
| Repo etiquette (branch naming, PR conventions) | Information that changes frequently |
| Architectural decisions specific to your project | File-by-file descriptions of the codebase |
| Dev-environment quirks (required env vars) | Long explanations or tutorials |
| Common gotchas / non-obvious behaviors | Self-evident advice ("write clean code") |

**The per-line test** (apply to every line): *"Would removing this cause the agent to make a mistake?"* If not, delete it or convert it to a hook. Use imperative commands, and add `IMPORTANT` / `YOU MUST` sparingly to boost adherence on the rules that matter.

### A concrete, minimal example

The docs' own example is deliberately tiny — this is the right *altitude*:

```markdown
# Code style
- Use ES modules (import/export) syntax, not CommonJS (require)
- Destructure imports when possible (eg. import { foo } from 'bar')

# Workflow
- Be sure to typecheck when you're done making a series of code changes
- Prefer running single tests, and not the whole test suite, for performance
```

Use `@path` imports to keep the root file thin while still composing context:

```markdown
See @README.md for project overview and @package.json for available npm commands.

# Additional Instructions
- Git workflow: @docs/git-instructions.md
- Personal overrides: @~/.claude/my-project-instructions.md
```

---

## How big is too big? (a debate, handled honestly)

You will see "**keep `CLAUDE.md` / `AGENTS.md` under ~150 lines**" repeated across 2026 blogs. Be precise about its provenance:

- **The ~150-line ceiling is a third-party heuristic, not an official limit.** The Claude Code best-practices page contains **no numeric line limit**. It says "keep it short and human-readable," "keep it concise," and warns that over-long files get ignored. The 150-line figure (with 200–500 cited as a practical max elsewhere) comes from community guides. Use it as a *smell test*: if you're past ~150 lines, you almost certainly have lines that fail the per-line test.
- **Do not couple the line count to a cost figure.** A claim circulating in secondary coverage — "beyond 150 lines, inference cost rises 20–23%" — is a **manufactured causal link**. The ~20%+ cost increase measured by ETH Zurich (below) is *context-file-vs-no-file*, not a threshold effect at 150 lines. There is no published evidence of a cost cliff at any specific line count. (`confidence: the line heuristic is sound; the cost-at-150 claim is unsupported — keep them separate.`)

**Practical stance:** treat ~150 lines as the point where you should re-run the prune, not as a number that itself causes regressions.

---

## The efficacy debate: do context files even help? (`confidence: contested`)

This is the most important — and most contested — finding in the 2026 literature. The evidence genuinely splits, and overclaiming either side is dishonest.

**The contrarian result (ETH Zurich / LogicStar.ai, Feb–Mar 2026, arXiv 2602.11988).** *"Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?"* built **AGENTBENCH** (~138 real-world Python SWE tasks) and tested agents across **no-file**, **LLM-generated**, and **developer-written** conditions. The abstract's headline: context files (especially LLM-generated ones) **tend to reduce task success vs. no context**, while **increasing inference cost by over 20%**, and add roughly **~3.92 steps** per task. The authors attribute the regression to agents being *too obedient* to noisy instructions.

> **Caveat on the numbers.** The exact figures vary by source. The **abstract** says success *reduction* and "over 20%" cost; the often-quoted *"−0.5% to −2% success," "5 of 8 settings," "2.45–3.92 steps," and "20–23% cost"* breakdowns are from **secondary summaries**, not the abstract. Cite the direction confidently (files can hurt; LLM-generated ones hurt most); hedge the precise deltas. The widely-repeated *"~3% success drop"* appears to **overstate** the abstract's smaller range — prefer the conservative framing.

**The counterbalancing result (arXiv 2601.20404).** *"On the Impact of AGENTS.md Files on the Efficiency of AI Coding Agents"* analyzed 10 repos / 124 PRs with agents run **with vs. without** an `AGENTS.md`. It found the file's presence associated with **~28.64% lower median runtime** and **~16.58% fewer output tokens**, with comparable task completion — because agents spend *less* time on exploratory navigation when conventions are handed to them directly.

**Reconciliation — quality, not existence.** These do not actually contradict if you read what each *tested*:

| Dimension | 2602.11988 (ETH) | 2601.20404 |
| --- | --- | --- |
| What was tested | Mostly **LLM-generated** files on SWE-bench-style tasks | **Hand-present** `AGENTS.md` on real PRs |
| Success / completion | Reduced (LLM-gen worst) | Comparable |
| Cost / efficiency | **Increased >20%** | Runtime **−28.6%**, tokens **−16.6%** |

The synthesis the field is converging on: **a tight, developer-authored file that follows the include/exclude rubric helps efficiency; an unpruned, auto-generated file can hurt both success and cost.** The strongest single takeaway from the contrarian camp is therefore *operational*, not nihilistic: **never ship an LLM-drafted `AGENTS.md` unsupervised — treat it as a first draft to aggressively cut.**

---

## Pick the right mechanism (the four-way decision)

Most "my rule gets ignored" and "my context is bloated" problems are a *wrong-tool* problem. The Claude Code docs map intent to mechanism (see *Extend Claude Code → match features to your goal*):

| You want… | Use | Why |
| --- | --- | --- |
| Persistent broad rules, always on | **`CLAUDE.md` / `AGENTS.md`** | Loaded every session; keep it tiny |
| Knowledge relevant *only sometimes* | **Skill** (`SKILL.md`) | Progressive disclosure — loads on demand |
| A repeatable templated workflow | **Slash command / skill with `$ARGUMENTS`** | Invocable, parameterized |
| Isolated, file-heavy investigation | **Subagent** | Separate context window; returns a summary |
| A rule that must fire *every time* | **Hook** | Deterministic; advisory text is not |

> **Rule of thumb:** if a rule keeps getting ignored despite being in `CLAUDE.md`, the file is probably too long *and* the rule wants to be a **hook**. Convert it.

### Skills: situational knowledge without bloat

A Skill is a directory with a `SKILL.md`. Its **YAML frontmatter is preloaded** (cheap, always available); the **body loads only when the description matches the task**; **bundled files load only when needed**. This *progressive disclosure* is how you inject capability without paying for it every session.

```markdown
---
name: api-conventions
description: REST API design conventions for our services
---
# API Conventions
- Use kebab-case for URL paths
- Use camelCase for JSON properties
- Always include pagination for list endpoints
- Version APIs in the URL path (/v1/, /v2/)
```

Use `disable-model-invocation: true` for workflows with side effects you want to trigger manually.

### Subagents: protect the top-level context

Investigation is the single biggest context consumer — reading dozens of files to answer one question pollutes the main window. Delegate it: *"use subagents to investigate how token refresh works and whether OAuth utilities already exist."* The subagent explores in **tens of thousands of tokens** in its *own* window and reports back a **distilled summary** (a few thousand tokens) to your main conversation.

> **Caveat:** the often-quoted "**1,000–2,000 token summary**" figure is a reasonable order-of-magnitude but is **not stated in the Anthropic context-engineering post** — treat "a few thousand tokens" as the supported claim.

---

## Just-in-time retrieval over context stuffing

Anthropic's *Effective context engineering* guidance: **don't pre-load — keep lightweight identifiers and let the agent load data at runtime via tools.** Pre-loading triggers context rot *before any work begins*. Two concrete rules:

- **Link, don't paste.** Point to docs/URLs and let the agent fetch what it needs, rather than pasting API docs into `CLAUDE.md` (which the exclude table forbids anyway).
- **Install CLIs.** Per the Claude Code best-practices page (note: this exact phrasing is on *that* page, **not** the context-engineering post): "**CLI tools are the most context-efficient way to interact with external services.**" Install `gh`, `aws`, `gcloud`, etc.; the agent already knows them and avoids rate-limited unauthenticated calls.
- **Don't over-compact.** Aggressive summarization throws away precision; prefer fresh `/clear` between unrelated tasks over compacting a polluted window.

---

## One source of truth + monorepo nesting

Duplication across tool-specific files (`CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`, etc.) drifts into **conflicting** instructions — the worst failure mode, because the agent can't tell which to trust.

- Keep a **lean root `AGENTS.md`**, version-controlled, as the canonical source. (`AGENTS.md` is the emerging cross-tool standard; Claude Code reads `CLAUDE.md`, but the two can co-exist or one can `@`-import the other.)
- Tool-specific files should **reference** the root, not copy it.
- In **monorepos, nest per package.** Parent and child files are both pulled in (parent automatically; child on-demand when the agent touches that directory):

```
repo/
├── AGENTS.md                  # lean root: org-wide rules, top-level commands
├── packages/
│   ├── web/
│   │   └── AGENTS.md          # web-only: build/test commands, framework quirks
│   └── api/
│       └── AGENTS.md          # api-only: db conventions, migration etiquette
```

---

## TypeScript / React / Storybook specifics

Targeted guidance for a TS/React/Storybook stack, sized to the include/exclude rubric:

- **Make the linter the rule, not the prose.** Anything ESLint/Prettier can enforce should *not* live in `CLAUDE.md` — a non-zero exit code beats a paragraph. Reserve the file for what the linter can't express (architecture, "use the design-system `<Button>`, never raw `<button>`"). See [Linting for AI](09-linting-for-ai.md).
- **State the non-guessable commands only.** e.g. `pnpm test -- --run <file>` for a single Vitest file, `pnpm typecheck`, `pnpm build-storybook`. Omit anything inferable from `package.json` scripts (the agent reads it).
- **Encode the genuinely project-specific React decisions:** server vs. client component boundaries, the data-fetching layer (RSC / TanStack Query / RTK), the styling system (Tailwind tokens / CSS Modules / vanilla-extract) — these differ per repo and the model *will* guess wrong without them.
- **Storybook → a Skill, not the root file.** "How we write stories" (CSF3 format, required `args`/`argTypes`, a11y addon expectations, interaction tests) is *sometimes-relevant* knowledge. Put it in a `storybook-stories` skill so it loads only when the agent touches `*.stories.tsx`, keeping the root lean. See [TypeScript + React + Storybook](13-typescript-react-storybook.md).
- **Typecheck-after-batch as a workflow line** (per the docs' own example): "typecheck when you're done making a series of changes" — cheap, high-value, prevents the agent from compounding type errors.

---

## Freshness (2026)

- **Current.** The include/exclude rubric, the per-line prune test, JIT retrieval, skills' progressive disclosure, the four-way mechanism choice, and "install CLIs" are all current and stable post-late-2025.
- **Newly hot (Feb–Mar 2026).** The *efficacy debate* (arXiv 2602.11988 contrarian vs. 2601.20404 efficiency win) is the live front. Track it; the consensus is settling on **quality over existence**, but the contrarian result on **LLM-generated** files is robust enough to act on now.
- **Now stale / never-quite-true.** "Just `/init` and you're done" — the auto-generated file is the *most* likely to hurt per ETH Zurich; prune it. The "150 lines → 20–23% cost" causal claim is stale/unsupported — drop it. As newer models extend usable context, the *absolute* size of "too big" may shift, but the **relative** discipline (smallest set that changes behavior) does not.

---

## Sources

- [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) — Anthropic (current). Include/exclude table, per-line prune test, "CLIs are most context-efficient," mechanism choice, subagents-for-investigation. *(No numeric line limit appears here.)*
- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — Anthropic, Sep 2025. JIT retrieval, don't over-compact, subagent context isolation.
- [Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) — Anthropic, Oct 2025. Progressive disclosure / `SKILL.md` structure.
- [Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?](https://arxiv.org/abs/2602.11988) — Gloaguen et al., ETH Zurich / LogicStar.ai, Feb–Mar 2026 (AGENTBENCH, ~138 tasks). Contrarian: files can reduce success; cost up >20%; ~3.92 steps. *(Exact success-delta figures are in secondary summaries; abstract states direction + ">20%".)*
- [On the Impact of AGENTS.md Files on the Efficiency of AI Coding Agents](https://arxiv.org/abs/2601.20404) — 2026 (10 repos / 124 PRs). Counterbalance: `AGENTS.md` present → ~28.64% lower median runtime, ~16.58% fewer output tokens, comparable completion.
- [How to build AGENTS.md](https://www.augmentcode.com/guides/how-to-build-agents-md) — Augment Code, 2026. Single source of truth, monorepo nesting, ~150-line community heuristic.
- [Context Rot](https://research.trychroma.com/context-rot) — Chroma Research. Empirical context-window degradation.
- [Codex best practices](https://developers.openai.com/codex/learn/best-practices) — OpenAI. Cross-tool `AGENTS.md` conventions.
- [Advanced Context Engineering for Coding Agents (ace-fca)](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/ace-fca.md) — HumanLayer. Practitioner patterns for context discipline.
