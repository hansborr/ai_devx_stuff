# Multi-Agent Orchestration & Parallelism

## TL;DR

Multi-agent parallelism in 2026 is real and powerful, but routinely over-reached. The durable rule across every primary source: **parallelism pays only when subtasks are genuinely independent** — they don't read/write the same files, don't share state, and don't depend on each other's output. For research-style fan-out and large mechanical migrations the wall-clock and quality gains are large; for sequential or tightly-coupled feature coding (most of it), a single session or in-session subagents win, because coordination overhead, token multiplication, and context fragmentation eat the benefit. The single highest-leverage reliability lever is structural: **separate the agent doing the work from the agent judging it** (planner / generator / evaluator).

### Top actionable takeaways

- **Default to single-agent.** Only parallelize when you can draw clean file/module ownership boundaries with zero shared writes. If you can't, stay single-agent or chain subagents sequentially.
- **Pick the right primitive before spawning:** verbose side-task → subagent; several independent tasks to check later → `claude agents` (agent view); peers that must discuss/challenge → agent teams; 50+ files / cross-checked research → a dynamic workflow.
- **Isolate files with git worktrees first**, then install deps per worktree (use pnpm) and auto-copy gitignored env files via `.worktreeinclude`.
- **Build a generator → evaluator loop.** Make the evaluator a distinct subagent with a rubric, hard pass/fail thresholds, and low temperature. Agree a definition of done before any code.
- **Tier your models:** strongest model for the orchestrator/planner only; Sonnet for workers/teammates; Haiku for read-only search and formatting.
- **Gate every parallel PR** behind `tsc` + ESLint + tests (+ visual regression for UI) and a merge queue. Land work as small stacked PRs (~under 200 lines, one logical thing each).

---

## The four primitives (don't conflate them)

Claude Code's "Run agents in parallel" docs define four mechanisms that solve *different* problems. Conflating them is the most common mistake — each has distinct context, communication, and cost semantics, and the wrong choice is exactly where coordination overhead and context fragmentation originate.

| Primitive | What it is | Coordinates? | Talk to each other? | Use when |
|---|---|---|---|---|
| **Subagents** | Delegated worker *inside one session*, own context window, returns only a summary | Parent session | No | Verbose/cheap side-task you want kept out of the main context |
| **Agent view** (`claude agents`, research preview) | One screen to dispatch & monitor independent background sessions, each auto-moved into its own worktree | You, manually | No | Several independent tasks to launch now and review later |
| **Agent teams** (experimental, off by default) | Coordinated peer sessions with a shared task list + inter-agent messaging, managed by a fixed lead | A lead agent | Yes (Mailbox) | Peers that must discuss/challenge: parallel review, competing-hypothesis debug |
| **Dynamic workflows** (`/workflows`) | A JavaScript script Claude writes that orchestrates dozens-to-hundreds of subagents and cross-checks results | The script | Via script logic | 50+ files, large migrations, cross-checked research |

Worktrees and `/batch` are **supporting tools, not coordination styles**. The decision axes are: *who coordinates*, *do workers need to talk*, and *do tasks touch the same files*. If tasks touch the same files, isolate with worktrees first.

> See also: [10-agent-guidance-and-context.md](10-agent-guidance-and-context.md) for context engineering and [18-mcp-and-tool-design.md](18-mcp-and-tool-design.md) for tool design that subagents inherit.

## The independence precondition (the negative heuristic)

The strongest 2026 heuristic is the negative one. Anthropic's multi-agent research framing: multi-agent excels at **heavy parallelization, information exceeding a single context window, and many complex tools** — but is a *poor* fit for most coding, because coding has fewer truly parallelizable tasks than research and agents struggle to coordinate around shared state in real time. The agent-teams docs put it plainly: *for sequential tasks, same-file edits, or work with many dependencies, a single session or subagents are more effective.*

Coordination cost (tokens, latency, merge risk, fragmentation) is **fixed overhead** that only amortizes when independent work runs concurrently. So:

- **Good fan-out:** research auth, database, and API modules in parallel with separate subagents.
- **Bad fan-out:** two agents both editing a shared config or the same component file.
- **Safe ramp:** start agent teams on research/review (no code writes) before trusting them with parallel implementation.

Confidence: **high** (primary Anthropic + Claude Code docs). Secondary sources report meaningful coordination overhead directionally, not precisely.

## Git worktrees: the file-isolation foundation

A worktree is a separate working directory with its own files and branch, sharing the same repo history — edits in one session never touch another. Two agents in one working directory corrupts state.

```bash
# Claude Code managed worktree (creates .claude/worktrees/feature-auth/ on
# branch worktree-feature-auth, from origin/HEAD — falls back to local HEAD
# if there's no remote or the fetch fails)
claude --worktree feature-auth      # or -w
claude --worktree '#1234'           # check out a PR into a worktree

# To branch from local HEAD when you have unpushed work:
# set worktree.baseRef = head in settings

# Manual worktrees
git worktree add ../proj-feat-a -b feature-a
git worktree list
git worktree remove ../proj-feat-a

# Keep managed worktrees out of VCS
echo '.claude/worktrees/' >> .gitignore
```

A worktree is a **fresh checkout**, so gitignored files like `.env` / `.env.local` are absent. Add a `.worktreeinclude` file at the project root (gitignore syntax) to auto-copy them into every new worktree — including subagent and desktop parallel-session worktrees:

```gitignore
# .worktreeinclude
.env
.env.local
config/secrets.json
```

You must **re-init the dev environment per worktree** (separate `node_modules`). For TS/JS this means a per-worktree install — and it's the concrete reason to prefer **pnpm**: its content-addressable store plus symlinks make per-worktree installs near-instant and share the global store, avoiding `node_modules` contention.

## Subagents: context isolation

Each subagent runs in its **own context window** with a custom system prompt, scoped tools, and permissions; only a summary returns. This keeps verbose exploration/test output out of the orchestrator's window, preserving coherence and cutting token cost. Define them as Markdown + YAML frontmatter in `.claude/agents/` (project, version-controlled) or `~/.claude/agents/` (user).

```markdown
---
name: code-reviewer
description: Reviews diffs for correctness and standards. Use proactively after edits.
tools: Read, Grep, Glob, Bash
model: inherit          # sonnet | opus | haiku | fable | inherit (default)
permissionMode: default
maxTurns: 12
isolation: worktree     # temp worktree, auto-cleaned if it makes no changes
---
You are a skeptical reviewer. Report concrete defects with file:line. Do not praise.
```

Key fields: `name`, `description` (drives auto-delegation — add "use proactively"), `tools`/`disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`, `memory` (project/user/local), `background`, `effort`, `isolation: worktree`, `color`. Built-ins: **Explore** (Haiku, read-only, fast search), **Plan**, **general-purpose**.

Practical routing:
- Read-only reviewer → `tools: Read, Grep, Glob, Bash`, `model: inherit`.
- Verbose/cheap work → `model: haiku`.
- Any subagent writing files in parallel → add `isolation: worktree`.
- Restrict an orchestrator's spawn rights → `tools: Agent(worker, researcher)`.

Invoke via natural language, `@agent-code-reviewer`, or session-wide `claude --agent code-reviewer`. Notes: the `Task` tool was renamed **Agent** in v2.1.63 (Task aliases still work); nested subagents are supported (v2.1.172+) with a fixed background-depth limit; `/fork` inherits full conversation context (cheaper via shared prompt cache) for trying several approaches from the same starting point.

## Orchestrator-worker + planner / generator / evaluator

This is the highest-leverage reliability pattern. Anthropic's harness-design work (March 2026) for long-running apps uses three roles:

- **Planner** — expands a 1–4 sentence prompt into a spec.
- **Generator** — implements iteratively.
- **Evaluator** — does QA, driving the *running* app via Playwright MCP.

The core finding: **agents confidently praise their own mediocre work**, so separating the doer from the judge is a strong, structural lever — far more tractable than self-critique. Before any code, the generator and evaluator negotiate a **sprint contract** defining "done." Communication was file-based.

