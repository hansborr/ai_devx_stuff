# TypeScript + React + Storybook Best Practices (with and without AI)

> **TL;DR** — A modern TS/React/Storybook stack is also the cheapest, most reliable scaffolding you can hand an AI agent, because the same deterministic signals that catch human mistakes (`tsc --noEmit`, lint, runtime schema parse, story-as-test) are exactly what an agent loops against to self-correct. In mid-2026 the highest-leverage moves are: turn on **strict plus the four flags `strict` omits**, **validate every boundary at runtime** (Zod v4 / Valibot), expose your component library to agents via the **Storybook 10.3 MCP server** so they stop hallucinating props, and **run your stories as browser tests** through the Vitest addon. Wrap it all in mechanical guardrails (dependency boundaries, dead-code/duplication checks, mutation testing) and a concise `AGENTS.md` — but treat the `AGENTS.md` productivity claim as promising-not-proven.

**Top actionable takeaways**

- **`tsc --noEmit` in the loop** is the single best agent feedback signal. Add `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noFallthroughCasesInSwitch` on top of `strict`.
- **Parse, don't trust, at every edge** (HTTP, env, `localStorage`, form input) with Zod v4 (default) or Valibot; derive types with `z.infer` so the validator is the single source of truth.
- **Wire the Storybook MCP server** (10.3+, React + Vite only today) so agents read *real* props/stories/tests instead of inventing them.
- **Stories ARE your component tests** via `@storybook/addon-vitest` (CSF3 `play` + axe a11y), run in a real browser.
- **Kill barrel files**, colocate by feature, use direct imports; gate dead code with **Knip** and duplication with **jscpd**.
- **Enforce architecture as code**: `eslint-plugin-boundaries` for layering, **Stryker** mutation testing + **fast-check** property tests for real coverage.
- **TanStack Query v5** (`@tanstack/react-query`, currently ~5.x) + Zustand for the server/client state split (note: there is no TanStack Query v6 for React — v6 is Svelte-only).

See also: [Overview](00-overview.md) · [Codebase Structure for Agents](03-codebase-structure-for-agents.md) · [Static Analysis & CI/CD Gates](04-static-analysis-and-ci-cd-gates.md) · [UI Design Systems Enforcement](07-ui-design-systems-enforcement.md) · [Linting for AI](09-linting-for-ai.md)

---

## Why this stack doubles as agent scaffolding

Agents work in a generate → check → fix loop. The quality of that loop is bounded by the quality and *speed* of the checks. A type error, a failed runtime parse, or a red story-test is a cheap, deterministic, machine-readable signal an agent can act on without a human. Prose in `AGENTS.md` is a *probabilistic* nudge; a failing `tsc` is a *wall*. Everything below is chosen because it converts "please be careful" into "this won't compile / won't parse / won't pass."

The empirical backdrop matters: GitClear's 2025 analysis found AI-assisted codebases accrue duplicated blocks and shrink their share of refactoring work. That makes duplication/dead-code detection and strict typing not optional hygiene but the primary counter-pressure against agent output drift.

---

## TypeScript: strict, plus the four flags strict omits (confidence: high)

`"strict": true` is table stakes but does **not** enable everything. The four high-value flags it leaves off:

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,

    // The four strict OMITS — turn these on:
    "noUncheckedIndexedAccess": true,        // arr[i] is T | undefined, not T
    "exactOptionalPropertyTypes": true,      // {x?: number} ≠ {x: number | undefined}
    "noPropertyAccessFromIndexSignature": true, // obj.foo vs obj["foo"] discipline
    "noFallthroughCasesInSwitch": true,      // catches missing `break`/`return`

    // Worth adding for module hygiene:
    "verbatimModuleSyntax": true,
    "noImplicitOverride": true,
    "isolatedModules": true,

    "noEmit": true
  }
}
```

Then make the typecheck a **dedicated, required signal**, separate from your bundler:

```bash
tsc --noEmit          # in the agent loop AND in CI
```

Your bundler (Vite/esbuild/SWC) transpiles per-file and **does not typecheck the whole program** — `tsc --noEmit` is the only thing that does. `noUncheckedIndexedAccess` is the standout for agents: it forces them to handle the `undefined` case on every array/record access, eliminating a whole class of "works until the index is missing" bugs that agents otherwise emit confidently.

**Trade-off (honest):** `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` add real friction to existing codebases — expect churn enabling them retroactively. On greenfield/agent-driven work the friction is front-loaded onto the agent, which is exactly where you want it.

---

## Runtime-validate your boundaries (confidence: high)

Types vanish at runtime; an API that lies, a malformed env var, or stale `localStorage` will sail past `tsc`. Validate at the edge and let the type *flow from* the schema:

```ts
import { z } from "zod"; // Zod v4 is the package-root default as of mid-2026

const User = z.object({
  id: z.uuid(),
  email: z.email(),
  roles: z.array(z.enum(["admin", "user"])).default([]),
});
type User = z.infer<typeof User>;       // single source of truth

