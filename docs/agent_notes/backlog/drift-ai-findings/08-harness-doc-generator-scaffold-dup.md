# 08. Doc-generator check-or-write scaffold (parseArgs/readCurrentOutput/main) duplicated across 3+ harness generators

Status: Done (2026-06-13) — implemented on feat/drift-ai-findings-2026-06
Theme: duplication · Area: tooling · Severity: quality-med · Size: S-M
Source: drift:ai near-duplicates / clone-candidates (drift-baseline; 3/3 sites verified verbatim) · Confidence: med

## Problem
Three harness doc-generators re-implement the same `--check`/`--`-mode scaffold byte-for-byte:

- `parseArgs(args)` — identical in all three: `args.filter((arg) => arg !== "--" && arg !== "--check")`, throw on leftovers, return `{ checkMode: args.includes("--check") }`.
- `readCurrentOutput()` — identical in all three: `try { return readFileSync(outputPath, "utf8"); } catch { return ""; }`.
- the `main()` check-or-write flow — collect → render → `if (checkMode)` compare against `readCurrentOutput()`, on mismatch emit `` `${outputPath} is out of date. Run \`<cmd>\` and commit the result.` `` + `process.exitCode = 1`, else `mkdirSync(dirname(outputPath))` + `writeFileSync` + a `Wrote ...` log.

Only three things vary per generator: the collect/render calls, the refresh-command string (`docs:lint-guidance` / `docs:harness-controls` / `verify:steps`), and the `Wrote ...` suffix.

This clears the bar as a maintainability/dedup fix: the exit-code contract and the "is out of date. Run ... and commit the result." operator message are part of the harness's CI gate behavior, yet they live in three copies. A future change to check semantics (e.g. trim trailing newline before compare, change exit code, reword the message) will silently land in one generator and skip the other two — the classic drift this gate exists to prevent. The scaffold is also untested (`generate-verify-steps.test.ts` only exercises `renderVerifyStepsShellFromManifest`; the other two have no `.test.ts` at all), so the duplication has no shared safety net.

## Evidence
- `scripts/generate-lint-guidance.ts:33-39` — `readCurrentOutput` (try/catch → "").
- `scripts/generate-lint-guidance.ts:108-114` — `parseArgs` (reject unknown, `includes("--check")`).
- `scripts/generate-lint-guidance.ts:116-138` — `main()` check-or-write flow; refresh cmd `docs:lint-guidance`; entrypoint is top-level `await main()` at line 140.
- `scripts/harness/generate-harness-controls.ts:130-136` — `readCurrentOutput` (identical).
- `scripts/harness/generate-harness-controls.ts:260-266` — `parseArgs` (identical).
- `scripts/harness/generate-harness-controls.ts:268-290` — `async main()`; refresh cmd `docs:harness-controls`; entrypoint guard `import.meta.url === pathToFileURL(process.argv[1]).href` at line 292.
- `scripts/harness/generate-verify-steps.ts:269-275` — `readCurrentOutput` (identical).
- `scripts/harness/generate-verify-steps.ts:277-283` — `parseArgs` (identical).
- `scripts/harness/generate-verify-steps.ts:285-304` — sync `main()`; refresh cmd `verify:steps`; entrypoint guard at line 306.
- `scripts/lib/lint-rule-docs.js` (imported as `../lib/lint-rule-docs.js` from `generate-harness-controls.ts:10`) — confirms `scripts/lib/` is the existing shared-helper location; there is no `scripts/harness/lib/`.

## Proposed fix
1. Add `scripts/lib/doc-generator.ts` (the real shared-lib dir; the audit spec's `scripts/harness/lib/` does not exist) exporting:
   - `parseCheckModeArgs(args: readonly string[]): { readonly checkMode: boolean }` — the lifted `parseArgs` body.
   - `readCurrentOutput(outputPath: string): string` — the lifted try/catch reader (take `outputPath` as a param so it's no longer a closure).
   - `runDocGenerator(opts: { outputPath: string; refreshCommand: string; render: () => string | undefined; wroteSuffix?: string }): void` (or `Promise<void>` for the async collectors) that owns: parse argv → `render()` (returning `undefined` to short-circuit, matching the existing `if (entries === undefined) return;` early-exit) → check-or-write/exit-code flow → logs.
2. Rewrite each generator's `main()` to call `runDocGenerator`, passing only its collect/render and `refreshCommand`. Keep each file's existing entrypoint idiom (top-level `await` vs `import.meta.url` guard) — that difference is intentional (lint-guidance is run directly; the harness pair are also imported by tests/`harness-check.ts`), so do not collapse it into the shared helper.
3. Delete the now-duplicated `parseArgs` and `readCurrentOutput` from all three generators.
4. TDD: add `scripts/lib/doc-generator.test.ts` covering `parseCheckModeArgs` (throws on unknown arg; detects `--check`), `readCurrentOutput` (missing file → ""), and `runDocGenerator` check-mode mismatch sets `exitCode = 1` and emits the refresh message with the supplied `refreshCommand`. This is net-new coverage for behavior that is currently untested in two of the three files.

## Verification / caveats
- False-positive risk: low. The three `parseArgs`/`readCurrentOutput` bodies are verbatim-identical (verified); the only real per-site variance is `refreshCommand`, the render call, and the `Wrote ...` suffix.
- Scope boundary: `scripts/generate-module-index.sh` emits a similar "is out of date. Run ..." message but is a shell script with a different finding-JSON contract — out of scope; do not fold it in.
- An implementer must preserve the async-vs-sync split: `generate-lint-guidance.ts` and `generate-harness-controls.ts` have `async main()` (their collectors `await`), while `generate-verify-steps.ts` is sync. Either give `runDocGenerator` an async render signature for all callers, or expose sync + async variants — do not force the sync generator through an unnecessary `await`.
- Keep the early-`undefined`-return short-circuit (`if (entries === undefined) return;`) used by lint-guidance and harness-controls; verify-steps has no such short-circuit, so the shared `render` contract must treat `undefined` as "skip write, no error".
- This is a pure refactor with no output change; the existing `--check` gates (`docs:lint-guidance`/`docs:harness-controls`/`verify:steps`) should pass unchanged after the extraction and serve as the regression check.
