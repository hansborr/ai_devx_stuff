# 10. Six empty-config check-config metadata literals (and the duplicate-schemas/duplicate-types parse bodies) are hand-repeated in drift-ai

Status: Done (2026-06-13) — implemented on feat/drift-ai-findings-2026-06
Theme: duplication · Area: tooling · Severity: quality-med · Size: S
Source: drift:ai dolos-candidates (drift-baseline; confirmed two empty-config files + both parse bodies) · Confidence: med

## Problem
Six `scripts/drift-ai/*-check-config.ts` files hand-repeat the identical empty-config `CheckConfigMetadata` ceremony. Each declares `export type XConfig = Record<string, never>;` then a metadata literal with `defaultConfig: {}`, `parseConfig: parseEmptyCheckConfig`, a `selectConfig: (config) => config.checks["<id>"]` lambda, and `runByDefault: false` — differing only by `id`/`usage` string and the comment. The boilerplate grows linearly per new opt-in check and has already drifted: `suppressions-check-config.ts` omits `runByDefault` entirely (relying on the `?: boolean` "treated as true when omitted" default — which makes suppressions **default-on**: `DEFAULT_CHECKS` keeps every check whose `runByDefault !== false` (`check-metadata.ts:53-55`), so suppressions is NOT opt-in and the omission is intentional, not a bug — this corrects the original "semantically wrong" framing) and uses dot access `config.checks.suppressions` instead of the bracket form the siblings use.

Separately, `duplicate-schemas-check-config.ts` and `duplicate-types-check-config.ts` carry structurally identical parse bodies: a positive-int field defaulted from a `DEFAULT_*` constant plus an `excludeGlobs` block that does `uniqSorted(readStringArray(...).map(normalizeGlob))`. They differ ONLY in the single field name (`minKeys` vs `minProps`). Both `parseConfig` functions (32-47 in each) and both `assertKnownKeys([...])` arrays are copies.

This clears the bar as a dedup/maintainability win: a single factory collapses the six empty-config literals to one call each and makes the `runByDefault` semantics explicit (closing the suppressions drift), and a shared parse helper removes one full copy of the min-int+excludeGlobs body.

## Evidence
- `scripts/drift-ai/import-cycles-check-config.ts:1-16` — canonical empty-config literal (`Record<string,never>` alias + `{}` default + `parseEmptyCheckConfig` + `selectConfig` + `runByDefault: false`).
- `scripts/drift-ai/knip-duplicates-check-config.ts:1-18` — same shape; only id/usage/comment differ.
- `scripts/drift-ai/knip-orphan-files-check-config.ts:1-16` — same shape (id `orphan-files`).
- `scripts/drift-ai/knip-unused-exports-check-config.ts:1-18` — same shape (id `unused-exports`).
- `scripts/drift-ai/layer-direction-check-config.ts:1-19` — same shape (id `layer-direction`).
- `scripts/drift-ai/suppressions-check-config.ts:1-14` — DIVERGES: omits `runByDefault`, uses `config.checks.suppressions` dot access, adds an unused `DEFAULT_SUPPRESSIONS_CONFIG = {}` local.
- `scripts/drift-ai/duplicate-schemas-check-config.ts:13-47` — `DEFAULT_*` default + `parseDuplicateSchemasConfig` body (field `minKeys`).
- `scripts/drift-ai/duplicate-types-check-config.ts:13-47` — mirror body (field `minProps`); byte-for-byte identical except the field name and constant name.
- `scripts/drift-ai/config-readers.ts:83-87` — `parseEmptyCheckConfig`; the leaf module (only imports config types, config-paths, errors, path-util) where the factory belongs.
- `scripts/drift-ai/check-plugin.ts:80-96` — `CheckConfigMetadata` type + the comment requiring metadata to stay "free of runtime-adapter imports"; `runByDefault?: boolean` "Treated as true when omitted".
- `scripts/drift-ai/check-plugin.ts:120-140` — `defineCheckPlugin` is the existing factory precedent.
- `scripts/drift-ai/check-metadata.test.ts:54-62` — import-boundary test asserting metadata modules pull no `ts-morph`; any factory placement must keep passing it.

## Proposed fix
1. Add `makeEmptyCheckConfig<Id extends DriftCheckId>(id: Id, options?: { usage?: string; runByDefault?: boolean }): CheckConfigMetadata<Record<string, never>, Id>` to `config-readers.ts` (next to `parseEmptyCheckConfig`; this module has no heavy imports so the boundary test stays green). Return `{ id, usage: options?.usage ?? id, defaultConfig: {}, parseConfig: parseEmptyCheckConfig, selectConfig: (config) => config.checks[id], ...(options?.runByDefault === undefined ? {} : { runByDefault: options.runByDefault }) }`. Note `config-readers.ts` currently imports only the `GhostFileAllowedPair` type from `config.js`; add a type-only import of `DriftAiConfig`/`DriftCheckId` as needed.
2. Rewrite the six files to `export const xCheckConfig = makeEmptyCheckConfig("<id>", { runByDefault: false });` keeping the explanatory comment above each call. For `suppressions`, pass `runByDefault: true` explicitly (or omit and document why) to make the previously-implicit behavior intentional, and drop the unused `DEFAULT_SUPPRESSIONS_CONFIG` local. Keep the per-file `export type XConfig = Record<string, never>;` aliases only if anything imports them (check with `bun run code:intel -- dependents` on each before deleting; the generic factory return type makes them redundant otherwise).
3. Extract `parseMinIntAndExcludeGlobs(fieldName: "minKeys" | "minProps", defaults: { [k]: number; excludeGlobs: readonly string[] })` (or a small generic over the field name) into `config-readers.ts`, reusing `assertConfigObject`/`assertKnownKeys`/`parsePositiveInt`/`readStringArray`/`uniqSorted`/`normalizeGlob`. Have both `duplicate-schemas` and `duplicate-types` parse functions delegate to it.
4. TDD per repo norm: there is no `config-readers.test.ts` today — add one covering `makeEmptyCheckConfig` (correct `id`, `selectConfig` selecting the right `checks[id]` slot, `runByDefault` present-vs-omitted) and `parseMinIntAndExcludeGlobs` (default fallback, positive-int rejection, excludeGlobs normalize+uniqSorted). Run `bun run test:scripts:file -- scripts/drift-ai/config-readers.test.ts` and the existing `check-metadata.test.ts` to confirm the import boundary still holds.

## Verification / caveats
- False-positive risk is low: the six literals and both parse bodies are confirmed copies (re-read, line numbers above are current). The only behavioral subtlety is `suppressions` omitting `runByDefault` — preserve its **default-on** behavior — omit `runByDefault` or pass `true`; passing `false` would silently drop suppressions from `DEFAULT_CHECKS` (a behavior change). Flag the choice in the commit body.
- Typing check before implementing: confirm `selectConfig: (config) => config.checks[id]` typechecks under a generic `Id` (the indexed access `DriftAiChecksConfig[Id]` must resolve to `Record<string, never>` for these six ids — it does in the current `config.ts`, but a non-empty-config id passed to the factory would mistype, which is the desired guard).
- Scope boundary: this is metadata/parse dedup only — do not touch the `*-check.ts` runtime adapters or `defineCheckPlugin`. The `parseMinIntAndExcludeGlobs` extraction is a genuinely separate, smaller cleanup; it can ship in the same PR or be split out if step 1-2 is preferred standalone.
- Keep the factory free of runtime-adapter imports; `check-metadata.test.ts:54-62` will fail loudly if the boundary is violated, so it doubles as the regression guard.