The hard-threshold mechanism — graded criteria, each with a pass/fail bar, where *any* criterion below threshold fails the sprint — is what the full-stack harness used. (The four named criteria — design quality, originality, craft, functionality — come from a *separate frontend-design experiment* in the same article; the full-stack evaluator's criteria are unnamed but modeled on that experiment.) Few-shot examples reduced score drift.

Build it like this:

- Make the evaluator a **distinct subagent** with its own rubric and hard pass/fail thresholds.
- Run the critic **strict / low (≈0) temperature** for deterministic, repeatable judgments (evaluator-optimizer sources).
- **Agree the definition of done before implementation.**
- **Tune the evaluator** by reading its logs and editing its prompt over several rounds.

Anthropic's research system mirrors this with a separate **citation pass** that verifies claims against sources after the main work.

> Related gates and rubrics: [15-evals-and-observability.md](15-evals-and-observability.md), [08-preventing-ai-slop.md](08-preventing-ai-slop.md).

## Fan-out then verify at scale: dynamic workflows

Dynamic workflows (v2.1.154+, paid plans) move the orchestration *plan into a JavaScript script Claude writes*, so intermediate results live in script variables and **only the final answer reaches Claude** — keeping context clean and making runs resumable and repeatable. The real win over "just run more agents" is a **quality pattern**: independent agents adversarially review each other's findings, or a plan is drafted from several angles and weighed.

Bundled `/deep-research` fans out searches, cross-checks sources, **votes on each claim**, and returns a cited report with unsupported claims filtered out.

Hard caps: up to **16 concurrent agents** (fewer on limited CPU), **1,000 agents total per run**. Workflow subagents always run in `acceptEdits` mode. Trigger with `/effort ultracode` (a **session-wide** mode) or the one-off keyword — note the keyword was literally `workflow` before v2.1.160 and `ultracode` after. `/workflows` shows per-agent token usage; gauge cost on one directory first, stop anytime without losing completed work, and save good runs with `s` to `.claude/workflows/`.

Separately, **`/batch`** is a packaged skill that splits one large change into **5–30 worktree-isolated subagents**, each opening a PR — ideal for, e.g., a 500-file rename or migration.

```text
ultracode: audit every API endpoint under src/routes/ for missing auth checks
/batch  → splits a 500-file rename into 5–30 subagents, each opening a PR
```

## Agent teams: peers with a shared task list

Agent teams (experimental; `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; v2.1.32+) give each teammate its own context window and let them **message each other via a Mailbox**, coordinating through a **shared task list** (pending/in-progress/completed with dependencies; file-locking prevents race conditions). A **fixed lead** spawns and coordinates; teammates self-claim or are assigned tasks.

Best fits: parallel **code review** (one teammate per lens — security / performance / test-coverage), **new modules** each owned by a teammate, **competing-hypothesis debugging** (adversarial debate beats single-agent anchoring), and cross-layer changes.

Critical caveats:
- **Cost ≈ 7× a standard session** when teammates run in plan mode (figure from the **costs** doc, not the agent-teams page); usage scales roughly linearly with teammate count. Use **Sonnet** for teammates.
- **No worktree isolation** — teams do *not* sandbox teammates. You must **partition files manually** so each teammate owns a different set.
- Start **3–5 teammates, ~5–6 tasks each**; three focused teammates often beat five scattered ones.
- Limitations: one team at a time, no nested teams, lead is fixed, in-process teammates don't survive `/resume`, and task status can lag.

Operational hygiene: pre-approve common permissions before spawning, explicitly assign file ownership in spawn prompts, enforce gates with **`TeammateIdle` / `TaskCreated` / `TaskCompleted` hooks** (exit code 2 to send feedback or block), and always have the lead clean up the team.

```text
"Create an agent team to review PR #142: one teammate on security,
 one on performance, one on test coverage; lead synthesizes across all three."
```

> Hook mechanics: [12-custom-hooks.md](12-custom-hooks.md).

## Design against the three failure modes

All three trace back to insufficient decomposition and under-specified delegation — cheaper to fix at the orchestration layer than to clean up afterward.

1. **Context fragmentation** — an agent with partial context confidently produces work that contradicts the parts it didn't receive (arguably worse than no context). *Mitigate:* self-contained tasks; **detailed spawn prompts** (teammates don't inherit the lead's conversation history — they load CLAUDE.md / MCP / skills plus the spawn prompt); a synthesis/citation pass.
2. **Duplicated work** — Anthropic found that without specific task descriptions, subagents misinterpreted tasks or ran the *exact same searches* as siblings. *Mitigate:* non-overlapping descriptions, a distinct lens per agent, and scale effort to complexity (simple fact-finding ≈1 agent / 3–10 tool calls; comparisons 2–4; complex 10+).
3. **Merge hell** — shared config/lockfiles/generated files edited from two directions conflict. *Mitigate:* decompose by domain/feature so no two agents write the same files; avoid editing shared config in feature branches (prefer env-var config excluded from VCS); keep PRs small and **stacked** (~under 200 lines, one logical thing each); gate behind a **merge queue + integration CI** after parallel outputs land.

## Background/async & cloud agents shift the bottleneck to review

The 2026 shift: tooling races toward parallel orchestration, and the bottleneck is no longer *what* an agent can do but **how many you can direct and review at once**. Claude Code's **agent view** (`claude agents`, research preview, v2.1.139+) dispatches and monitors independent background sessions from one screen, each in its own worktree, hosted by a local supervisor process (`/bg` backgrounds an open session; `--cwd` narrows to one project). Distinct from this, **Claude Code Routines** run a session on a schedule in Anthropic's cloud, and **Remote Tasks** provide cloud execution. Competitors (Codex Cloud, Cursor Cloud Agents, GitHub Copilot's cloud agent, Devin — each agent in its own cloud VM) run async and open PRs.

Secondary reporting is directional but consistent: AI-generated PRs tend to wait longer for review and are accepted less often than human PRs — which makes automated gates **non-negotiable**. Recommended merge stack: a **merge queue** (GitHub native / gh-stack, Aviator, or Trunk) + an **AI review layer** + **dependency automation** (Renovate/Dependabot).

- **Cap concurrent background/cloud agents to your review capacity.**
- Require every parallel PR to pass `tsc`, ESLint, unit/component tests, and (for UI) visual regression before a merge queue lands it.
- Keep each agent's PR small and single-purpose.

> CI gates in depth: [04-static-analysis-and-ci-cd-gates.md](04-static-analysis-and-ci-cd-gates.md). Supply-chain risk for cloud agents: [14-security-and-supply-chain.md](14-security-and-supply-chain.md).

## Tier models and clear context to stay affordable

Anthropic's research system used an **Opus lead with Sonnet subagents**. Token usage there ran roughly an order of magnitude above a chat interaction (single agents notably less), and **token usage alone explained most of the performance variance** — spend tracks performance, so route it deliberately. Naive all-Opus fan-out is expensive without proportional benefit.

Levers:
- Strongest model **only** for orchestrator/planner; **Sonnet** for workers/teammates; **Haiku** for read-only search (the Explore subagent) and formatting.
- **Isolate verbose operations** (tests, logs, docs) in subagents so only summaries return.
- Keep `CLAUDE.md` under ~200 lines; move specialized instructions to **on-demand skills**.
- `/clear` (or compact) **between unrelated tasks**; monitor with `/usage` and `/context`.

## TypeScript / React / Storybook specifics

- **Per-worktree `pnpm install`.** pnpm's content-addressable store + symlinks make each worktree's install resolve from the shared global store in seconds — the concrete reason to prefer pnpm over npm for parallel worktrees. Ship `.env`/`.env.local` via `.worktreeinclude`.
- **Partition by feature/file ownership.** Give each parallel agent a distinct route/component/module so no two write the same `.tsx` file or shared `*.stories.tsx`. Treat `tsconfig`, ESLint config, design tokens, and the lockfile as **shared files no feature agent edits** — route those changes through a single dedicated PR.
- **Gate parallel output** behind: `tsc --noEmit`, ESLint, **Storybook test-runner** (interaction/a11y), and **Chromatic** (visual regression) before the merge queue lands anything. This is what turns many parallel UI PRs into safely merged work.
- **Evaluator via Playwright MCP.** A reviewer subagent that loads the *running* Storybook or app and checks rubric criteria catches integration/edge-case defects a single generator misses — e.g., a route matching `reorder` as an integer id and returning 422.
- **Small stacked PRs** (~under 200 lines): one component, one story update, or one hook per PR, stacked with gh-stack/Aviator.

> Toolchain detail: [13-typescript-react-storybook.md](13-typescript-react-storybook.md); design-system enforcement: [07-ui-design-systems-enforcement.md](07-ui-design-systems-enforcement.md).

## Trade-offs & confidence

- **High confidence** (primary Anthropic + Claude Code docs): the four-primitive taxonomy, the independence precondition, worktree/`.worktreeinclude` mechanics, subagent frontmatter, planner/generator/evaluator, workflow caps, model tiering, the three failure modes.
- **Directional, not precise:** coordination-overhead magnitude, AI-PR review/acceptance gaps, and tiered-cost savings — stated qualitatively because the underlying figures aren't independently verifiable. The agent-teams **~7× token** figure is from the costs doc and applies to plan-mode teammates specifically.
- **Moving targets:** agent view is a research preview and agent teams are experimental (off by default) — expect flags, limits, and keywords to change.

## Freshness (2026)

Current as of **Claude Code v2.1.x (2026)**. Agent view is a research preview (v2.1.139+); agent teams are experimental (v2.1.32+, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`); dynamic workflows landed v2.1.154+ (the trigger keyword changed from `workflow` to `ultracode` at v2.1.160); the `Task` tool was renamed `Agent` at v2.1.63; nested subagents v2.1.172+. Verify version-gated behavior against the live docs before relying on it.

## Sources

- [Run agents in parallel — Claude Code docs](https://code.claude.com/docs/en/agents) (2026)
- [Subagents — Claude Code docs](https://code.claude.com/docs/en/sub-agents) (2026)
- [Agent teams — Claude Code docs](https://code.claude.com/docs/en/agent-teams) (2026)
- [Worktrees — Claude Code docs](https://code.claude.com/docs/en/worktrees) (2026)
- [Dynamic workflows — Claude Code docs](https://code.claude.com/docs/en/workflows) (2026)
- [Agent view — Claude Code docs](https://code.claude.com/docs/en/agent-view) (2026)
- [Manage costs — Claude Code docs](https://code.claude.com/docs/en/costs) (2026)
- [How we built our multi-agent research system — Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system) (2025)
- [Designing harnesses for long-running agentic apps — Anthropic Engineering](https://www.anthropic.com/engineering/harness-design-long-running-apps) (March 2026)
- [Single-agent vs multi-agent systems — M. J. G. Mario, Medium](https://medium.com/@mjgmario/single-agent-vs-multi-agent-systems-when-coordination-helps-hurts-and-pays-off-57735ee7916d) (2026)
- [Scaling parallel AI agents — getunblocked](https://getunblocked.com/blog/scale-parallel-ai-agents/) (2026)
- [Parallel agentic development with git worktrees — MindStudio](https://www.mindstudio.ai/blog/parallel-agentic-development-git-worktrees) (2026)
- [Stop fighting node_modules: managing monorepos in 2026 — James Miller, Medium](https://medium.com/@jamesmiller22871/stop-fighting-node-modules-a-modern-guide-to-managing-monorepos-in-2026-16cbc79e190d) (2026)
- [DIY evaluator-optimizer LLM agent — ML Pills, Substack](https://mlpills.substack.com/p/diy-19-evaluator-optimiser-llm-agent) (2026)
- [Stacked PRs and AI worktrees — Georg Heiler](https://georgheiler.com/2026/03/17/stacked-prs-and-ai-worktrees/) (March 2026)
- [6 background AI agents for async development — Security Boulevard](https://securityboulevard.com/2026/06/6-background-ai-agents-for-async-development/) (June 2026)
- [Best AI coding agents — Firecrawl](https://www.firecrawl.dev/blog/best-ai-coding-agents) (2026)
