# Structuring a Codebase for AI Agents

## TL;DR

For an AI agent, the codebase *is* the prompt. Every irrelevant file the agent must read costs tokens, latency, and accuracy, and model performance degrades measurably as the context window fills ("context rot"). The highest-leverage move is making the repo legible and navigable: co-located vertical slices, small single-responsibility files, explicit imports, narrow public APIs, and *machine-checkable* module boundaries — because agents punish architectural drift far harder than humans do, since they cannot hold the whole repo in working memory and pay a tool-call/token cost per file read. This is mostly plain good engineering; the new wrinkle is that you must *enforce* it in CI and *describe* it in docs-as-context, because an agent will not infer your architecture from convention.

### Top actionable takeaways

- **Organize by feature (vertical slices), not by technical layer** — a feature owns its UI, logic, data access, tests, and stories in one folder so the agent can change it within one context window.
- **Kill internal barrel files; keep at most one curated public-API barrel per package** — direct imports preserve greppability and unambiguous symbol resolution.
- **Enforce dependency direction in CI** with `dependency-cruiser` / `eslint-plugin-boundaries` / Nx tags — TypeScript checks types, *not* architecture.
- **Maintain a lean, hierarchical `AGENTS.md`** (root + per-package); ruthlessly prune — bloat makes the model ignore your real instructions.
- **Exclude generated/build code** via `permissions.deny` globs in `.claude/settings.json` (the *native* mechanism), and isolate generated code in one directory.
- **Standardize on ONE pattern per job** and run `Knip` periodically — this is the direct antidote to the duplication agents are empirically prone to.

---

## Why structure matters more for agents than for humans

A human developer keeps a mental model of the repo and only opens files as needed. An agent has no persistent working memory across sessions: it reconstructs context from scratch via glob/grep and file reads, and **pays a per-file token + tool-call cost every time**. As the context window fills, accuracy drops — the "context rot" effect documented across 18 models (Chroma, 2025). So scattered code does not merely slow the agent; it raises hallucination rates even when the whole repo would technically fit in the window.

The empirical counter-pressure case comes from GitClear's 2025 report (analyzing 2024 data): with AI assistants in wide use, **duplicated-code blocks rose from 8.3% to 12.3% of changes (~4x the share; roughly an 8x jump in raw block frequency)**, and **refactored ("moved") lines fell from ~24% (2020) to under 10% (2024)**, while short-term churn climbed. The mechanism: when several valid patterns exist for one job, the agent copies the most-recently-seen one or invents a new one. *Structure and enforcement are how you stop that drift.* (Caveat: GitClear's dataset predates the late-2025 frontier agents, but it remains the reference dataset.)

---

## Layout: vertical slices and small files

### Co-locate by feature, not by layer

Layered/onion architectures scatter a single change across `controllers/`, `services/`, `repositories/`, `dto/` — forcing the agent to read and hold many files. A **vertical slice** lets it understand, change, and test a feature within a manageable context window.

```
src/features/checkout/
  Checkout.tsx
  Checkout.stories.tsx
  useCheckout.ts
  checkout.api.ts
  checkout.test.ts
  README.md          # 3-5 lines: what this slice owns, what it does NOT own, external deps
```

Keep shared/cross-cutting code in a clearly marked `src/shared` or `packages/*` with an **inward-only** dependency direction (UI/infrastructure → application → domain). Document each slice's boundary in a sentence — "if you can't state it in a paragraph, it's not refactorable." (Confidence: **high**. The vertical-slice pattern predates the agent era but maps cleanly onto the context-window constraint — Jeremy Miller, Geovane Guibes, Richard Hightower, 2026.)

### Small, single-responsibility files and functions

Don't make the agent load a 1,000-line file (and pay for every token) to edit one function. There is **no authoritative numeric threshold** in the 2026 sources — treat "one screen / one concept per file" and "a function you can describe in one sentence" as the heuristic. Use ESLint rules as *soft* guardrails (warn, not error) and have the agent split files that trip them:

```jsonc
// .eslintrc — soft guardrails, intentionally "warn"
"rules": {
  "max-lines":              ["warn", { "max": 300, "skipBlankLines": true }],
  "max-lines-per-function": ["warn", { "max": 80 }],
  "complexity":             ["warn", 12]
}
```

*Nuance:* "larger files cost more per interaction" is directionally true but not a law — agents often read partial files, so cost is not strictly proportional to file size. The real wins are fewer irrelevant tokens per read and tighter, more accurate edits.

---

## Imports and public APIs

### Kill internal barrel files

Barrel files (`index.ts` that re-export a directory) hurt agents because they create ambiguity about where code actually lives — the agent sees `imported from ./components`, not the real file, undermining greppability and symbol navigation. Independent (non-AI) reasons reinforce this: barrels defeat tree-shaking, force test runners to load entire dependency graphs, and are a top source of circular dependencies. **Atlassian reported ~75% faster Jira *frontend* builds/CI** (TypeScript highlighting, unit tests) after an automated barrel-file removal.

**Contrarian/balanced position:** barrels *do* give a stable, narrow public API at a package boundary. So forbid deep internal barrels but allow **one** intentional public-API barrel per package.

```js
// .eslintrc — forbid reaching into another feature's internals
"no-restricted-imports": ["error", {
  "patterns": [{
    "group": ["@app/features/*/!(index)", "../*/internal/*"],
    "message": "Import from a feature's public entrypoint, not its internals."
  }]
}]
```

### Keep public APIs narrow

Expose each package/feature through a single curated entrypoint; everything else is internal. This constrains what the agent can import and reduces the chance it reaches into another module's internals or recreates logic. Pair it with an **allow-list** (not just a forbid-list) — `dependency-cruiser` supports this where ESLint `no-restricted-imports` cannot. This is the one legitimate place to keep a barrel file.

---

## Enforce boundaries in CI — not in prose

Architectural coherence "erodes one AI-generated PR at a time." Tests + linting are necessary but insufficient: **TypeScript only checks type correctness, NOT the dependency graph.** You need a separate architecture-fitness tool.

| Ecosystem | Tool(s) |
|---|---|
| JS/TS | `dependency-cruiser` + `eslint-plugin-import` / `eslint-plugin-boundaries`; Nx → `@nx/enforce-module-boundaries` with tags |
| Java | ArchUnit (layers, slices, cycles) |
| .NET | NetArchTest (ArchUnit-inspired fluent API) |
| Python | import-linter (layered / forbidden contracts) |
| Go | depguard (import allow/deny, via golangci-lint) |

`dependency-cruiser` turns the dependency graph into a fitness function that fails CI on violation, supports explicit allow-lists, detects circular deps, and keeps test code out of production code:

```js
// .dependency-cruiser.js
module.exports = {
  forbidden: [
    {
      name: 'no-cross-feature',
      severity: 'error',
      from: { path: '^src/features/([^/]+)/' },
      to: {
        path: '^src/features/(?!$1)([^/]+)/',
        pathNot: 'index\\.ts$'   // the public-API barrel is the only allowed seam
      }
    },
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    { name: 'no-test-in-prod', severity: 'error',
      from: { pathNot: '\\.(test|spec)\\.ts$' }, to: { path: '\\.(test|spec)\\.ts$' } }
  ]
};
```

Wire it into CI **and** a pre-commit / `PostToolUse` hook so agent PRs fail fast:

```bash
depcruise --config .dependency-cruiser.js src
```

`eslint-plugin-boundaries` defines "elements" + allowed dependencies and surfaces violations **in-editor in real time**, which the agent sees immediately during a session. For Nx, tag projects (`scope:*`, `type:*`) and configure `@nx/enforce-module-boundaries`. (Confidence: **high**. The enforcement-for-agents framing is 2026; the tools predate the agent era but are current and recommended.)

