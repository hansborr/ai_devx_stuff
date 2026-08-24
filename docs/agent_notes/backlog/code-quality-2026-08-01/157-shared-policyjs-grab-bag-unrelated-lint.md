# 157. Split `shared-policy.js` so unrelated lint domains no longer share an import-time I/O boundary

Status: Landed on fix/cq-157
Theme: Cohesive lint policy modules · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`eslint-config/shared-policy.js` presents one reusable-policy import surface but owns several unrelated domains: general file globs, script and test inventories, a package-import restriction, and the stateful max-lines policy. The last domain reads and validates a baseline during module evaluation, so a consumer importing only a path constant also pays for that I/O and inherits its fail-loud errors.

This concentrates unrelated changes in a high-fan-in file and obscures which policy a consumer actually depends on. It also makes the module hard to copy: an adopter cannot take the general lint vocabulary without also taking Musi’s codemod inventory and max-lines baseline loader.

## Evidence

- `eslint-config/shared-policy.js:21-62` combines language-extension and file-glob vocabulary with pass-through exports from `config-surfaces.js`.
- `eslint-config/shared-policy.js:64-111` switches to script TypeScript globs, fixture ignores, codemod source and test inventories, and Vitest assertion-function names.
- `eslint-config/shared-policy.js:113-178` owns package source/test globs and the codepoint-sorted production-function ignore set whose ordering feeds lint-ratchet stability.
- `eslint-config/shared-policy.js:180-184` contains a package-boundary restriction on the removed shared schemas barrel.
- `eslint-config/shared-policy.js:186-243` resolves and reads the max-lines baseline during module evaluation, detects conflict markers, validates its structure, and throws on malformed input.
- `eslint-config/shared-policy.js:245-270` adds generated-file exemptions and assembles `maxLinesPolicy`, despite those concerns having no dependency on most earlier glob and test registries.
- A pinned-tree import search re-derived 19 direct importers: nine sibling `eslint-config/*.js` modules, root `eslint.config.js`, seven `scripts/*.ts` files including two tests, and two `eslint-rules/*.test.js` files.
- `harness.controls.json:1211-1214`, `:1238-1240`, `:1577-1592`, and `:1820-1822` repeat `shared-policy.js` across five generated-surface trigger or fixture lists, increasing the registration cost of deleting or renaming it.

## Proposed direction

1. Replace `eslint-config/shared-policy.js` with four focused sibling modules:
   - A pure path/glob vocabulary module owning `jsTsLintableExtensions`, `codeFiles`, `typescriptFiles`, config-file reinclude composition, per-package source/test globs, and `productionFunctionStructure*`.
   - A scripts-and-tests policy module owning script TypeScript globs, fixture ignores, codemod source/test inventory, and `scriptTestAssertFunctionNames`.
   - A package-boundary policy module owning only `sharedSchemasBarrelRestrictedImportPattern`.
   - A max-lines policy module owning the baseline path, import-time read and validation, conflict-marker tripwire, generated exemptions, and `maxLinesPolicy`.

2. Move `byCodepoint`, the hand-sorted `clientTestAndHelperSourceFiles` explanation, and the complete `productionFunctionStructureIgnores` composition together into the path/glob module. Preserve their codepoint ordering exactly because it feeds lint-ratchet’s sorted-unique and `configHash` contracts.

3. Delete the pass-through exports at `shared-policy.js:45-49`. Consumers of `configSurfaceEntries`, `rootJsConfigFiles`, `rootAndPackageTsConfigFiles`, `tsConfigFiles`, and `eslintRulesConfigReincludePatterns` should import directly from `eslint-config/config-surfaces.js`.

4. Delete `shared-policy.js` rather than leaving a compatibility barrel. Retarget all 19 direct importers to the narrow module they use. Preserve every glob, cap, policy object, diagnostic string, and resolved ESLint behavior byte-for-byte.

5. Update `scripts/eslint-config-shared-policy.d.ts` with one declaration block per new module, exposing only the values TypeScript consumers use. Update `scripts/eslint-config-shared-policy.test.ts` so every new runtime module is represented in `runtimeModulesByDeclaredName`. These declaration changes are transitional if leaf 158 follows.

6. Replace all `shared-policy.js` trigger and fixture paths in `harness.controls.json` with the relevant new paths, regenerate verify and documentation surfaces, and run `bun run harness:check`. A pinned-tree search finds no `eslint-config/` entries in `eslint-config/config-surface-manifest.json`; the existing `eslint-config/*.js` support glob at `shared-policy.js:51` already auto-lints sibling JavaScript modules, so no manifest row is expected unless that surrounding policy changes.

## Scope / caveats

- Do not change what any policy permits, which files a glob selects, max-lines caps, generated exemptions, or user-facing messages. This is an ownership and import-boundary change.
- Keep the max-lines conflict-marker tripwire reachable from root `eslint.config.js`. After the split, audit script consumers for any accidental reliance on importing unrelated vocabulary merely to trigger the baseline read.
- Moving max-lines command internals belongs to [28-PLAN.md](../code-quality-2026-07-25/28-PLAN.md), slice 28.10, which expressly avoids `eslint-config/` edits. Prefer this leaf first, then let slice 28.10 relocate scripts already using the stable max-lines policy module; never run the two changes concurrently.
- Coordinate this work with
  [153-global-restricted-import-policy-survives.md](./153-global-restricted-import-policy-survives.md).
  If leaf 153 lands first, move its `restrictedImportsRule` composer with the
  package-boundary policy and preserve its callers; if this leaf lands first,
  leaf 153 must add the composer to the new focused module rather than recreating
  `shared-policy.js`.
- Coordinate this work with [158-typescript-consumers-depend-hand-written.md](./158-typescript-consumers-depend-hand-written.md). Preferred joint plan: land this split first, including its temporary declaration and parity updates, then let leaf 158 generate declarations for the final module set. If leaf 158 lands first, this split must update its generated trigger/output paths instead. Do not implement them concurrently.
- [152-path-policy-query-core-closed-over-musis.md](./152-path-policy-query-core-closed-over-musis.md) shares only the `jsTsLintableExtensions` import in `scripts/path-policy/path-policy.ts`; either order works with a trivial rebase.
- Redesigning the JavaScript-to-TypeScript declaration bridge is out of scope here and owned by leaf 158.
- Existing focused checks include `bun run test:scripts:file -- scripts/eslint-config-shared-policy.test.ts`, the two `eslint-rules` policy tests through `bun run test -- <file>`, and `bun run harness:check`.
