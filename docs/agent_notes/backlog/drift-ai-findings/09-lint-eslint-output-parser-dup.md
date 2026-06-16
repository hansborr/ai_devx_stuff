# 09. lint-agent re-declares ESLint-JSON types and a parseEslintOutput parser that duplicate lint-ratchet eslint-runner (only the types are exported there — see Note)

Status: Done (2026-06-13) — implemented on feat/drift-ai-findings-2026-06
Theme: duplication · Area: tooling · Severity: quality-med · Size: S-M
Source: drift:ai drift-baseline near-duplicate scan (confirmed by re-reading both parsers) · Confidence: med

## Problem
Two scripts independently parse ESLint `--format=json` output with structurally identical code, and each re-declares its own `ESLintMessage`/`ESLintFileResult` shape types — even though `scripts/lint-ratchet/eslint-runner.ts` already EXPORTS those types and they are consumed elsewhere.

`scripts/lint-agent.ts` declares private `interface ESLintMessage` / `interface ESLintFileResult` (lines 43-58) plus private `isEslintMessage` (lines 183-188) and `parseEslintOutput` (lines 190-208). `scripts/lint-ratchet/eslint-runner.ts` declares the same pair of interfaces (lines 16-28, **exported**) plus `isEslintMessage` (lines 34-40) and `parseEslintOutput` (lines 42-60). The two `parseEslintOutput` bodies are line-for-line equivalent: trim-empty guard, `JSON.parse`, "not an array" throw, then a loop that skips non-object entries, requires `filePath: string` and an array `messages`, filters each message through `isEslintMessage`, and pushes `{ filePath, messages }`.

This clears the bar because the divergences are subtle and bug-prone, not intentional:
- **Object-guard divergence (latent robustness bug):** lint-agent's `isObject` (lines 65-67) is `typeof value === "object" && value !== null` — it does NOT exclude arrays. eslint-runner's `isRecord` (lines 30-32) adds `!Array.isArray(value)`. So lint-agent will treat a stray array entry as a valid object and may emit a malformed/empty result instead of skipping it.
- **Validation divergence:** eslint-runner's `isEslintMessage` validates `ruleId === null || typeof ruleId === "string"`; lint-agent's omits the `ruleId` check entirely, so a message with a non-string `ruleId` passes lint-agent but is rejected by eslint-runner.
- **Error-type divergence:** eslint-runner throws `ConfigError`; lint-agent throws plain `Error`.
- **Type-shape divergence:** lint-agent's `ESLintMessage` adds optional `column`, `fix`, `suggestions`; eslint-runner's does not.

Any future hardening (e.g. tightening message validation, handling new ESLint output fields) must be applied in two places, and the parsers are already drifting.

Note: the audit spec's title claims `parseEslintOutput` is "already exported by" eslint-runner — that is inaccurate. eslint-runner exports only the *types* (`ESLintMessage`, `ESLintFileResult`) and the `runEslint*` functions; `parseEslintOutput` and `isEslintMessage` are currently module-private there. The dedup is still warranted; the parser must be promoted/exported as part of the fix.

## Evidence
- `scripts/lint-agent.ts:43-58` — private `ESLintMessage`/`ESLintFileResult` interfaces (with extra optional `column`/`fix`/`suggestions`).
- `scripts/lint-agent.ts:65-67` — `isObject` lacks the `!Array.isArray` guard.
- `scripts/lint-agent.ts:183-188` — private `isEslintMessage`; omits the `ruleId` check.
- `scripts/lint-agent.ts:190-208` — private `parseEslintOutput`; throws plain `Error`.
- `scripts/lint-agent.ts:257` — call site: `const eslintResults = parseEslintOutput(stdout);`.
- `scripts/lint-ratchet/eslint-runner.ts:16-28` — EXPORTED `ESLintMessage`/`ESLintFileResult`.
- `scripts/lint-ratchet/eslint-runner.ts:30-40` — `isRecord` (excludes arrays) + `isEslintMessage` (checks `ruleId`).
- `scripts/lint-ratchet/eslint-runner.ts:42-60` — `parseEslintOutput`; throws `ConfigError`; currently module-private.
- `scripts/lint-ratchet/current-collector.ts:1` — `import type { ESLintFileResult, ESLintMessage } from "./eslint-runner.js";` (proves the exported types are already a shared contract).

## Proposed fix
1. Add a focused unit test (TDD, repo norm: place beside the code) for the parser BEFORE refactoring — cover: empty/whitespace stdout returns `[]`, non-array top-level throws, array entry is skipped (the `isObject` array-guard regression), entry with non-array `messages` is skipped, message with non-string `ruleId` is rejected, and that the chosen error factory is invoked on the not-an-array path. This locks in the *stricter* eslint-runner behavior as the canonical one.
2. Promote a single shared parser. Either (a) export `parseEslintOutput` + `isEslintMessage` from `scripts/lint-ratchet/eslint-runner.ts`, or (b) extract them into a new `scripts/lib/eslint-json.ts` module that eslint-runner also imports. Make the parser accept an injected error factory, e.g. `parseEslintOutput(stdout, makeError = (m) => new Error(m))`, so eslint-runner passes `(m) => new ConfigError(m)` and lint-agent passes the default `Error` — preserving each caller's current throw type.
3. Reconcile the type. Widen the single exported `ESLintMessage` to include the optional `column`/`fix?: unknown`/`suggestions?: readonly unknown[]` fields lint-agent needs (they are additive optionals; eslint-runner consumers are unaffected). Keep the stricter `ruleId: string | null` required field.
4. In `scripts/lint-agent.ts`: delete the private `ESLintMessage`/`ESLintFileResult` interfaces (43-58), `isEslintMessage` (183-188), `parseEslintOutput` (190-208), and the array-permissive `isObject` if it has no other callers; import the shared type + parser instead. Confirm `buildParserErrorFinding`/the other `ESLintMessage` consumers (lint-agent lines 130, 144) still typecheck against the widened type.
5. Verify lint-agent's behavior is unchanged at the call site (line 257) other than the intended hardening (array entries now skipped, non-string `ruleId` now filtered).
6. Run `bun run verify:changed` (stage the touched files first) plus the new unit test.

## Verification / caveats
- False-positive risk is low: both parsers were re-read in full and are structurally identical; the only behavioral effect of dedup is adopting eslint-runner's stricter guards in lint-agent (an improvement, not a regression — but confirm no test or downstream consumer relied on the array-permissive `isObject` or the missing `ruleId` filter; a quick `rg` shows none).
- Scope boundary: keep the runner/spawn machinery (`spawnEslint`, cache sweeping, `runEslint`) where it is — only the pure JSON parser + shape types are shared. Do not couple lint-agent to `LintRatchetConfig` or `ConfigError`; the injected error factory exists precisely to avoid pulling `ConfigError` (and its `lint-ratchet-metrics` import chain) into lint-agent.
- `isObject` in lint-agent may be used by other helpers in the file — grep before deleting; if reused elsewhere, leave it but tighten it to add `!Array.isArray`, or have the shared parser use its own internal `isRecord`.
- A config-suppression is NOT the right call here; this is genuine code dedup with a latent robustness gap, so the code change is warranted.
