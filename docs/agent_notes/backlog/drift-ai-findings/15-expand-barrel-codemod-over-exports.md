# 15. expand-barrel codemod over-exports module-internal helpers and union member types

Status: Done (2026-06-13) — implemented on feat/drift-ai-findings-2026-06
Theme: dead-code · Area: tooling · Severity: quality-low · Size: XS

Source: drift:ai exports/knip-unused-exports (target-config) · Confidence: med

## Problem
In `scripts/codemods/expand-barrel/`, several module-internal helpers carry an `export` keyword but are referenced only inside their own defining file. The unnecessary `export` widens each module's public surface and trains readers to treat private implementation details as reusable API.

Confirmed module-private functions (each `export`ed, every reference is in-file):
- `paths.ts` `toPosix` — used only at `paths.ts:99,113`
- `paths.ts` `replaceTsExtensionWithJs` — used only at `paths.ts:99,112`
- `paths.ts` `resolveRelativeModulePath` — used only at `paths.ts:40,80`
- `import-groups.ts` `importSpecifierText` — used only at `import-groups.ts:96`
- `import-replacement.ts` `replacementForImport` — used only at `import-replacement.ts:272`

(Note: the ~60 repo-wide `toPosix` hits are a DISTINCT symbol in `scripts/drift-ai/path-util.ts`; the `expand-barrel` one has no external importer.)

Separately, `types.ts` exports seven discriminated-union *member* types that nothing references outside `types.ts` — only the composed unions are consumed:
- `NewImportGroup`, `DefaultImportGroup`, `NamespaceImportGroup` (members of `ImportGroup`, line 35)
- `NamedExportBinding`, `DefaultExportBinding`, `NamespaceExportBinding` (members of `DirectExportBinding`, lines 58-61)
- `BarrelLocalExportBinding` (member of `ExportBinding`, line 62)

Each member type appears only at its own definition plus the union composition. Discriminant narrowing (`group.kind === "named"` etc.) is done on the union-typed variables, never via the individually-named member types, so they can be inlined into the union definitions.

This is legitimately knip-flaggable: knip's `scripts` workspace lists only top-level `scripts/codemods/*.ts` as entry points (the nested `expand-barrel/` files are not entries), project scope is `scripts/**/*.ts`, and `ignoreIssues` has no exemption for `scripts/codemods/**` (only `scripts/codemods/fixtures/**` is excluded).

## Evidence
- `scripts/codemods/expand-barrel/paths.ts:11,15,34` — `toPosix`/`replaceTsExtensionWithJs`/`resolveRelativeModulePath` exported; all refs in-file (40, 80, 99, 112-113). `rg` repo-wide: no external importer.
- `scripts/codemods/expand-barrel/import-groups.ts:7` — `importSpecifierText` exported, only ref at line 96.
- `scripts/codemods/expand-barrel/import-replacement.ts:195` — `replacementForImport` exported, only ref at line 272.
- `scripts/codemods/expand-barrel/types.ts:14-56` — seven union member types; `rg` repo-wide shows zero references outside `types.ts` beyond their own definitions and the union compositions at lines 35, 58-62.
- `scripts/codemods/expand-barrel.test.ts` — imports only the public entrypoint `runExpandBarrelCodemod`; references none of the five functions or seven member types.
- `knip.config.ts:44-63` — `scripts` workspace `entry` includes `scripts/codemods/*.ts` (top-level only), `project` is `scripts/**/*.ts` with `fixtures/**` excluded; `knip.config.ts:18-41` `ignoreIssues` has no `scripts/codemods/**` entry.

## Proposed fix
1. In `paths.ts`, drop `export` from `toPosix`, `replaceTsExtensionWithJs`, and `resolveRelativeModulePath` (they remain used by the still-exported `resolveExportModulePath`, `specifierMatchesContext`, `outputSpecifier` in the same file).
2. In `import-groups.ts`, drop `export` from `importSpecifierText`.
3. In `import-replacement.ts`, drop `export` from `replacementForImport`.
4. In `types.ts`, the simplest knip-satisfying fix (**recommended** per the parallel review) is to drop only the `export` keyword from the seven member types — they stay as readable named building blocks of the unions, just no longer public. Inlining the object-type literals into the `ImportGroup` (line 35), `DirectExportBinding` (lines 58-61), and `ExportBinding` (line 62) unions and deleting the names is an equally valid but heavier alternative; both satisfy knip.
5. Per repo TDD norm, no new unit test is needed (these are non-behavioral visibility changes); the existing `scripts/codemods/expand-barrel.test.ts` driving `runExpandBarrelCodemod` already exercises all five functions transitively and must stay green.
6. Re-run `bun run knip` (or the scripts lens) to confirm the unused-export findings clear, then `bun run test:scripts:file -- scripts/codemods/expand-barrel.test.ts`.

## Verification / caveats
- False-positive risk: low. All reachability was confirmed by `rg` repo-wide plus reading the main test; cross-file imports from `run.ts`/`mocks.ts`/`export-map.ts`/`export-bindings.ts` pull only OTHER symbols (`discoverPackageFiles`, `specifierMatchesContext`, `resolveExportModulePath`, `outputSpecifier`, `transformSourceFile`, etc.), never the five cited functions.
- Before editing, an implementer should re-confirm no new importer was added since this audit (`rg -n '\b<name>\b' --type ts` for each function; for the member types, confirm the only hits remain `types.ts` definitions + union compositions).
- Scope boundary: tooling-only codemod directory, no product/runtime impact. Purely cosmetic public-surface narrowing — do not over-engineer.
- Config-suppression is NOT the right call here: these are genuinely module-private, so narrowing the code is correct rather than adding a `knip.config.ts` `ignoreIssues` exemption.
- When inlining the union members in step 4, verify `tsc` still passes — the inlined object literals must preserve the `readonly` modifiers and exact field shapes shown at `types.ts:14-56`.
