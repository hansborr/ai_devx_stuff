# Enforcing Architecture & Coding Standards

> **TL;DR** — Coding agents will write code that *compiles, passes lint, and passes tests* while quietly violating your architecture — because `tsc`, ESLint, and your test suite do **not** know about your dependency graph or module boundaries. The fix is to make conventions **executable, not aspirational**: a machine-checkable rule that blocks a PR beats any paragraph in `AGENTS.md`. The 2026 stack is a **three-gate CI** (typecheck → lint+tests → *architecture validation*) plus an **edit-time hook** that feeds violations back into the agent's loop, with the boundaries themselves **physically encoded** as co-located vertical slices and the guardrail config files locked behind `CODEOWNERS` so agents can't loosen their own leash.

**Top actionable takeaways**

- **Add a third CI gate for architecture.** `tsc --noEmit` and `eslint + tests` are not enough; a UI module importing the DB layer type-checks fine. Make `dependency-cruiser` (or `ts-arch`/`ArchUnitTS`/`eslint-plugin-boundaries`) a **required status check**. Start with 3–5 rules on your most critical boundaries.
- **Use allow-lists, not deny-lists.** `dependency-cruiser`'s `not-in-allowed` and `eslint-plugin-boundaries`' default-disallow model state what *is* allowed and forbid everything else — far more robust against an agent inventing a new bad import than `no-restricted-imports`.
- **Make every custom ESLint rule's message a *teaching string*** with a correct inline example. The agent reads the error and regenerates compliant code on the next loop. Ban `any` (it is "AI catnip") and `@ts-ignore`.
- **Close the loop with hooks.** A Claude Code `PostToolUse` hook running `eslint --fix` + `tsc` per edit cannot be argued away by the model (unlike a plan); a `Stop` hook runs the architecture tests before the turn ends.
- **Organize as vertical slices.** One folder per feature (api/model/ui/tests) with a single public `index` makes boundaries *physical* and lets each feature fit one context window.
- **Lock the guardrails.** Put the dep-cruiser config, ESLint config, `AGENTS.md`, and arch tests under `CODEOWNERS` — otherwise agents add `eslint-disable` / `ts-ignore` / `any` to make their own PR green.

---

## 1. Why architecture needs its own gate (the core thesis)

There is a layer of correctness your existing tools cannot see. TypeScript checks *types*. ESLint checks *syntax/style patterns within a file*. Tests check *behavior*. **None of them know that `features/checkout/ui` must not reach into `core/database`.** An agent can write `import { db } from '../../core/database'` inside a React component, and `tsc` will happily type-check it, ESLint will pass, and the test suite stays green — while your dependency graph silently rots. This is the well-documented phenomenon of *AI architecture drift* (techdebt.best), and it is exactly the kind of violation that is cheap to prevent and expensive to unwind later. **Confidence: high** — corroborated across multiple independent sources.

The remedy is a dedicated **architecture validator** as a *third gate*, beyond linting and tests, run in CI as a required status check:

```
Gate 1:  tsc --noEmit                          # types
Gate 2:  eslint . && <test runner>             # lint + behavior
Gate 3:  depcruise --validate / arch tests     # dependency graph + boundaries
```

Don't try to encode your whole architecture on day one. **Start with 3–5 rules on the boundaries that hurt most**: the layer rule (UI must not import the DB), feature isolation (no cross-feature deep imports), and no circular dependencies. Grow the rule set as recurring violations reveal where the agents keep wandering.

---

## 2. The import graph: `dependency-cruiser` + `eslint-plugin-boundaries`

These two tools occupy complementary niches. Run **both**: `dependency-cruiser` is the CI-grade authority on the whole graph; `eslint-plugin-boundaries` gives **in-editor, in-loop** errors the agent sees immediately.

### `dependency-cruiser` (CI-grade, whole-graph)

Initialize and validate against your source in CI:

