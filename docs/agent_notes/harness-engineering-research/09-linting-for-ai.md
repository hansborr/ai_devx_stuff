# Linting Setups & AI-Targeted Lint Tooling

> **TL;DR** — A deterministic linter is the highest-leverage guardrail you can put around a coding agent, because a non-zero exit code is a *contract* while a paragraph in `AGENTS.md` is only a *suggestion*. The agent-tooling consensus (Factory.ai, Montes) is that **the linter beats the prompt**: encode your house rules as autofixable rules on the agent's hot path and the model self-corrects without spending your tokens or your attention. The practical 2026 stack is **ESLint 9 flat config + typescript-eslint `strictTypeChecked` + Prettier** as the authoritative gate, a **fast accelerator** (oxlint or Biome v2) for sub-second feedback, **Knip** for dead code, and a thin layer of **AI-specific plugins** plus an **edit-time hook** that feeds lint errors back into the loop. The thesis is well-argued but is advocacy, not a measured fact — treat it as a strong prior, not gospel.

**Top actionable takeaways**

- **Gate `eslint` in CI** with `strictTypeChecked` + `stylisticTypeChecked` and `projectService: true`; keep the four type-aware rules below at `error` (`no-floating-promises`, `no-misused-promises`, `no-unnecessary-condition`, `no-explicit-any`).
- **Add Prettier (or Biome formatter)** so style is settled deterministically and never argued in review.
- **Add a fast accelerator** — `oxlint` or `biome lint` — for the agent's inner loop; keep ESLint type-aware as the merge gate (the accelerators don't replace it yet).
- **Run `knip` in CI** to catch orphaned files, unused exports, and unlisted/unused deps — the dead code agents leave behind.
- **Wire a `PostToolUse` `eslint --fix` hook** that surfaces remaining errors to the agent via `stderr` for self-correction (it does *not* block the edit — see caveat).
- **LLM-draft your own custom rules** with autofix + a teaching error message, and put them on the hot path. This is the single biggest differentiator.
- **Trial AI-specific plugins** (`eslint-for-ai`, `eslint-plugin-ai-guardrails`) and config linters (`agnix`, `agentlint`) — but treat them as supplements, not the gate.

See also: [Overview](00-overview.md) · [Codebase Structure for Agents](03-codebase-structure-for-agents.md) · [Static Analysis & CI/CD Gates](04-static-analysis-and-ci-cd-gates.md) · [Preventing AI Slop](08-preventing-ai-slop.md) · [Custom Hooks](12-custom-hooks.md) · [TypeScript + React + Storybook](13-typescript-react-storybook.md)

---

## Why the linter is the load-bearing guardrail

An agent reads error messages far better than it reads instructions. A rule that fires `error: Floating promise — await it or void it explicitly` at the exact line of the defect, every time, is a deterministic, line-localized, retry-able signal. The same idea in `AGENTS.md` ("always handle promises") is probabilistic context the model may or may not weight. This is the core argument from Factory.ai's *Using Linters to Direct Agents* and Montes' *Lint Against the Machine*: **move intent from the prompt into the rule set**, give each rule an autofix and a teaching message, and the agent converges without human intervention.

> **Confidence / framing.** "The linter beats the prompt" is the emerging *thesis* among agent-tooling vendors, not an empirically measured result. It is well-supported by the cited arguments and matches practitioner experience, but the strongest evidence (Snyk/Apiiro defect stats in the Montes piece) measures *AI defect rates*, not the linter's marginal lift specifically. Adopt it as a strong working prior.

The corollary that drives the whole setup: **a linter only steers if its output reaches the agent on the hot path.** A rule that fires in a CI run 8 minutes later, or in an editor squiggle the headless agent never sees, does not change behavior. Get the feedback into the edit loop (hook) and the PR loop (CI gate).

---

## The authoritative gate: ESLint 9 + typescript-eslint

ESLint 9 flat config with `typescript-eslint` remains the gate of record in 2026 because it is the only widely-deployed linter with mature, battle-tested **type-aware** rules. Start from the shared configs and turn the strictest ones on.