const res = await fetch("/api/me");
const user = User.parse(await res.json()); // throws on drift, narrows the type
```

- **Zod v4** is the default choice in 2026. Note that v4 stabilized in Aug 2025 and first shipped at the **`zod/v4` subpath alongside `zod@3`** before becoming the package-root default — older projects may still import via `import { z } from "zod/v4"`, so check which you have.
- **Valibot** is the lighter alternative: a *single tree-shaken simple schema* can add **under ~1KB**, but the **full library is ~5KB min+gz** — the "sub-1KB" figure is per-schema, not a flat library size. Reach for it when bundle budget on the client is tight.
- **tRPC** pairs naturally: it carries inferred types end-to-end across the client/server boundary with no codegen, so the agent gets one consistent type surface.

For agents specifically, runtime validation converts "the API shape changed" from a silent production bug into a loud, local, reproducible parse error the agent can fix in-loop.

---

## Storybook: MCP + stories-as-tests

### Storybook 10.3 MCP server (confidence: high)

Storybook 10.3 ships an **MCP server** that exposes your *real* components — their actual props, existing stories, and tests — to AI agents. The payoff: agents reuse and compose existing components and **stop hallucinating prop names and signatures**, the single most common React failure mode for LLMs.

```bash
# Storybook 10.3+ (React + Vite); expose components to your agent via MCP
npx storybook add @storybook/addon-mcp   # serves an MCP endpoint at /mcp on the dev server
# then register the /mcp endpoint with your agent
```

**Caveat (important):** the MCP server / manifests are **React-only and Vite-only at launch, by design** — the official `@storybook/addon-mcp` supports the React renderer on Vite-based setups (e.g. `@storybook/react-vite`, `@storybook/nextjs-vite`), not Webpack. Vue, Angular, Svelte, and Web Components support is explicitly *planned* but not shipped — if you're not on React + Vite, this lever isn't available to you yet.

### Stories as tests via the Vitest addon (confidence: high)

CSF3 stories double as browser-run tests. With `@storybook/addon-vitest`, every story runs in a real browser (Playwright), your `play` function becomes an interaction test, and you can assert accessibility with axe:

```ts
// Button.stories.tsx — a story that is also an interaction + a11y test
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "storybook/test";
import { Button } from "./Button";

const meta: Meta<typeof Button> = { component: Button, tags: ["autodocs"] };
export default meta;

export const ClicksOnce: StoryObj<typeof Button> = {
  args: { children: "Save" },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};
```

```bash
vitest --project=storybook   # runs every story as a browser test
```

This is the cheapest visual/behavioral signal you can give an agent: it writes a component, the story renders it in a browser, the `play` exercises it, and axe flags a11y regressions — all without a human opening a browser. **Vitest 4.1** added an **`agent` reporter** that auto-enables when Vitest detects it's running inside an AI coding agent: it suppresses passing-test output and console logs, printing only failing tests and the final summary, specifically to keep this loop legible to agents (less noise, fewer tokens).

---

## Architecture & state: structure agents can navigate (confidence: high)

### Kill barrels, colocate by feature

Barrel files (`index.ts` re-exporting a folder) wreck tree-shaking, create import cycles, and force agents to chase indirection. Use **direct imports** and colocate everything a feature needs:

```
src/
  features/
    checkout/
      CheckoutForm.tsx
      CheckoutForm.stories.tsx
      useCheckout.ts
      checkout.schema.ts      // Zod schema lives next to its feature
      checkout.test.ts
  shared/
    ui/Button.tsx
