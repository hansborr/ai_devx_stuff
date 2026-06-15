# Static Analysis & CI/CD Gates for AI-Generated Code

> **TL;DR** — For AI-generated code in 2026, static analysis and CI gates are no longer a "nice-to-have"; they are the **primary control surface**, because agents emit code faster than humans can review it and measurably degrade maintainability (GitClear: ~8x more duplicated blocks in 2024, refactoring's share of changes collapsed from ~24% to ~9.5%). The winning pattern is **deterministic enforcement over probabilistic prompting**: a linter/typechecker/validator that *blocks* a PR beats "please follow our standards" in `AGENTS.md`, and the same gate that blocks a human is the fast feedback signal an agent uses to self-correct. Build the stack in **layers, fastest-first**, so agents get sub-second-to-sub-minute signal — and never give agents a fast-path that bypasses human review on security-critical files.

**Top actionable takeaways**

- **Turn on TypeScript's strictest flags** (`strict` + `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`). Free, deterministic, zero-maintenance.
- **Make `tsc --noEmit` a dedicated required check.** The bundler's transpile-only build does *not* typecheck.
- **Mutation testing (Stryker) is the real coverage gate.** Line coverage lies for AI tests; mutation score measures whether tests detect bugs.
- **Enforce architecture as code** with `dependency-cruiser` + `eslint-plugin-boundaries`. Types and tests never enforce the dependency graph.
- **Gate dead code (knip) and duplication (jscpd)** — they target AI's two empirically worst habits.
- **Wire deterministic lint/typecheck into the agent loop** via Claude Code `PostToolUse` hooks, then re-enforce in CI with `--max-warnings 0`.
- **Defend the supply chain against slopsquatting**: lockfile discipline + SCA + human review on new dependencies.
- **Separation of duties**: agents must not approve/merge their own output (OWASP AISVS AC.4.1 / AC.8.1).

See also: [Overview](00-overview.md) · [Linting for AI](09-linting-for-ai.md) · [Agent Loop & Hooks](12-custom-hooks.md) · [Supply-Chain Security](14-security-and-supply-chain.md)

---

## Why gates, not prompts

Two empirical facts drive the whole design:

1. **AI code degrades maintainability in measurable ways.** GitClear's 2025 research reports ~8x more duplicated blocks in 2024 and refactoring's share of changes collapsing from ~24% to ~9.5%; cloned blocks correlate with 15–50% more defects. The arXiv paper *"Debt Behind the AI Boom"* (2603.28592) finds **24.2% of AI-introduced issues still survive at the latest repo revision**.
2. **Output outpaces review.** A guideline in `AGENTS.md` is a *probabilistic* suggestion the model may ignore; a gate that returns a non-zero exit code is a *deterministic* contract. As the Codex and Claude Code docs both put it, once agents iterate unsupervised, linters and typecheckers "stop being optional — they become the contract that lets the agent iterate."

The corollary: **the same gate serves two masters.** It blocks a bad human PR *and* gives the agent a precise, machine-readable error to self-correct against. Build for fast feedback.

## The layered gate stack (fastest-first)

| Layer | Latency budget | What runs | Why here |
|---|---|---|---|
| **1. Editor / `PostToolUse` hook** | sub-second–seconds | format + `eslint --fix` + `tsc --noEmit` on the edited file, related tests | Agent fixes defects at generation time, before review |
| **2. Pre-commit hook** | seconds | lint, format, **secret scan**, fast typecheck | Last local gate before history |
| **3. CI required checks** | 1–10 min | full `tsc --noEmit`, ESLint `--max-warnings 0`, build, unit/component tests + changed-line coverage, `knip`, `dependency-cruiser`, `jscpd`, CodeQL/SAST, SCA + lockfile | The merge contract |
| **4. Periodic / nightly** | minutes–hours | **mutation testing (Stryker)**, full E2E | Too slow per-PR; run on schedule / critical paths |

The latency ordering is the point: an agent that gets a typecheck error in-editor self-corrects in the same turn; an agent that learns about it 8 minutes later in CI burns a loop.

## TypeScript: strictest flags as free guardrails

`strict: true` is the umbrella (`noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, …), but it deliberately **excludes** the flags that catch the exact mistakes agents make. Turn them on explicitly.

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,      // arr[i] is T | undefined — forces the missing-case
    "exactOptionalPropertyTypes": true,    // `?` ≠ "can be explicit undefined"
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "verbatimModuleSyntax": true,          // predictable module emit
    "isolatedModules": true
  }
}
```

**`noUncheckedIndexedAccess` is the single most impactful flag for AI code** because agents routinely index arrays/maps without bounds checks. It turns `const x = arr[i]; x.foo()` into a compile error until the agent handles `x === undefined`.

> **Legacy-codebase note:** enable `noUncheckedIndexedAccess` *last* — it produces the most new errors — and ratchet per-directory. Consensus across 2026 guides: "It's 2026, there's no excuse for running without strict mode." (confidence: **high**)

TS checks *type correctness only* — not the dependency graph, not style, not behavior. Each of those needs its own layer below.

### Make `tsc --noEmit` a dedicated required check

Vite/esbuild/SWC transpile **per-file** and skip full type checking, so a build can be green while types are broken. Add a standalone job and mark it required for merge.

```jsonc
// package.json
"scripts": { "typecheck": "tsc --noEmit" }   // or "tsc -b" for project references / monorepos
```

In monorepos use incremental builds (`tsc -b --incremental`) and Nx/Turbo affected-only typechecking to stay fast. In GitHub branch protection, require `typecheck`, `lint`, `build`, and `test` checks green before merge. This is the cheapest high-signal gate and the one agents iterate against fastest — AI-generated TS frequently compiles-to-JS fine but is type-*incorrect*.

## Architecture as code: types and tests never enforce the dependency graph

Agents cause "pattern divergence, layer violations, and dependency chaos": when multiple patterns exist, the agent picks the most-recently-seen one or invents a new one, and architectural coherence "erodes one AI-generated PR at a time." This is the layer most teams miss — where AI code "works locally but nothing fits together."

**`dependency-cruiser`** declares forbidden/allowed/required import rules (allow-*lists*, not just `no-restricted-imports`' deny-only):

```js
// .dependency-cruiser.js (excerpt)
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    { name: 'no-test-in-prod', severity: 'error',
      from: { pathNot: '\\.(spec|test)\\.[jt]sx?$' },
      to:   { path: '\\.(spec|test)\\.[jt]sx?$' } },
    { name: 'presentation-not-infra', severity: 'error',
      from: { path: '^src/presentation' },
      to:   { path: '^src/infra' } },
  ],
};
```

Run `depcruise src --config .dependency-cruiser.js` as a required CI check. Pair it with **`eslint-plugin-boundaries`** so violations show as **real-time in-editor errors the agent sees immediately**:

```jsonc
// eslint config (excerpt)
"settings": {
  "boundaries/elements": [
    { "type": "domain",       "mode": "folder", "pattern": "src/*/domain/*" },
    { "type": "data",         "mode": "folder", "pattern": "src/*/data/*" },
    { "type": "infra",        "mode": "folder", "pattern": "src/*/infra/*" },
    { "type": "presentation", "mode": "folder", "pattern": "src/*/presentation/*" }
  ]
},
"rules": { "boundaries/element-types": ["error", { "default": "disallow", "rules": [
  { "from": "presentation", "allow": ["domain", "data"] },
  { "from": "data",         "allow": ["domain"] }
]}]}
```

Per-ecosystem equivalents: Java → **ArchUnit**, .NET → **NetArchTest**, Python → **import-linter**, Go → **depguard**. (confidence: **high**)

## Mutation testing: the real coverage gate

**The most-cited finding in this space:** AI agents write tests that call a function and assert it doesn't throw — a *presence-check*, not a *correctness-check*. It counts toward line coverage and verifies nothing.

In the canonical case study, a suite reporting **93% line coverage had only a ~58.6% mutation score (MSI)** — **a 34-point gap**. Targeted assertion improvements (replacing presence-checks with correctness-checks plus boundary conditions) closed it to **~93% MSI over three rounds**.

> *Precision note:* the "34" is the **size of the gap**, not a second, separate mutation score. There is one baseline (~58.6%), one gap (~34 points), one final (~93%).

Mutation testing also keeps agents **on task**: surviving mutants are a precise, machine-readable to-do list. A surviving mutant where `>` was flipped to `>=` and all tests still pass tells the agent exactly which boundary assertion to add.

```js
// stryker.conf.js — StrykerJS (works with Vitest/Jest, TS/React)
module.exports = {
  testRunner: 'vitest',
  coverageAnalysis: 'perTest',
  thresholds: { high: 80, low: 60, break: 50 },  // build fails below `break`
};
```

Because Stryker is **slow**, run it **nightly / on critical paths**, not on every PR. Tiered targets (one common scheme): critical paths ≥70% mutation score, standard features ≥50%, experimental ≥30%. (confidence: **high**)

## Coverage: gate changed lines, treat it as a floor

Per-PR **changed-lines coverage at ~80%** is the common hard gate; whole-repo percentage targets reward writing low-value tests for old code and are gameable. Coverage is **necessary-but-insufficient** — always pair with mutation testing.

```jsonc
// vitest.config — per-file thresholds stop one big file masking gaps
"coverage": { "thresholds": {
  "lines": 80, "functions": 80, "branches": 70, "perFile": true
}}
```

In CI, fail the PR if changed-line coverage < 80% (Codecov / Vitest diff coverage). (confidence: **high**)

## Dead code (knip) and duplication (jscpd)

AI's structural failure mode is **addition over reuse**. These two gates target the empirically-documented maintainability drag that lint/types/tests do *not* catch.

- **`knip`** — finds unused files/exports/dependencies (the dead scaffolding agents leave behind, plus hallucinated/unused deps). ~Zero-config auto-detection, ~150 plugins (Vite, Vitest, Next, Storybook, ESLint).
  ```bash
  npx knip --no-exit-code   # triage first
  knip                      # required CI check (non-zero exit on findings)
  ```
- **`jscpd`** — copy-paste detector with SARIF output (a Node.js CLI; v5 ships a native Rust-backed binary). Fails the build when duplication exceeds a threshold, catching the near-duplicates agents generate that ESLint/depcheck miss.
  ```bash
  jscpd ./src --threshold 5 --reporters sarif,consoleFull   # fail if >5% duplicated
  ```
  Wire the SARIF into the GitHub Security tab. (confidence: **high**)

## Pushing defects left: hooks + AI-anti-pattern lint rules

### Claude Code hooks (`PostToolUse`) in the agent loop

Hooks are shell commands at lifecycle points that enforce rules the model would otherwise ignore. A `PostToolUse` hook on `Write|Edit|MultiEdit` auto-runs the formatter/linter/typechecker on the just-edited file so the agent fixes issues *at generation time*.

> **Mechanism correction:** Claude Code hooks do **not** auto-populate a `$FILE` variable. Extract the path from the JSON event on stdin (or use `$CLAUDE_TOOL_INPUT_FILE_PATH`):

```jsonc
// .claude/settings.json (excerpt)
"hooks": { "PostToolUse": [{
  "matcher": "Write|Edit|MultiEdit",
  "hooks": [{ "type": "command",
    "command": "FILE=$(jq -r .tool_input.file_path); eslint --fix \"$FILE\"; prettier --write \"$FILE\"; tsc --noEmit; exit 0"
  }]
}]}
```

Keep hooks **fast** (they run synchronously): use `vitest related <file>` / `jest --findRelatedTests`, not the full suite. Formatting hooks should **`exit 0` even on failure** so a formatter crash never wedges the session. A `PreToolUse` hook on `Bash` can **block** unvetted `npm install` (mitigates slopsquatting). **TDD Guard** is a `PreToolUse` hook that blocks implementation edits when there's no failing test. Start with 1–2 hooks and expand.

### AI-anti-pattern ESLint rules

The "lint-for-AI" thesis: if you can describe a defect precisely, enforce it with a linter — it scales to agent-speed output where human review does not. AI code is empirically ~3x worse on readability and ~2.66x worse on formatting (CodeRabbit analysis). High-value rules:

```jsonc
{
  "@typescript-eslint/no-floating-promises": "error",   // forgotten await
  "@typescript-eslint/no-misused-promises": "error",    // async fn into array methods
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/naming-convention": "error",
  "import/order": "error",
  "react-hooks/exhaustive-deps": "error",
  "react-hooks/rules-of-hooks": "error"
}
```

Enable the `typescript-eslint` **`strict-type-checked`** config and run `eslint --max-warnings 0` in CI — **warnings agents ignore must be errors.** Specialized plugins exist (`eslint-plugin-llm-core`, ~20 rules targeting LLM mistakes). **Biome** is a fast Rust alternative for format+lint if ESLint is a bottleneck in the hook loop. (confidence: **high**)

### Cap complexity and size

```jsonc
{
  "complexity": ["error", 15],
  "sonarjs/cognitive-complexity": ["error", 15],   // better human-readability proxy
  "max-lines-per-function": ["error", { "max": 80, "skipBlankLines": true, "skipComments": true }],
  "max-depth": ["error", 4],
  "max-params": ["error", 4]
}
```

Add a `size-limit`/`bundlesize` budget per entrypoint so agents can't silently bloat the bundle. (confidence: **medium** — thresholds are conventional; tune per team.)

## Security gates

### Supply chain / slopsquatting

Agents hallucinate package names — **~20% of recommended packages were hallucinated across 16 LLMs in the USENIX 2025 study (5–38% depending on the model)**, of which ~51% were pure fabrications, ~38% conflations, ~13% typo-variants — and attackers pre-register them ("slopsquatting"). **OWASP AISVS AC.13.3** requires flagging registry-confusable/typosquatted names, packages resolving to no published version, and anomalous creation/maintainer-change timestamps.

Controls:
- Commit and require **lockfiles**; use `npm ci` / `pnpm i --frozen-lockfile` in CI.
- Run **SCA** (Snyk / Socket / OSV-Scanner / Dependabot) as a required check; **block CVSS ≥ 9.0 findings** from merge (AISVS AC.4.3) until a documented human exception.
- **Gate new-dependency additions behind human review** (a `PreToolUse` hook or a PR check on `package.json` diffs). Verify a package exists and has download history before the agent adds it.
- Add **provenance/attestations** for what you publish (`npm publish --provenance`, SLSA, Sigstore/cosign).

This is a *novel AI-specific attack class*, not generic dependency hygiene. (confidence: **high**)

### SAST + secret scanning

AI code over-produces exactly the flaws SAST catches: SQL string concatenation (vs parameterized), hardcoded secrets, missing input validation, unsafe deserialization, insecure defaults.

- **CodeQL** — default setup runs on `pull_request`. **Copilot Autofix** is GA, covers **>90% of alert *types*** in JS/TS (and Java/Python; expanded to C#, C/C++, Go, Kotlin, Swift, Ruby), remediates ~2/3 of found vulnerabilities with little/no editing, and needs no Copilot subscription. *(Note: "90% of alert types" = categories, not 90% of individual alerts.)*
- **Secret scanning** — `gitleaks detect` as a **pre-commit hook AND a required CI job** (highest-risk, easiest-to-detect, low-false-positive class).
- Block merge on any critical SAST finding. (confidence: **high**)

### Separation of duties: agents must not self-approve

Green CI is the deterministic floor and the agent's iteration target — but **necessary, not sufficient.** OWASP AISVS:

- **AC.4.1** — AI-generated code must be reviewed by a qualified human who is **not the identity that prompted the generation**.
- **AC.8.1** — autonomous agents must **not** approve/merge/deploy artifacts they generated.
- **AC.4.4** — escalate to **two-person / security sign-off** for auth, crypto, IAM, CI/CD workflow, and deployment-manifest files.

```text
GitHub branch protection (security-critical repo):
  ✓ required status checks: typecheck, lint, build, test, codeql
  ✓ ≥1 human approval + CODEOWNERS review on security-critical paths
  ✓ disable bot self-approval
  ✓ require frozen-lockfile installs
```

**Do not create a fast-path that exempts AI PRs from review.** (confidence: **high**)

## TypeScript / React / Storybook specifics

In 2026 **Storybook is a full component-testing platform** (Storybook 10.x / Vitest 4.x era). Use **`@storybook/addon-vitest`** (browser-mode; replaces the Jest test-runner):

- Runs **interaction tests** and gets **coverage natively** — no separate `addon-coverage` instrumentation, so component tests count toward the same coverage number gated above.
- **Accessibility** ships via the a11y addon but only **fails CI if you set `parameters.a11y.test = 'error'`** — the default surfaces violations as warnings/"todo". Flip it to `'error'` to make a11y a **hard gate**:

```ts
// .storybook/preview.ts  (global) — or per-story
export const parameters = { a11y: { test: 'error' } };
```

Run `vitest` (with the Storybook project) as a required check. This makes **every story a test the agent must keep green** — a strong leash on React UI agents, where the React-specific gates (`react-hooks/exhaustive-deps`, `rules-of-hooks`) plus component + a11y tests close the loop on the output agents produce most. (confidence: **high**)

## Debates & trade-offs (don't overclaim)

- **Over-strict lint wastes agent loops.** Rules that reject *valid* patterns burn agent iterations without quality gains. Enforce defects you can describe precisely; don't impose stylistic dogma.
- **Linters and types catch surface slop, not architecture or "intent drift."** ESLint/tsc enforce local correctness and style; tests enforce behavior — none enforce decoupling, module boundaries, or whether the code does what the *spec* intended. Pair them with architecture validators (`dependency-cruiser`/boundaries) **and** spec/contract review.
- **Coverage is gameable; mutation testing is the antidote** — but mutation testing is slow, so it lives in the nightly layer, not per-PR.
- **`jscpd` "Rust-powered" only since v5** — v4 and earlier are Node.js; not load-bearing, just don't over-state it.

## Freshness (2026)

- **Current:** all TSConfig flag semantics; Stryker `{high, low, break}` thresholds; Storybook `parameters.a11y.test = 'error'`; the `@storybook/addon-vitest` browser-mode + native coverage model; OWASP AISVS control IDs (AC.4.1/4.2/4.3/4.4/8.1/13.3); the USENIX 2025 slopsquatting breakdown; Copilot Autofix GA + language expansion; `knip`/`dependency-cruiser`/`jscpd` config syntax.
- **Stale / superseded:** Storybook's older **Jest test-runner** and the separate **`addon-coverage`** instrumentation (replaced by the Vitest addon); relying on a bundler's transpile-only build as a "typecheck"; treating whole-repo coverage % as a quality signal; "90% of alerts" framing for Autofix (it's 90% of *alert types*).
- **Watch:** mutation-testing-in-the-loop tooling and AISVS are evolving fastest; re-check tiered thresholds and control text quarterly.

## Sources

- [GitClear — AI Copilot Code Quality 2025 Research](https://www.gitclear.com/ai_assistant_code_quality_2025_research) (2025)
- [arXiv 2603.28592 — "Debt Behind the AI Boom"](https://arxiv.org/abs/2603.28592) (2026)
- [TypeScript — `noUncheckedIndexedAccess`](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html) · [WebDevSimplified — Advanced tsconfig (2026-04)](https://blog.webdevsimplified.com/2026-04/advanced-tsconfig-settings/) · [The strictest TypeScript config](https://whatislove.dev/articles/the-strictest-typescript-config/)
- [OpenAI Codex — best practices](https://developers.openai.com/codex/learn/best-practices) (2026)
- [dependency-cruiser — rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) · [eslint-plugin-boundaries](https://www.npmjs.com/package/eslint-plugin-boundaries) · [Enforcing architecture in an agent-driven codebase](https://www.phoebe.work/blog/enforcing-architecture-in-an-agent-driven-codebase) · [AI architecture drift](https://techdebt.best/ai-architecture-drift/) (2026)
- [DEV — "The AI reported 93.1% coverage; it was 34%"](https://dev.to/jghiringhelli/the-ai-reported-931-coverage-it-was-34-290k) · [Test Double — keep your agent on task with mutation testing](https://testdouble.com/insights/keep-your-coding-agent-on-task-with-mutation-testing) · [Mutation testing with Stryker (2026-01)](https://oneuptime.com/blog/post/2026-01-25-mutation-testing-with-stryker/view) (2026)
- [knip](https://knip.dev/) · [jscpd](https://jscpd.dev/) (2026)
- [Storybook — Vitest addon](https://storybook.js.org/docs/writing-tests/integrations/vitest-addon) · [Accessibility testing](https://storybook.js.org/docs/writing-tests/accessibility-testing) · [Test coverage](https://storybook.js.org/docs/writing-tests/test-coverage/) (2026)
- [Claude Code hooks — production CI/CD patterns](https://www.pixelmojo.io/blogs/claude-code-hooks-production-quality-ci-cd-patterns) · [Morph — Claude Code hooks](https://www.morphllm.com/claude-code-hooks) · [TDD Guard](https://github.com/nizos/tdd-guard) · [Factory.ai — linters to direct agents](https://factory.ai/news/using-linters-to-direct-agents) (2026)
- [Linters: the most under-abused tool in the AI slop era](https://fabianletsch.de/blog/linters-the-most-underabused-tool-in-the-ai-slop-era/) · [Lint against the machine](https://medium.com/@montes.makes/lint-against-the-machine-a-field-guide-to-catching-ai-coding-agent-anti-patterns-3c4ef7baeb9e) (2026)
- [OWASP AISVS — Appendix C: AI for Code Generation](https://github.com/OWASP/AISVS/blob/main/1.0/en/0x92-Appendix-C_AI_for_Code_Generation.md) (2026)
- [CSA — Slopsquatting research note (2026-04)](https://labs.cloudsecurityalliance.org/research/csa-research-note-slopsquatting-ai-supply-chain-20260419-csa/) · [Snyk — package hallucinations](https://snyk.io/articles/package-hallucinations/)
- [GitHub Docs — CodeQL code scanning](https://docs.github.com/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning-with-codeql) · [MotomTech — AI-generated code quality gates](https://www.motomtech.com/blog-post/ai-generated-code-quality-gates/)
- [Autonoma — quality gates for vibe coding](https://getautonoma.com/blog/quality-gate-vibe-coding) · [reccehq — build these gates before agents touch your codebase](https://blog.reccehq.com/before-you-let-agents-touch-your-codebase-build-these-gates) (2026)
- [SonarJS — cognitive complexity](https://github.com/SonarSource/eslint-plugin-sonarjs/blob/master/docs/rules/cognitive-complexity.md) · [ESLint — complexity](https://eslint.org/docs/latest/rules/complexity)
