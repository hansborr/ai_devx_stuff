# 18. trpc-shared codemods redefine CODEMOD_NAME, and the twin trpc-shared eslint rules duplicate the shared-schema import collector

Status: Done (2026-06-13) — implemented on feat/drift-ai-findings-2026-06
Theme: duplication · Area: tooling · Severity: quality-low · Size: S
Source: drift:ai duplicate-constants + clone-candidates (drift-baseline + target-config, two related sub-findings grouped) · Confidence: med

## Problem
Two related trpc-shared duplications in the codemod/lint tooling.

**(1) `CODEMOD_NAME` redefined per twin.** Each trpc-shared codemod is split across a runner and a `*-candidates` leaf that the runner imports, yet both files independently hardcode the same literal:
- `scripts/codemods/trpc-shared-input.ts:36` — `const CODEMOD_NAME = "trpc-shared-input";`
- `scripts/codemods/trpc-shared-input-candidates.ts:17` — `const CODEMOD_NAME = "trpc-shared-input";` (same literal)
- `scripts/codemods/trpc-shared-output.ts:36` and `scripts/codemods/trpc-shared-output-candidates.ts:18` — the `"trpc-shared-output"` twin, same split.

Both copies feed the shared `failWithName(CODEMOD_NAME, …)` helper, so the literals MUST stay byte-identical or error provenance diverges between the runner and its candidate collector. The other two codemods already centralize this: `scripts/codemods/concurrency-guard/constants.ts:10` and `scripts/codemods/expand-barrel/constants.ts:3` both `export const CODEMOD_NAME`. The trpc-shared pair deviates from that established convention. The runner already imports from the leaf (`scripts/codemods/trpc-shared-input.ts:34` imports from `./trpc-shared-input-candidates.js`), so re-exporting the constant from the leaf is a zero-new-edge fix.

**(2) eslint twin rules duplicate the shared-schema import collector.** `eslint-rules/trpc-shared-input-schema.js` and `eslint-rules/trpc-shared-output-schema.js` each privately define identical copies of `SHARED_SCHEMA_PREFIX` (`"@musi/shared/schemas/"`), `isSharedSchemaSource()`, the entire `ImportDeclaration` handler that populates `sharedSchemaImports`, and the `CallExpression` report skeleton. They diverge only in: the matched property name (`"input"` vs `"output"`), the messageId, and the input rule's extra wrapper-unwrap (`getSharedInputRootName` tolerating `.optional()`/`.describe()` vs the output rule's plain `getDirectIdentifierName`). The shared half can silently drift between the twins (e.g. a prefix change applied to one rule only).

This clears the bar as a dedup/maintainability improvement: it removes a sync hazard on `CODEMOD_NAME` and eliminates a copy-paste collector across two lint rules, matching the constants.ts convention already used by the sibling codemods. Not a runtime bug — severity quality-low.

## Evidence
- `scripts/codemods/trpc-shared-input.ts:36` — runner redefines `CODEMOD_NAME = "trpc-shared-input"`; used at lines 62, 140, 200, 214, 231, 252, 259, 262, 268, 272, 282, 285.
- `scripts/codemods/trpc-shared-input-candidates.ts:17` — leaf redefines the same literal; used at lines 24, 87.
- `scripts/codemods/trpc-shared-input.ts:34` — runner already imports from `./trpc-shared-input-candidates.js` (viable re-export path).
- `scripts/codemods/trpc-shared-output.ts:36` + `scripts/codemods/trpc-shared-output-candidates.ts:18` — the `"trpc-shared-output"` twin, identical split.
- `scripts/codemods/concurrency-guard/constants.ts:10` and `scripts/codemods/expand-barrel/constants.ts:3` — established `export const CODEMOD_NAME` convention.
- `eslint-rules/trpc-shared-input-schema.js:9` (`SHARED_SCHEMA_PREFIX`), `:13` (`isSharedSchemaSource`), `:64-74` (`ImportDeclaration` collector), `:76-88` (`CallExpression` skeleton).
- `eslint-rules/trpc-shared-output-schema.js:9` (`SHARED_SCHEMA_PREFIX`), `:12` (`isSharedSchemaSource`), `:50-60` (`ImportDeclaration` collector — byte-identical), `:62-74` (`CallExpression` skeleton).
- `eslint-config/local-plugin.js:18-19,39-40` — both rules registered as ESM imports, so a sibling helper module under `eslint-rules/` is importable by both.

## Proposed fix
Two independent sub-tasks (can land separately).

**Codemod `CODEMOD_NAME`:**
1. In `scripts/codemods/trpc-shared-input-candidates.ts`, change `const CODEMOD_NAME` to `export const CODEMOD_NAME`.
2. In `scripts/codemods/trpc-shared-input.ts`, delete the local `const CODEMOD_NAME` (line 36) and add `CODEMOD_NAME` to the existing import from `./trpc-shared-input-candidates.js` (line 30-34).
3. Repeat for the output twin (`trpc-shared-output-candidates.ts` → `trpc-shared-output.ts`).
4. (Alternative, if a constants module is preferred for consistency with concurrency-guard/expand-barrel: add `scripts/codemods/trpc-shared/constants.ts` exporting both names and import into all four files — heavier, only do if the team wants the directory convention uniform.)

**eslint shared collector:**
1. Add `eslint-rules/trpc-shared-schema-import-collector.js` (`// @ts-check`, ESM) exporting `SHARED_SCHEMA_PREFIX`, `isSharedSchemaSource(source)`, and a `createSharedSchemaImportCollector()` factory returning `{ sharedSchemaImports, ImportDeclaration }` (or a `collect(node)` the rule wires into its own `ImportDeclaration`).
2. Rewrite both `trpc-shared-input-schema.js` and `trpc-shared-output-schema.js` to consume the helper; keep rule-local only the property-name guard (`"input"`/`"output"`), the messageId/meta, and the input rule's `getSharedInputRootName`/`ALLOWED_WRAPPERS` wrapper-unwrap.
3. Tests: `eslint-rules/trpc-shared-input-schema.test.js` and `trpc-shared-output-schema.test.js` already exist — run both after the refactor (no behavior change expected; they are the regression net). Per TDD, add a small unit test for the new collector helper if it is given its own module surface.

## Verification / caveats
- False-positive risk: low. Both dedups are pure refactors with no intended behavior change; the existing rule tests and codemod tests are the safety net.
- Scope boundary: do NOT collapse the two eslint rules into one rule — they are intentionally separate (different repairCommand, messageId, and the input-only `.optional()/.describe()` unwrap). Only the import-collector half is shared; the `CallExpression` matchers stay per-rule.
- Before editing, re-confirm the four codemod files still all route `CODEMOD_NAME` through `failWithName` (and the runner through the many positional `CODEMOD_NAME` call sites) so removing the local const does not strand a reference; the import must be added in the same change.
- The eslint helper must stay `// @ts-check`-clean and ESM (it is imported by `eslint-config/local-plugin.js`); verify `bun run lint` and the eslint-rules test project still pass.
- If the team judges the per-rule copies acceptable for lint-rule isolation, a config-suppression is NOT appropriate here — there is no analyzer to suppress; either do the refactor or close as won't-fix. The codemod `CODEMOD_NAME` sub-task is the higher-value, lower-risk half and is worth doing regardless.