```

A flat, colocated, barrel-free tree is easier for an agent to navigate: the file it needs is named what it does and sits next to its siblings. Gate the anti-patterns mechanically:

```bash
knip          # unused files, exports, deps — AI's worst habit is dead code
jscpd src     # copy/paste duplication — AI's second-worst habit
```

### State split: server vs. client

- **Server state → TanStack Query v5** (`@tanstack/react-query`, currently ~5.x). **There is no v6 for React** — only `@tanstack/svelte-query` has a v6 (a Svelte 5 adapter on the v5 core). Don't let an agent "upgrade" you to a React v6 that doesn't exist.
- **Client/UI state → Zustand** for anything that isn't server data.

### React Compiler & RSC

The **React Compiler** auto-memoizes and **removes most manual `useMemo`/`useCallback`** — let it, and stop hand-writing memoization. **Two real caveats:**

1. TanStack Query's referential stability is *undermined* when React Compiler is enabled (TanStack/query issue **#9571**) — the stable `data` reference it works hard to provide can be defeated.
2. Third-party APIs that rely on referential equality may still need **manual** memoization.

So: "delete your `useMemo`s" is broadly right, but verify the two cases above rather than treating it as absolute. React Server Components keep data-fetching off the client; combine with the Query split for hydration.

---

## Mechanical guardrails for agents (confidence: high)

Determinism beats prompting. Layer these so an agent gets fast, unambiguous walls:

- **`eslint-plugin-boundaries`** — encode your layering (e.g., `shared` can't import `features`) as lint rules. Types and tests never enforce the dependency graph; this does.
- **TDD Guard** (`nizos/tdd-guard`) — a real, named third-party tool: a Claude Code hook that blocks Write/Edit operations that violate red-green-refactor (implementation before a failing test, over-implementation). Supports JS/TS, Python, PHP today. Use it if you want to *force* test-first on an agent; it's opinionated, so adopt deliberately.
- **Stryker** (mutation testing) + **fast-check** (property-based testing) — line coverage *lies* for AI-written tests, which often assert nothing meaningful. Mutation score measures whether tests actually detect injected bugs; property tests find edge cases an agent's example-based tests miss.
- **Knip** + **jscpd** — dead code and duplication, the two empirically worst AI habits (see GitClear). Both are confirmed, maintained tools (`jscpd` v5 is a Rust rewrite, 24–37x faster).
- **`AGENTS.md`** — a concise, repo-root instruction file. The arXiv study (2601.20404) reports a **median ~28.6% runtime reduction and ~16.6% output-token reduction** across 10 repos / 124 PRs (agents: Codex, Claude Code). **Balance:** a separate study (arXiv **2602.11988**) found context files can *reduce* task success in some settings — so treat `AGENTS.md` as net-positive-but-contested, keep it short, and measure rather than assume.

---

## TypeScript / React / Storybook specifics

- **TypeScript:** Don't rely on the bundler for type safety — `tsc --noEmit` is the only whole-program check. Make `noUncheckedIndexedAccess` non-negotiable for agent work. Derive types from Zod schemas (`z.infer`) so there's one source of truth, not two.
- **React:** Let the React Compiler own memoization (minus the TanStack Query #9571 and referential-equality caveats). Split state along server (TanStack Query v5) vs. client (Zustand) lines. Prefer RSC for data fetching. Avoid barrels so agents and tree-shaking both win.
- **Storybook:** Use the 10.3+ MCP server (React + Vite only today) to ground agents in real props. Write CSF3 stories with `play` + autodocs and run them as browser tests through `@storybook/addon-vitest` — the story *is* the visual spec, the interaction test, and the a11y check at once.

---

## Freshness (2026)

**Current (post-late-2025 model jump):**

- Storybook **10.3** MCP server + manifests (React + Vite only at launch; Vue/Angular/Svelte/Web Components planned).
- **Vitest 4.1** AI-agent-oriented `agent` reporter (auto-detects coding agents, suppresses passing-test output, prints only failures + summary); `@storybook/addon-vitest` for stories-as-browser-tests.
- **Zod v4** as package-root default (stabilized Aug 2025; `zod/v4` subpath still used by older projects).
- **React Compiler** v1.0 GA — manual memoization largely obsolete.
- `AGENTS.md` as a measured (if contested) agent-context convention.

**Now stale / corrected:**

- **"TanStack Query v6 for React"** — does not exist; React is on **v5** (~5.x). v6 is Svelte-only.
- **"Valibot is sub-1KB"** as a library size — misleading; ~5KB full, sub-1KB only per tree-shaken schema.
- **"React Compiler drops useMemo"** stated absolutely — true in most cases but defeated for TanStack Query (#9571) and referential-equality-dependent APIs.
- Treating **`AGENTS.md`'s ~28.6% runtime win** as settled — mixed evidence (arXiv 2602.11988); measure in your repo.

**Watch:** Storybook MCP expanding past React; whether React Compiler + TanStack Query stability lands a fix; Valibot vs. Zod v4 bundle/perf as both iterate. Re-check quarterly.

---

## Sources

- [Advanced TSConfig settings (WebDevSimplified)](https://blog.webdevsimplified.com/2026-04/advanced-tsconfig-settings/) — 2026-04
- [Valibot vs Zod v4 TypeScript validators (pkgpulse)](https://www.pkgpulse.com/guides/valibot-vs-zod-v4-typescript-validator-2026) — 2026
- [Storybook AI best practices](https://storybook.js.org/docs/ai/best-practices) · [Storybook MCP server overview](https://storybook.js.org/docs/ai/mcp/overview) — 2026
- [Storybook 10.3 release (MCP, a11y, workflow)](https://storybook.js.org/blog/storybook-10-3/) — 2026
- [Storybook Vitest addon (stories as tests)](https://storybook.js.org/docs/writing-tests/integrations/vitest-addon) — 2026
- [Vitest 4.1 for AI agents (InfoQ)](https://www.infoq.com/news/2026/05/vitest-4-1-ai-agents/) — 2026-05
- [Structuring a TS project for AI agents (dev.to / Alex Rogov)](https://dev.to/alexrogovjs/how-to-structure-a-typescript-project-so-ai-agents-can-navigate-it-1ach) — 2026
- [TanStack Query — referential stability lost with React Compiler (issue #9571)](https://github.com/TanStack/query/issues/9571) — 2025
- [TDD Guard (nizos/tdd-guard)](https://github.com/nizos/tdd-guard) — 2026
- [jscpd — copy/paste detector](https://jscpd.dev/) — 2026
- [AGENTS.md effectiveness (arXiv 2601.20404)](https://arxiv.org/abs/2601.20404) — 2026 (counterpoint: arXiv 2602.11988)
- [GitClear — AI assistant code quality research](https://www.gitclear.com/ai_assistant_code_quality_2025_research) — 2025
