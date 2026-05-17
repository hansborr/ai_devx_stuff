# Evaluating eslint-plugin-llm-core for Musi

> **Centralized backlog**: lint-related upcoming work lives in
> `docs/agent_notes/backlog/lint-hardening-cross-repo-review.md`. The two
> remaining active items from this evaluation are tracked as
> `lint-hardening/22-llm-core-rule-message-guidance.md` and
> `lint-hardening/23-llm-core-generated-lint-guidance-spike.md`. This
> document remains the authoritative provenance for the six landed leaves
> and is linked from `docs/ai-harness.md`.

Status: Six leaves landed (policy refinement, `local/no-llm-artifacts`,
core-rule companion set, `local/no-async-array-callbacks`, remaining-candidates
audit, `local/no-swallowed-errors`). Parked-rule re-audit on 2026-05-11
confirmed prior decisions — see
[`eslint-llm-parked-rules-verification.md`](./eslint-llm-parked-rules-verification.md).
Active leaves: rule-message guidance tests, generated-lint-guidance spike.
Date: 2026-05-11
Source: `/home/node/tmp/eslint-plugin-llm-core`.

## Why look at it

Musi already has a substantial AI-targeted lint surface in `eslint-rules/`
plus AI-shaped config in `eslint.config.js`. The external plugin solves the
same problem with a different style — generic "LLM drift" rules plus a CLI
that generates an `AGENTS.md`-style instruction file from the active config.
Inventory below; landed leaves are linked to their rule files.

## What we already cover

| Their rule | Ours |
|---|---|
| `max-complexity` | built-in `complexity: ["error", { max: 10 }]` |
| `max-file-length` | `local/max-lines` (300) with per-file caps |
| `max-function-length` | `max-lines-per-function` (200) |
| `max-params` | `max-params: ["error", { max: 4 }]` |
| `naming-conventions` | `@typescript-eslint/naming-convention` |
| `no-magic-numbers` | built-in `no-magic-numbers` (warn, with ignores) |
| `no-any-in-generic` / `no-type-assertion-any` | `local/no-explicit-any` |
| `no-floating-promise` | `@typescript-eslint/no-floating-promises` (strictTypeChecked) |
| `prefer-unknown-in-catch` | `useUnknownInCatchVariables` (strictTypeChecked) |
| `throw-error-objects` | `@typescript-eslint/only-throw-error` (strictTypeChecked) |
| `structured-logging` | `local/structured-logging` (Pino-aware, wrapper-aware, console fallback, codemod hint) |
| `explicit-export-types` | `@typescript-eslint/explicit-function-return-type` (their rule also asserts param types — minor gap) |

The heavy structural / type-safety / logging rules are already covered, often
by stronger Musi-tailored versions.

## Landed leaves

1. **eslint-disable policy** — kept the existing register script and tightened
   it (reason required, broad disables allowlisted) rather than copy the
   upstream blanket `no-inline-disable`. A blanket ban would conflict with
   `local/no-explicit-any` (whose diagnostic intentionally directs untyped
   boundaries at a line-level suppression).
2. **`local/no-llm-artifacts`** — narrow editing leftovers (`// ... existing
   code ...`, `// rest unchanged`, `throw new Error("Not implemented")`, bare
   TODO without issue/PR/roadmap/agent-note reference). Generic
   `placeholder` / `stub` deliberately stayed out (Musi has real UI placeholder
   props and test stubs).
3. **Core-rule companion set** — enabled `no-useless-assignment`,
   `preserve-caught-error`, `no-promise-executor-return`, and global
   `require-atomic-updates` after fixing the small baseline (concurrency
   remediation in
   `docs/agent_notes/in_progress/eslint-require-atomic-updates.md`).
4. **`local/no-async-array-callbacks`** — preserves safe `Promise.all/allSettled/any/race(arr.map(async ...))` and the const-then-await shape; flags everything else.
5. **`local/no-swallowed-errors`** — narrow: catch bodies whose only
   executable statement is `console.{log,warn,error,debug}`. Logger-only
   catches, named handlers, comment-only catches, returns, and rethrows
   intentionally stay outside this leaf.

## Skipped after audit

`no-exported-function-expressions`, `no-commented-out-code`,
`no-incorrect-sort`, `no-empty-catch`, `prefer-early-return`, and
`max-nesting-depth` were audited again on 2026-05-11 against the live tree.
Per-site verdicts in the verification note; summary: zero correctness wins,
two latent `.sort()` smells fixable by hand, the rest false positives or
style. The `no-commented-out-code` hit is itself a false positive on a
policy comment in `character-stats-mutations.ts`.

## Worth borrowing the *idea*, not the rule

### Rule message guidance tests *(active leaf)*

The upstream plugin treats lint diagnostics as agent-facing repair prompts.
Several Musi rules already do this; make it a rule-authoring convention:

- Add a test that samples local rule messages and checks for a concise
  `Why:` / `How to fix:` shape when a rule is meant to guide repair.
- Allow simple one-line policy messages where a before/after rewrite would
  feel artificial.
- Use the upstream `docs/guides/lint-message-template.md` as inspiration;
  Musi messages should point at local guides and codemods.

### `instructions/generator.ts` + `cli/generate-instructions.ts` *(spike)*

Upstream walks the active ESLint config, collects an `instruction` string
from each rule module, and writes a `.agents/linting-rules.md` injected
into `AGENTS.md` / `CLAUDE.md` between sentinel comments — so rule docs
cannot drift from rule code.

Adaptation for Musi:

- Each `local/*` rule exposes a short `principle` string and an optional
  guide/codemod reference.
- Generate a sibling file rather than expanding `AGENTS.md`
  (`docs/ai-harness.md` says not to grow global instructions unless every
  agent needs them at every session start).
- Link the generated lint guidance from `docs/ai-harness.md` and keep
  `AGENTS.md` as the stable global entrypoint.
- Keep this separate from any rule port so metadata + doc generation don't
  block rule work.

## Active queue

1. **Rule message guidance tests** for `local/*` rules.
2. **Spike generated lint guidance** from local rule metadata into a sibling
   doc linked from `docs/ai-harness.md`.

## References

- Upstream plugin: `/home/node/tmp/eslint-plugin-llm-core/`
- Our rules: `/workspace/eslint-rules/`
- Our config: `/workspace/eslint.config.js`
- Verification: `docs/agent_notes/in_progress/eslint-llm-parked-rules-verification.md`
- Adjacent parked workstream: `docs/agent_notes/in_progress/ai-drift-sensors.md`
  (conceptually adjacent — both target LLM-specific code drift, but drift
  sensors run as separate report-only checks rather than ESLint rules).