```bash
npx depcruise --init           # scaffolds .dependency-cruiser.js
npx depcruise --validate src   # run in CI as a required check
```

Rules are `forbidden` / `allowed` / `required`, each with `from`/`to` selectors that accept `path`/`pathNot` regex, plus first-class `circular`, `orphan`, and `reachable` checks. The key advantage over ESLint's `no-restricted-imports` is the **`not-in-allowed`** mechanism — an explicit *allow-list*:

```js
// .dependency-cruiser.js
module.exports = {
  forbidden: [
    {
      name: 'no-ui-to-database',
      severity: 'error',
      comment: 'UI must go through a service, never the DB directly.',
      from: { path: '^src/features/[^/]+/ui' },
      to:   { path: '^src/core/database' },
    },
    {
      name: 'feature-isolation',
      severity: 'error',
      comment: 'A feature may only import itself, shared, or core.',
      from: { path: '^src/features/([^/]+)/' },
      to:   { pathNot: ['^src/features/$1/', '^src/shared/', '^src/core/'] },
    },
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    { name: 'no-orphans',  severity: 'warn',  from: { orphan: true }, to: {} },
  ],
};
```

### `eslint-plugin-boundaries` (fast, in-loop)

Tag folders as architectural *elements* (`type` + `pattern`), then enforce dependencies with a **default of `disallow` plus an explicit `allow` list**. Note the rule names: `boundaries/element-types` governs which *element types* may depend on which; the README's default-disallow-plus-allow example is specifically the `boundaries/dependencies` rule. Use whichever matches your model — both follow the same default-disallow philosophy:

```js
// eslint.config.js (flat)
import boundaries from 'eslint-plugin-boundaries';

export default [{
  plugins: { boundaries },
  settings: {
    'boundaries/elements': [
      { type: 'feature', pattern: 'src/features/*' },
      { type: 'shared',  pattern: 'src/shared/*' },
      { type: 'core',    pattern: 'src/core/*' },
    ],
  },
  rules: {
    'boundaries/element-types': ['error', {
      default: 'disallow',
      rules: [
        { from: ['feature'], allow: ['shared', 'core'] },
        { from: ['shared'],  allow: ['core'] },
      ],
    }],
  },
}];
```

**Confidence: high** on both tools' capabilities. The only nuance: reference the boundaries rule by its actual documented name for your config (`element-types` vs `dependencies`) rather than assuming one API covers both.

---

## 3. ArchUnit-style tests + custom ESLint rules that teach

### Architecture as unit tests

Two libraries bring ArchUnit-style assertions to TS — **and they are genuinely different tools with different APIs**; do not treat them as interchangeable:

| | **ts-arch (TSArch)** | **ArchUnitTS** |
|---|---|---|
| Test framework | Any framework (`check()` for non-Jest) | Jest out of the box; Vitest needs `globals: true` |
| Cycle API | `beFreeOfCycles()` | `should().haveNoCycles()` |
| Diagram validation | **Yes** — `.adhereToDiagramInFile()` against a PlantUML diagram | No |
| Code-metrics gates | No (per ArchUnitTS's own comparison) | **Yes** — `metrics().count().linesOfCode().shouldBeBelow(1000)` |
| Assertion | `toMatchSnapshot`-style via test runner | `await expect(rule).toPassAsync()` |

ArchUnitTS (verified API) for a boundary + cycle + LOC ceiling:

```ts
import { projectFiles, metrics } from 'arch-unit-ts'; // ArchUnitTS

test('ui does not depend on database', async () => {
  const rule = projectFiles().inFolder('src/**/ui/**')
    .shouldNot().dependOnFiles().inFolder('src/core/database/**');
  await expect(rule).toPassAsync();
});

test('no cycles', async () => {
  await expect(projectFiles().inFolder('src/**').should().haveNoCycles()).toPassAsync();
});

test('files stay small', async () => {
  await expect(metrics().count().linesOfCode().shouldBeBelow(1000)).toPassAsync();
});
```

If you want a *diagram as the spec*, that's a **ts-arch** feature (`.adhereToDiagramInFile()` against a PlantUML file). Attribute the **LOC-ceiling/metrics gates to ArchUnitTS**, and **PlantUML validation to ts-arch**.

A **per-file LOC ceiling (400–1000 lines)** is worth adding regardless of tool — it pressures agents toward decomposition and keeps each file inside a sane review/context budget.

### Custom ESLint rules whose messages teach the LLM

This is the highest-leverage idea in the section (Factory.ai). For **every recurring agent mistake**, write a custom ESLint rule with **autofix where possible** and a **`message` that is a teaching string with the correct example inline**. Because the agent reads the lint output on its next loop, the message *re-prompts* the model toward compliant code for free — no token spend on your part, no human in the loop:

```js
{
  meta: { messages: {
    useTokens:
      'Do not hard-code colors. Use a design token:\n' +
      '  bad:  color: "#3B82F6"\n' +
      '  good: color: theme.colors.primary',
  }},
}
```

Then make the universal AI-footguns hard errors: `@typescript-eslint/no-explicit-any: error` (any is AI catnip — the model reaches for it the instant types get hard) and `@typescript-eslint/ban-ts-comment: error` (kills `@ts-ignore`/`@ts-expect-error` escape hatches). See [Linting for AI](09-linting-for-ai.md) for the full lint stack.

---

## 4. Close the loop: hooks, generators, and schema contracts

### Hooks run *outside* the model and can't be argued away

A plan-mode instruction is advisory; the model can rationalize past it. A **hook is deterministic** — it runs whether or not the model "agrees." The pattern (morphllm, and see [Custom Hooks](12-custom-hooks.md)):

- **`PostToolUse` on `Edit|Write`** → run `eslint --fix` + `tsc --noEmit` on the touched file; on failure, exit non-zero so the error text is fed back into the agent's context and it self-corrects on the next step.
- **`Stop` hook** → run the architecture tests (`depcruise --validate` / arch unit tests) before the turn ends, so a violation can't slip through to a "done" state.

### Lock patterns by construction

The most robust enforcement is when the wrong thing is *impossible to express*:

- **Generators.** Provide an agent-invokable scaffold (`npm run gen:feature <name>`) that stamps a feature from a template — api, model, ui, tests, a single `index`. Document it in `AGENTS.md` so the agent reaches for it instead of hand-rolling layout.
- **Spec Kit constitutions** (GitHub Spec Kit) encode coverage/security/perf expectations *once* so they apply to every generated feature.
- **Schema-first contracts.** Keep **one schema per boundary** as the contract. Two coherent directions — pick one, don't mix them:
  - **OpenAPI-first (matches Hey API `openapi-ts`):** OpenAPI spec is the **single source of truth**; generate Zod validators + TS types *from* it in CI and **fail the build on stale artifacts**. The agent literally cannot introduce a type that disagrees with the contract, because the types are generated, not authored.
  - **Zod-first:** if Zod is your source of truth, *derive* OpenAPI from it with a Zod→OpenAPI generator (e.g. `@asteasolutions/zod-to-openapi`) — **not** Hey API, which generates the other direction.

  > Caveat (corrected): Hey API `openapi-ts` generates Zod **from** OpenAPI. It is *not* a "Zod-as-source-of-truth" tool, and you cannot both call Zod the source of truth and "generate it from OpenAPI." Choose the direction that matches your tooling.

---

## 5. Make boundaries physical: vertical slices

"The codebase is the prompt." If your architecture only lives in a diagram, agents won't honor it; if it lives in the **folder structure**, they will, because the structure *is* the context they read. Co-locate everything a feature needs:

```
src/features/
  checkout/
    api.ts          # the slice's own endpoints
    model.ts        # logic + types
    ui.tsx
    checkout.test.ts
    checkout.stories.tsx
    index.ts        # the ONLY public surface of the slice
  cart/
    ...
src/shared/         # cross-cutting, growth-capped
src/core/           # database, config, framework wiring
```

This gives agents **context isolation** — a feature fits in one context window, and the agent pays a token cost per file read, so co-location is *cheaper* as well as cleaner. Enforce it with the dep-cruiser feature-isolation rule above: imports may target the slice's own folder, `shared`, or `core`, and **nothing else** — and forbid deep imports that bypass a slice's `index`. **Litmus test (Miller):** if you can't describe a feature's boundary in one paragraph, it isn't cleanly refactorable yet. Watch `shared/` like a hawk — it is where the "junk drawer" forms; cap its growth. More in [Codebase Structure for Agents](03-codebase-structure-for-agents.md).

---

## 6. Repo-level gates and governance

Deterministic gates only matter if they're **required** and the agent can't disable them.

- **Required status checks** via branch protection: `arch`, `lint`, `typecheck`, `tests` must all be green to merge. Agent PRs are everywhere now (GitHub) — treat them as PRs from a fast, confident, unsupervised junior.
- **`CODEOWNERS` on the guardrail files** — `.dependency-cruiser.js`, ESLint config, `AGENTS.md`, the arch tests, `tsconfig.json`. This is the single most-overlooked control: agents, when blocked, will try to *loosen their own guardrails* by adding `eslint-disable`, `// @ts-ignore`, `any`, or editing the rules. Requiring a human owner's review on those files shuts that down.
- **ADR-as-code.** `archgate` pairs each Architecture Decision Record with a companion `rules.ts`, run by `archgate check` — so decisions don't decay into prose nobody enforces.
- **Independent gates agents can't influence:** a separate SAST + secret-scanning step, and **mutation testing** to catch the assertion-free tests agents love to write (see [Preventing AI Slop](08-preventing-ai-slop.md)).
- **Route agent PRs by risk tier** — auto-merge low-risk after green checks; require human review on security-critical paths. Never give agents a fast-path that bypasses review on sensitive files.

**Debate — `AGENTS.md`'s real value (confidence: medium).** The emerging de-facto standard helps, but keep it *lean*: it should hold only the rules a machine *can't* enforce. One controlled study (arXiv 2601.20404, Lulla et al.) found a hand-curated `AGENTS.md` cut runtime ~29% (28.64%) and tokens ~17% (16.58%) — but a second paper (arXiv 2602.11988, *Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?*, Gloaguen et al.) reached more skeptical results, finding that LLM-generated context files tended to *reduce* task success rates versus no context while raising inference cost by over 20%, so the evidence is early and partially contradictory. **Reconciliation:** a tight developer-authored file helps; a bloated auto-generated one can hurt. **Never restate a linter-enforced rule in `AGENTS.md`** — duplicating an enforced rule just burns context budget. See [Agent Guidance & Context](10-agent-guidance-and-context.md).

---

## TypeScript / React / Storybook specifics

- **Crank TS strictness as the cheap first gate.** Set `"strict": true` in `tsconfig` and adopt **typescript-eslint `strict-type-checked`**. Note: the much-cited **`no-floating-promises`** is enabled by the **`recommended-type-checked`** config (not exclusively `strict-type-checked`) — both inherit it, so either tier gives you that rule; `strict-type-checked` adds more. Don't conflate "the rule that catches unhandled promises" with one specific tier.
- **Knip for dead code** (`npx knip`) — agents leave orphaned exports, unused deps, and dead files behind; Knip is the architectural broom. Wire it into CI.
- **React + Storybook.** Build through **Storybook + its MCP server** so agents reuse your *real* components instead of inventing props. Caveat (freshness): the Storybook MCP integration is an **official but preview, React-only feature requiring Storybook 10.3+** — promising, not yet battle-hardened. Details in [TS+React+Storybook](13-typescript-react-storybook.md) and [UI Design Systems Enforcement](07-ui-design-systems-enforcement.md).
- **One Zod schema per boundary** for runtime validation at the edges; generate from your OpenAPI contract in CI and fail on stale artifacts (section 4).

---

## Freshness (2026)

- **Current and load-bearing:** the three-gate model; `dependency-cruiser` + `eslint-plugin-boundaries`; ArchUnitTS metrics gates; Claude Code `PostToolUse`/`Stop` hooks; `CODEOWNERS`-locked guardrails; `archgate` ADR-as-code; Knip. All verified against primary sources in 2026.
- **New / still settling:** the **Storybook MCP** integration (preview, React-only, 10.3+); `AGENTS.md` as a standard (early, with at least one study showing it can backfire); `archgate` and the broader "ADR-as-code" pattern (young).
- **Watch for direction confusion:** schema codegen tooling is split between OpenAPI-first (Hey API) and Zod-first (zod-to-openapi). The post-late-2025 model jump made agents *more* willing to silently route around boundaries when blocked — which is exactly why the **`CODEOWNERS`-on-config** control and **deterministic hooks** matter more now than they did a year ago. Prose guidance has *not* gotten more reliable; executable rules have only gotten more necessary.

---

## Sources

- [AI Architecture Drift — techdebt.best](https://techdebt.best/ai-architecture-drift/) (2026)
- [Enforcing architecture in an agent-driven codebase — Phoebe](https://www.phoebe.work/blog/enforcing-architecture-in-an-agent-driven-codebase) (2026)
- [dependency-cruiser rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) (2026)
- [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) (2026)
- [ts-arch (TSArch)](https://github.com/ts-arch/ts-arch/blob/main/README.md) (2026)
- [ArchUnitTS](https://github.com/LukasNiessen/ArchUnitTS) (2026)
- [Using linters to direct agents — Factory.ai](https://factory.ai/news/using-linters-to-direct-agents) (2025)
- [Claude Code Hooks — morphllm](https://www.morphllm.com/claude-code-hooks) (2026)
- [GitHub Spec Kit](https://github.com/github/spec-kit) (2026)
- [Schema-first Zod from OpenAPI — Hey API openapi-ts](https://heyapi.dev/openapi-ts/plugins/zod) (2026)
- [The codebase is the prompt: vertical slices — Jeremy Miller](https://jeremydmiller.com/2026/06/04/the-codebase-is-the-prompt-wolverine-vertical-slices-and-ai-assisted-development/) (2026)
- [Your codebase is the new prompt — Guibes](https://guibesdev.medium.com/your-codebase-is-the-new-prompt-architecture-for-the-ai-era-8ad33d319489) (2026)
- [Agent PRs are everywhere — GitHub Blog](https://github.blog/ai-and-ml/generative-ai/agent-pull-requests-are-everywhere-heres-how-to-review-them/) (2026)
- [archgate CLI (ADR-as-code)](https://github.com/archgate/cli) (2026)
- [AGENTS.md controlled study — arXiv 2601.20404](https://arxiv.org/abs/2601.20404) (2026)
- [typescript-eslint: no-floating-promises](https://typescript-eslint.io/rules/no-floating-promises/) (2026)
- [Knip — dead code/exports/deps](https://knip.dev/) (2026)
- [Storybook MCP for React](https://storybook.js.org/blog/storybook-mcp-for-react/) (2026)

*Cross-references: [Overview](00-overview.md) · [Codebase Structure for Agents](03-codebase-structure-for-agents.md) · [Static Analysis & CI/CD Gates](04-static-analysis-and-ci-cd-gates.md) · [UI Design Systems Enforcement](07-ui-design-systems-enforcement.md) · [Preventing AI Slop](08-preventing-ai-slop.md) · [Linting for AI](09-linting-for-ai.md) · [Agent Guidance & Context](10-agent-guidance-and-context.md) · [Custom Hooks](12-custom-hooks.md) · [TS + React + Storybook](13-typescript-react-storybook.md)*
