# 43 - env and feature-flag advisory integration

Status: Done
Track: P
Size: small-medium
Depends on: 39, 43a
Blocks: none

## Goal

Expose the task-43a env/define evaluator through prototype advisory output for
stale-branch review candidates.

## Background

The brainstorm recommends a generic env matrix first and provider metadata
later. Task 43a isolates the risky inventory/evaluator work. This task is the
user-facing slice: render explicit, matrix-backed branch predictions as
advisory candidates, not findings.

## Seams to touch

- env/define evaluator from task 43a
- `scripts/drift-ai/` prototype advisory modules or chosen subcommand
- `scripts/drift-ai/config.ts` only for exposing task-43a assumptions if not
  already done there
- prototype advisory output from task 39
- `scripts/drift-ai/README.md`

## What to do

1. Choose the smallest CLI surface that makes the env/define matrix explicit to
   the operator.
2. Reuse the task-43a evaluator; do not re-derive AST or expression logic here.
3. Emit the condition, assumed value source, predicted dead/alive branch, and
   whether a bundler/minifier would be expected to erase it.
4. Keep provider-specific systems like LaunchDarkly, Unleash, Piranha, and
   Harness cleanup as follow-ups unless metadata is supplied explicitly.
5. Route rows through the prototype advisory contract from task 39. Label them as
   candidates, not defects, and do not emit `DriftFinding` warnings.

## Testing

- Advisory rendering tests for predicted-live, predicted-dead, unknown, and
  no-config skip/candidate behavior.
- CLI smoke with a fixture-backed evaluator.

## Out of scope

- Calling hosted flag APIs.
- Mutating source or deleting branches.
- Default-on findings.

## Implementation notes (done 2026-06-04)

Landed the `env-branches` prototype advisory subcommand over the task-43a evaluator.
It reuses the 43a AST/value/branch logic verbatim — no expression logic re-derived
here — and routes every row through the task-39 prototype advisory contract
(`kind: "advisory"`, `lane: "prototype"`, no `findings`, no WARN/FIX).

- Config surface (the only task-43a assumption not yet exposed): a new top-level
  `envDefine` block. `env-define-matrix-config.ts` parses the five optional tables
  (`env`, `processEnv`, `importMetaEnv`, `bunEnv`, `defines`) into an
  `EnvDefineMatrix`; `value` is a JSON scalar (string/number/boolean/null) and
  `source` is optional, defaulting to the assumption's config key path so provenance
  is never empty. Wired through `config.ts` (`DriftAiEnvDefineConfig`),
  `config-defaults.ts` (`envDefine: {}`), and `config-parsing.ts`.
- `env-branches-advisory.ts` builds two sections — **resolved** (truthy/falsy) and
  **unresolved** (unknown) — so an unresolved branch never reads as a resolved lead.
  Each row carries the condition + file:line, every env/define read with its assumed
  value and `source`, the predicted constant, the dead branch (`then`/`else`), and a
  bundler-fold expectation: `static-define` (all reads are define/import.meta.env that
  a define-substituting bundler inlines), `env-inlining-dependent` (a process.env/
  Bun.env read folded only if the bundler is configured to inline it), or `not-static`
  (unresolved). `--top` caps rows per section with the shared truncation disclosure.
- With no `envDefine` config the matrix prerequisite is disclosed as **unmet** and the
  whole-repo source walk is skipped (every branch would be unknown). Provider systems
  (LaunchDarkly/Unleash/Piranha/Harness) stay out of scope; supply resolved values via
  the matrix.
- `env-branches-args.ts` / `env-branches-command.ts` mirror the coverage-evidence/
  clone-candidates subcommand shape (shared `--format`/`--output`/`--config`/`--top`
  parser, `prepareCurrentRun` for repo root/roots/extensions). Registered in
  `runner.ts` and `cli-args.ts` usage. Documented in `scripts/drift-ai/README.md` and
  `drift-ai.config.example.json`.

Tests: `env-define-matrix-config.test.ts` (config parse + defaults + rejects),
`env-branches-advisory.test.ts` (predicted-live/dead/unknown, import.meta.env static
fold, no-config prerequisite, per-section cap, JSON has no `findings`, no WARN/FIX),
`env-branches-command.test.ts` (CLI dispatch smoke over a fixture repo + unmet-matrix +
help).

Validation:

- `bunx vitest run scripts/drift-ai/env-define-matrix-config.test.ts scripts/drift-ai/env-branches-advisory.test.ts scripts/drift-ai/env-branches-command.test.ts --config scripts/vitest.config.ts`
- `bunx tsc -p tsconfig.scripts.json --noEmit`
- `bunx eslint scripts/drift-ai/env-branches-*.ts scripts/drift-ai/env-define-matrix-config.ts`