See also [Linting for AI](09-linting-for-ai.md) for teaching the agent via structured ESLint error messages.

---

## Docs-as-context

### Lean, hierarchical AGENTS.md / CLAUDE.md

`AGENTS.md` is the de-facto 2026 open standard, read natively by Claude Code, OpenAI Codex CLI, Cursor, Aider, Devin, Copilot, Gemini CLI, Windsurf, and Amazon Q. **The dominant failure mode is bloat:** for each line, ask "would removing this cause the agent to make mistakes? If not, cut it." Bloated files cause the model to ignore your actual instructions.

**Include:** non-guessable bash commands with exact flags; code-style rules that *differ* from defaults; repo etiquette; project-specific architectural decisions; env quirks; common gotchas. **Exclude:** anything inferable from code, standard conventions, file-by-file descriptions, long tutorials, or frequently-changing info. Describe **capabilities, not file paths** (paths churn and mislead).

Keep **one source of truth** at repo root (version-controlled, with an owner/DRI); have tool-specific files reference it via `@path` imports rather than duplicate. In monorepos, **layer it**: a root file (repo structure + shared commands + global rules) plus a per-package `AGENTS.md` scoped to what that package owns. Parent files load additively at launch; child files load on-demand when the agent reads a file there.

```markdown
# Root AGENTS.md
## Build & test (exact flags)
- Install:   pnpm install --frozen-lockfile
- Test:      pnpm test --run
- Typecheck: pnpm tsc --noEmit
- Boundaries: pnpm depcruise --config .dependency-cruiser.js src
## Conventions
- Prefer direct imports; never import a feature's internal index.ts.
- One validation lib (zod), one data-fetching pattern (TanStack Query).
```

```markdown
# packages/ui/AGENTS.md
- Every component needs a *.stories.tsx and co-located *.test.tsx.
- Document props with JSDoc (@summary on the component) to enrich the Storybook manifest.
```

Run `/init` to scaffold, then prune ruthlessly. Update the file in the **same PR** that introduces a convention, and review every 3–6 months. An arXiv study (124 PRs, 10 repos; arXiv 2601.20404) found `AGENTS.md` cut **output tokens ~17% (16.58%)** and **median runtime ~29% (28.64%)** — but bloat reverses the gains.

### Codebase map + per-folder READMEs