```js
// eslint.config.js  (ESLint 9 flat config)
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  // strictTypeChecked = recommended + strict + the type-aware rules
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,        // auto-discovers tsconfig; replaces `project: ./tsconfig.json`
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The four high-signal anti-AI-defect rules — keep at error:
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error', // catches dead `if (x)` on non-nullable x
      '@typescript-eslint/no-explicit-any': 'error',

      // House conventions agents drift on:
      '@typescript-eslint/naming-convention': ['error', /* your scheme */],
      'import/order': ['error', { 'newlines-between': 'always', alphabetize: { order: 'asc' } }],
    },
  },
);
```

Why these four rules earn their place against AI output specifically:

- **`no-floating-promises`** — agents routinely drop `await`/`void`, producing silently swallowed async work and untestable races. Highest-ROI single rule.
- **`no-misused-promises`** — catches `if (asyncFn())` and async callbacks passed where void is expected (a classic LLM mistake in event handlers).
- **`no-unnecessary-condition`** — flags defensive null checks on values the types prove are non-nullable. This is a direct **slop signature** (see [Preventing AI Slop](08-preventing-ai-slop.md)) and a great rule to keep on.
- **`no-explicit-any`** — `any` is how agents paper over type errors instead of fixing them. Banning it forces real types.

**Cost note:** `strictTypeChecked` + `projectService` runs the TypeScript program, so lint time tracks `tsc`. That is exactly why you pair it with a fast accelerator below rather than running the full type-aware suite on every keystroke.

Add **Prettier** (or the Biome formatter) so formatting is settled by a tool, not a reviewer. Disable stylistic ESLint rules that fight the formatter, or use `eslint-config-prettier`.

---

## The fast accelerator: oxlint / Biome v2

The 2026 development is that **type-aware linting no longer strictly requires running `tsc`**. Both fast linters now ship type-aware rules backed by a Go/Rust type engine:

- **Biome v2 ("Biotype")** — adds type-aware rules *without* a full TypeScript compiler dependency, plus a formatter. Single fast binary.
- **oxlint** — its `tsgolint` integration brings type-aware rules (oxlint's core is Rust; the type-aware engine, `tsgolint`, is a Go binary built on `typescript-go`).

Use them as the agent's **inner-loop accelerator** (and editor/pre-commit), while keeping **ESLint type-aware as the authoritative CI gate**:

```bash
oxlint                 # sub-second; runs on every edit / pre-commit
eslint . --max-warnings 0   # the gate; runs in CI and blocks merge
```

> **Trade-off (confidence: medium).** Biome/oxlint type-aware coverage is real but **not yet a superset of typescript-eslint's** — some rules and edge cases only exist in ESLint. Treat the fast linters as *acceleration*, not *replacement*, until parity is demonstrated for your rule set. Running both means maintaining two configs; the payoff is fast feedback plus a strict gate.

Run **Knip** in CI to catch what linters miss — orphaned files, unused exports, and unlisted/unused dependencies. Agents are prolific producers of dead helpers and ghost files:

```bash
knip --strict   # fails on unused files, exports, deps, and missing deps
```

---

## Custom rules: the real differentiator

Generic plugins encode *generic* intent. Your architecture rules ("repository layer never imports from `controllers/`", "no `fetch` outside `lib/api`", "use our `Money` type, not `number`, for currency") are where agents drift most — and where a custom rule pays for itself on every future edit.

**The factory workflow (from Factory.ai), now cheap because an LLM writes the rule:**

1. **Describe the anti-pattern** to the model and have it draft an ESLint rule — including an **autofix**, a **test fixture**, and a **teaching error message** ("Import `Money` from `@/lib/money`; raw `number` for currency loses precision").
2. **Review and add tests** (RuleTester). The autofix and message matter as much as the detection — they are what let the agent self-correct.
3. **Put it on the hot path** — error severity, in the agent's edit-time lint, not buried in a nightly job.

A teaching message turns one violation into a permanent lesson the agent re-reads on every run. That is leverage `AGENTS.md` cannot match, because the rule fires *exactly* when and where it is relevant.

---

## Feeding lint errors back into the agent loop (the hook)

The mechanism that closes the loop is an **edit-time hook** that runs the linter on the just-edited file and surfaces results to the agent:

```jsonc
// .claude/settings.json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Edit|Write|MultiEdit",
      "hooks": [{
        "type": "command",
        "command": "f=\"$(jq -r '.tool_input.file_path')\"; eslint --fix \"$f\" 2>&1 1>/dev/null || { eslint \"$f\" >&2; exit 2; }"
      }]
    }]
  }
}
```

> **Important caveat (fact-check, severity: medium).** A `PostToolUse` hook runs **after** the edit has already been written. Exiting with code `2` there sends `stderr` back to the agent so it can self-correct on the next turn — but it does **not** block or revert the edit; the file change is already in place. Hard *blocking* (reverting before the change lands) is **`PreToolUse`** behavior, not `PostToolUse`. So the pattern is correct for **"autofix + surface remaining errors for self-correction,"** which is what you want for lint; just don't describe `PostToolUse` exit 2 as a gate. For a true block, use `PreToolUse` or a `Stop`-hook gate. See [Custom Hooks](12-custom-hooks.md) for the full mechanics (block-and-feedback, `stop_hook_active`, deny-guards).

This is the difference between a linter the agent *sees* and one it doesn't. The `--fix` pass handles the mechanical violations for free; the remaining `error`-level findings go back into context as actionable feedback.

---

## AI-specific lint tooling (supplements, not the gate)

A small ecosystem of plugins targets *AI* anti-patterns specifically. Cherry-pick; don't adopt wholesale.

- **`eslint-for-ai`** (eli0shin) — rules aimed at LLM-authored code patterns.
- **`eslint-plugin-ai-guardrails`** (isaacnewton123) — structure-first checks: god files/functions, orphan `TODO`s, obvious/redundant comments. Supports ESLint v8 and v9.
- **`eslint-plugin-llm-core`** — additional LLM-oriented rules.
- **`agnix`** (agent-sh) — *lints your agent config files themselves* (`AGENTS.md`, rules files, MCP config) for the anti-patterns that make agents worse.
- **`agentlint`** (mauhpr/agentlint) — a guardrail layer (the repo cites ~**68–77 rules across 8 packs**; its per-pack breakdown sums to 77) wired into Claude Code hooks to block dangerous actions (secret commits, force-pushes, destructive commands). *Note:* multiple distinct "AgentLint" projects exist (`mauhpr/agentlint`, `samilozturk/agentlint`, `0xmariowu/AgentLint`, others) with different rule counts; verify which one you mean and pin a version.

**De-slop tooling** (covered in depth in [Preventing AI Slop](08-preventing-ai-slop.md), not duplicated here): `dabit3/deslop` is a **low-traction CLI git-diff scanner** (≈9 stars, single commit — *not* a popular Claude Code skill; the widely-used de-slop *skills* are separate projects), and `peakoss/anti-slop` is a heuristic PR-check set. Use them as supplementary CI detectors, not as your primary lint gate.

> **What linting cannot do (confidence: high).** Linters catch *local* defects and convention drift. They do **not** catch architecture decay, intent drift, or "this is the wrong abstraction." Those need review, tests, and structure (see [Codebase Structure for Agents](03-codebase-structure-for-agents.md)). Don't let a green lint run substitute for comprehension.

---

## TypeScript / React / Storybook specifics

- **React** — add `eslint-plugin-react-hooks` at `recommended` (or the `recommended-latest` flat config). The rules-of-hooks and exhaustive-deps checks catch the dependency-array and conditional-hook mistakes agents make constantly. Pair with `@typescript-eslint`'s type-aware rules above.
- **Storybook** — use the **flat `recommended`** config from `eslint-plugin-storybook`. It enforces story structure (`Meta`/`StoryObj` typing, correct `args`/`play` usage) so agent-generated stories stay consistent and renderable. Colocate `*.stories.tsx` with the component.
- **Kill barrel files.** `index.ts` re-export barrels confuse agents (they import the barrel and pull the world), slow type-aware linting, and create circular-dependency traps. Prefer direct imports; enforce with an `import/no-cycle` rule and/or a custom rule banning new barrels. (confidence: medium — barrels have legit uses for public package APIs; the ban is most valuable for internal app code.)
- **Colocate tests and stories** next to source (`Button.tsx`, `Button.test.tsx`, `Button.stories.tsx`). This makes `vitest related` / `jest --findRelatedTests` in your hooks fast and keeps the agent's mental model local.

Example layout:

```
src/components/Button/
  Button.tsx
  Button.test.tsx
  Button.stories.tsx
  index.ts        # ← only if Button is a public API; otherwise delete it
```

- **Keep `AGENTS.md` thin (nuanced — confidence: medium).** The ETH Zurich study (Gloaguen, Mündler et al., Feb 2026) found that **LLM-generated** context files *hurt* (≈ −3% task success, ≈ +20% cost), while **developer-written** files helped only modestly (≈ +4% success) and **still raised cost ≈ +19%**. The honest takeaway is *not* "thinner is strictly better" — it's that auto-generated bloat is actively harmful and even good context isn't free. Move enforceable rules **out** of prose and **into** the linter, where they cost nothing per token and fire deterministically.

---

## Freshness (2026)

**Current / new since the late-2025 model jump:**

- **ESLint flat config (`eslint.config.js`)** is the default; `.eslintrc` is legacy. typescript-eslint **`projectService: true`** has replaced manual `project` globs.
- **Type-aware linting without `tsc`** — Biome v2 "Biotype" and oxlint's `tsgolint` are the genuinely new capability. Worth adopting as an accelerator now.
- **Agent-config linters** (`agnix`) and **hook-wired guardrails** (`agentlint`) are a 2025–2026 category that didn't exist before.
- **Lint-in-the-loop via `PostToolUse` hooks** is the current best practice for getting lint signal to the agent at edit time.

**Now stale / avoid:**

- `.eslintrc.*` + `extends` arrays, and `eslint-plugin-import`-only setups without type-awareness.
- TSLint (long dead) and any "run the linter only in CI" posture — that leaves the agent loop blind.
- Treating Biome/oxlint as a **drop-in replacement** for typescript-eslint's full type-aware rule set — not there yet (mid-2026).
- Hard-coding **any** `agentlint` rule count or treating `dabit3/deslop` as a popular skill. The `mauhpr/agentlint` repo's own materials currently cite both ~68 and ~77 (the per-pack breakdown sums to 77), and the figure churns release to release; `deslop` is a low-traction CLI (~9 stars, single commit), not a popular skill. Pin versions and verify.

---

## Sources

- [Using Linters to Direct Agents — Factory.ai](https://factory.ai/news/using-linters-to-direct-agents) (2026) — the factory-rule workflow; high credibility (vendor).
- [Lint Against the Machine — Montes](https://medium.com/@montes.makes/lint-against-the-machine-a-field-guide-to-catching-ai-coding-agent-anti-patterns-3c4ef7baeb9e) (2026-03) — rule recommendations + Snyk/Apiiro AI-defect stats.
- [typescript-eslint Shared Configs](https://typescript-eslint.io/users/configs/) (2026) — `strictTypeChecked`, `stylisticTypeChecked`, `projectService`; official.
- [Biome v2 ("Biotype")](https://biomejs.dev/blog/biome-v2/) (2025) — type-aware rules without `tsc`; official release (June 2025).
- [Knip](https://knip.dev/) (2026) — orphaned files, unused exports/deps; official docs.
- [eslint-for-ai](https://github.com/eli0shin/eslint-for-ai) (2026) — AI-pattern rules.
- [eslint-plugin-ai-guardrails](https://github.com/isaacnewton123/eslint-plugin-ai-guardrails) (2026) — structure-first checks (god files, orphan TODOs, obvious comments).
- [agentlint (mauhpr)](https://github.com/mauhpr/agentlint) (2026) — ~68–77 rules / 8 packs, Claude Code hooks. (Disambiguate from other "AgentLint" projects.)
- [agnix](https://github.com/agent-sh/agnix) (2026) — lints agent config files.
- [dabit3/deslop](https://github.com/dabit3/deslop) (2026) — CLI git-diff slop scanner (low-traction; see [Preventing AI Slop](08-preventing-ai-slop.md)).
- [Most AI Agent Rules Files Are Making Your Agent Worse — Efimenko (dev.to)](https://dev.to/alexefimenko/i-analyzed-a-lot-of-ai-agent-rules-files-most-are-making-your-agent-worse-2fl) (2026) — commentary on the ETH Zurich study; **cite the primary paper** (Gloaguen, Mündler et al., arXiv, Feb 2026) for the success/cost figures.
