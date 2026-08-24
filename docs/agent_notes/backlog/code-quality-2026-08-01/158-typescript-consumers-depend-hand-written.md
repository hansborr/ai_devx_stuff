# 158. Generate TypeScript declarations from checked JavaScript policy instead of maintaining an ambient shadow

Status: Landed on fix/cq-158
Theme: Generated policy declarations · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Runtime lint policy is authored as checked JavaScript, but TypeScript tooling compiles against a separate ambient declaration that manually restates the modules’ semantic types. Wildcard declarations are not compiler-checked against the corresponding runtime exports, so a contributor must synchronize JSDoc or runtime validation, a distant `.d.ts`, and a bespoke shallow-parity test.

This custom bridge is broad enough to serve lint coverage, path policy, lint-ratchet, codemods, config-surface generation, and max-lines tooling. A stale declaration can therefore give ten production consumers a type contract the JavaScript does not implement, while the checked JavaScript itself is already capable of emitting declarations once its JSDoc is precise.

## Evidence

- `scripts/eslint-config-shared-policy.d.ts:1-113` is exactly 113 lines and declares five wildcard modules: three under `eslint-config/` and two under `eslint-rules/`.
- `scripts/eslint-config-shared-policy.d.ts:2-7` and `:57-62` independently restate the same `ConfigSurfaceEntry` properties and literal unions in two module blocks.
- `scripts/eslint-config-shared-policy.d.ts:9-53` separately models the max-lines policy and shared-policy exports, while `:74-94` restates the checked JavaScript codec’s parse union.
- `eslint-config/max-lines-exceptions-codec.js:14-17` explicitly directs TypeScript consumers through the ambient declaration and describes that as the existing pattern for `shared-policy.js` and `config-surfaces.js`.
- `scripts/eslint-config-shared-policy.test.ts:13-31` describes the bridge as hand-restated and maps the five declared names to runtime modules. Its checks at `:117-199` validate shallow export and object shapes but do not make TypeScript compare the declaration’s full semantic types with JavaScript inference.
- `tsconfig.eslint-js.json:14-26` already checks `eslint-config/*.js` with `allowJs` and `checkJs`, while deliberately excluding `local-plugin.js` and therefore the `eslint-rules/*.js` graph.
- A pinned-tree search excluding tests, specs, helpers, and declarations re-derived exactly 10 production TypeScript files importing at least one of the five ambient modules.
- `eslint-config/config-surfaces.js:21-82` validates JSON dynamically but supplies no JSDoc typedef for the returned entry objects, so declaration emit cannot rely on its current inference to preserve the ambient literal unions.

## Proposed direction

1. Make checked JavaScript the semantic type source. Add precise JSDoc typedefs and `@type`/return annotations to `eslint-config/config-surfaces.js` and the shared policy modules so emitted declarations preserve readonly arrays, `ConfigSurfaceEntry.language` and `.group` literal unions, `coverageStatus: "linted"`, the `` `.${string}` `` extension shape, and max-lines policy fields. Keep the already precise codec JSDoc in `max-lines-exceptions-codec.js`.

2. Coordinate the source set with leaf 157. On the current tree, the generated set is `shared-policy.js`, `config-surfaces.js`, and `max-lines-exceptions-codec.js`. If [157-shared-policyjs-grab-bag-unrelated-lint.md](./157-shared-policyjs-grab-bag-unrelated-lint.md) lands first as preferred, substitute its four focused replacement modules for `shared-policy.js`; do not recreate a generated declaration for the deleted barrel.

3. Add a declaration-emit configuration extending `tsconfig.eslint-js.json`, overriding `noEmit` and enabling `declaration` plus `emitDeclarationOnly`. Add a small generator that emits committed declarations colocated with their JavaScript modules. The filenames must exactly match NodeNext resolution—for the current tree, `eslint-config/shared-policy.d.ts`, `config-surfaces.d.ts`, and `max-lines-exceptions-codec.d.ts`—rather than using a `.generated.d.ts` infix. Mark generated ownership in their headers.

4. Add refresh/check package-script aliases for the declaration generator; these aliases and colocated declarations do not exist yet. Register one `generatedSurface` facet in `harness.controls.json` with the JavaScript sources, generator, and emit config as `triggerPaths`, the colocated declarations as `outputPaths`, and the freshness alias as `checkScript`. Regenerate verify metadata with `bun run verify:steps`.

5. Diff the first emitted declarations against the three corresponding ambient blocks before deleting them. Treat widened `any`, mutable arrays, lost literal unions, or weakened discriminants as defects in the JSDoc source, not acceptable generator output.

6. Delete the generated modules’ three wildcard blocks from `scripts/eslint-config-shared-policy.d.ts`. Retain that file only as a thin ambient binding for `*eslint-rules/max-lines.js` and `*eslint-rules/shared-schema-prefix.js`.

7. Shrink `scripts/eslint-config-shared-policy.test.ts` to guard only those two residual unchecked modules. Generated `eslint-config` declarations are instead protected by the freshness check. Update the test header, the sanctioned-exception paragraph at `scripts/README.md:32-39`, and the routing comment at `eslint-config/max-lines-exceptions-codec.js:14-17` to describe generated colocated declarations as the normal checked-JavaScript path.

## Scope / caveats

- Do not convert policy JavaScript to TypeScript or change runtime policy behavior.
- Do not bring `eslint-rules/*.js` into the checked-JavaScript project. `tsconfig.eslint-js.json:9-13` records the parked ESTree/TSESTree mismatch, so the two eslint-rule declarations remain hand-authored.
- Prefer landing leaf 157 first so this leaf emits the final split module set once. If this leaf lands first, leaf 157 must update generated trigger/output paths and regenerate declarations as part of its split. The two leaves must not run concurrently.
- Declaration generation under non-strict `checkJs` can silently widen types. The initial semantic diff against the current ambient file is a binding acceptance criterion.
- Colocated declarations need resolution-exact names, so generated ownership must come from file headers and harness registration rather than filename convention.
- Check whether the new `.d.ts` files require path-policy, lint-coverage, max-lines, or config-surface registration. Do not assume their location alone makes every harness closure complete.
- Normalize declaration freshness comparison, or otherwise account for deterministic TypeScript-version formatting, so compiler upgrades do not produce platform-dependent drift.
- Splitting `shared-policy.js` is owned by leaf 157. This leaf only derives TypeScript views from whichever checked-JavaScript modules exist after sequencing.