For unconventional or large repos, add `/CODEBASE_MAP.md` listing each top-level folder with a one-line description, and a 3–5 line `README.md` per feature/package (agents typically read `README.md` when they list a folder's contents). Keep them describing purpose/capability, **not** exhaustive file inventories. Cheap, high-signal context that reduces blind-exploration tokens.

### Excluding generated/build/vendored code

> **Correction vs. common advice:** `.claudeignore` is **not** a native Claude Code feature — it is a third-party npm package / community `PreToolUse` hook. The **native** exclusion mechanism is `permissions.deny` globs in `.claude/settings.json`, which is version-controlled so the whole team gets the same noise reduction.

```jsonc
// .claude/settings.json
{
  "permissions": {
    "deny": [
      "Read(dist/**)", "Read(build/**)", "Read(node_modules/**)",
      "Read(coverage/**)", "Read(**/*.generated.*)", "Read(src/generated/**)"
    ]
  }
}
```

**Caveat (reliability):** deny/ignore rules have known gaps — The Register (Jan 2026) reported Claude Code reading files that deny rules should block, including secrets. **Do not rely on these as a secrets boundary;** they are a noise-reduction tool, not a security control.

Keep generated code under a single top-level path (e.g. `src/generated/`, `*.gen.ts`). Marking those paths `linguist-generated=true` in `.gitattributes` **collapses them in GitHub PR diffs and removes them from language stats** — it does *not* signal anything to the agent or make files off-limits (agents don't read `.gitattributes` to decide what to skip). Agent-facing exclusion stays the `settings.json` deny list plus the isolated directory.

---

## Symbol-level navigation and feedback loops

Without a language server, the agent pattern-matches on text and can land on the wrong symbol (e.g. two identically-named functions). An **LSP / code-intelligence integration** gives the agent the developer's IDE navigation: follow a call to its definition, trace references, disambiguate symbols, and get type errors immediately after an edit. Install Claude Code's code-intelligence plugin (or equivalent) for typed languages, and ensure `tsc --noEmit` is a **fast, agent-runnable** check so type errors gate edits.

**Co-locate tests and stories** beside source so the agent edits implementation + tests/stories in one pass and has an immediate verification target. Scope `test`/`lint`/`typecheck` scripts per package and document them in that package's `AGENTS.md` so the agent runs only the relevant subset — tightening the loop and avoiding whole-repo timeout waste. (See [Verification & Feedback Loops](02-mitigations-and-best-practices.md).)

---

## Monorepos and the workspace graph

For monorepos, **expose the workspace graph** instead of letting the agent reconstruct it from config files. Nx ships an **nx-workspace skill/MCP (Feb 2026)** — working across Claude Code, Cursor, Copilot, Gemini, Codex, and OpenCode — that teaches the agent to query the project graph via `nx show projects`, `nx show project <name>`, `nx graph`, and `nx list` rather than read random config. A ~200-package workspace has implicit dependency chains that `AGENTS.md` prose can't capture; structured graph access is what scales. Prefer **incrementally-loaded skills** over dumping the whole structure into the system prompt.

### Monorepo vs. polyrepo (confidence: medium — a live 2026 debate)

The calculus is shifting **toward monorepo/meta-repo** because cross-repo boundaries cause agent context loss, duplicated setup, and manual coordination of cross-cutting changes. In a monorepo, an agent can make atomic cross-project changes in one PR and iterate to green CI with full context. Where consolidation isn't possible, the emerging **meta-repo / virtual monorepo** pattern (a lightweight repo via submodules or a manifest that sits above existing repos) gives agents a unified map across many repositories.

**Caveats:** monorepos need the boundary-enforcement + graph-exposure tooling above, or they become one giant undifferentiated context that overwhelms the window. Polyrepo still wins on hard isolation, independent deploy cadence, and blast-radius control. **Decide per org, not dogmatically.**

---

## Greppability and one-pattern-per-job

Agents navigate primarily by glob/grep and pattern-matching. The core problem usually isn't lack of structure but **too many competing valid structures**. Constrain to one validation lib, one data-fetching pattern, one error-handling shape, etc.; record the chosen patterns in `AGENTS.md`; back them with lint rules that teach the agent via structured error messages. Run **`Knip` (`@knip/mcp`)** periodically to delete AI-generated dead code and unused exports before they accrue — the direct counter to the duplication GitClear measured.

---

## TypeScript / React / Storybook specifics

- **Strict `tsconfig` as a structural guardrail.** Strict typing narrows the space of valid code and gives the agent a `tsc` feedback loop to self-correct against. Enable strict mode plus the stricter optional flags:

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true
  }
}
```

- **Enforce the dependency graph** with `dependency-cruiser` and/or `eslint-plugin-boundaries` — TypeScript checks types, not architecture.
- **Kill barrel files**; one curated package-root `index.ts` as the public surface; run a one-time agent-assisted migration to direct imports.
- **Co-locate `*.stories.tsx` and `*.test.tsx`** with the component.
- **Document components with JSDoc** (`@summary`, prop descriptions). Storybook's MCP manifest is generated from CSF static analysis + prop-type extraction *regardless*; JSDoc **enriches** that manifest so it serves higher-quality curated context — it doesn't enable it.
- **Run `Knip`** to keep AI-generated dead code and unused exports from accumulating.

---

## Freshness (2026)

- **Current / firmly 2026:** the "codebase is the prompt" thesis (Jeremy Miller, Geovane Guibes); the `AGENTS.md` open standard and its native-support roster; Nx agent skills + MCP (Feb 2026) and the shift from MCP tools to incrementally-loaded skills; Storybook MCP manifests + JSDoc extraction; context-rot evidence (Chroma 2025, 18 models); Claude Code's TypeScript LSP plugin.
- **Pre-agent-era but still current/recommended (flagged inline):** dependency-cruiser, Nx boundaries, vertical slices, small files — all predate the agent era but map cleanly onto it.
- **Reference-but-aging:** GitClear's duplication/refactoring data is through 2024 (published 2025), predating frontier agents — still the best dataset, but read as a trend, not a measurement of today's tools.
- **Correct a stale meme:** `.claudeignore` as a *native* feature is wrong — use `permissions.deny` in `.claude/settings.json`; and treat ignore/deny rules as noise reduction, **not** a security boundary.

---

## Sources

- [Your Codebase Is the New Prompt — Geovane Guibes (Apr 2026)](https://guibesdev.medium.com/your-codebase-is-the-new-prompt-architecture-for-the-ai-era-8ad33d319489)
- [The Codebase Is the Prompt — Jeremy Miller (Jun 4, 2026)](https://jeremydmiller.com/2026/06/04/the-codebase-is-the-prompt-wolverine-vertical-slices-and-ai-assisted-development/)
- [Optimizing Codebase Architecture for AI Coding Tools — Richard Hightower (2026)](https://medium.com/@richardhightower/ai-optimizing-codebase-architecture-for-ai-coding-tools-ff6bb6fdc497)
- [Agent Experience — marmelab (Jan 21, 2026)](https://marmelab.com/blog/2026/01/21/agent-experience.html)
- [How Claude Code Works in Large Codebases — Anthropic (2026)](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start)
- [Claude Code Best Practices — Anthropic (2026)](https://code.claude.com/docs/en/best-practices)
- [TypeScript for AI Agents — Encore (2026)](https://encore.dev/blog/typescript-ai)
- [The Barrel Trap — dev.to/elmay (2026)](https://dev.to/elmay/the-barrel-trap-how-i-learned-to-stop-re-exporting-and-love-explicit-imports-3872)
- [AI Architecture Drift — techdebt.best (2026)](https://techdebt.best/ai-architecture-drift/)
- [Enforcing Architecture in an Agent-Driven Codebase — Phoebe (2026)](https://www.phoebe.work/blog/enforcing-architecture-in-an-agent-driven-codebase)
- [Frontend Architecture with dependency-cruiser — Xebia (2026)](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/)
- [Enforce Module Boundaries — Nx docs](https://nx.dev/docs/technologies/eslint/eslint-plugin/guides/enforce-module-boundaries)
- [eslint-plugin-boundaries — npm](https://www.npmjs.com/package/eslint-plugin-boundaries)
- [Writing Good Agents — Phil Schmid (2026)](https://www.philschmid.de/writing-good-agents)
- [How to Build AGENTS.md — Augment (2026)](https://www.augmentcode.com/guides/how-to-build-agents-md)
- [AGENTS.md token/runtime study — arXiv 2601.20404 (2026)](https://arxiv.org/abs/2601.20404)
- [Nx AI Agent Skills (Feb 2026)](https://nx.dev/blog/nx-ai-agent-skills)
- [Monorepo vs Polyrepo: AI's New Rules — Augment (2026)](https://www.augmentcode.com/learn/monorepo-vs-polyrepo-ai-s-new-rules-for-repo-architecture)
- [The Meta-Repo Pattern (2026)](https://devnewsletter.com/p/meta-repo-pattern/)
- [GitClear AI Code Quality Research — 2025 report (2024 data)](https://www.gitclear.com/ai_assistant_code_quality_2025_research)
- [Knip — dead code detection](https://knip.dev/)

---

*See also: [Overview](00-overview.md) · [Linting for AI](09-linting-for-ai.md) · [Verification & Feedback Loops](02-mitigations-and-best-practices.md)*
