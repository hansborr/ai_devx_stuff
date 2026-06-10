# 31 - `@deprecated` unused overlay

Status: Done
Track: C
Size: small-medium
Depends on: 30 optional
Blocks: none

## Implementation note (Done 2026-06-04)

Landed as an overlay on the existing `unused-exports` knip adapter — no extra rows,
no new check id.

- New module `scripts/drift-ai/knip-unused-exports-deprecated.ts`:
  `createDeprecatedExportLookup(readFile)` returns a memoizing predicate. It parses
  each in-scope file once with `ts.createSourceFile`, indexes the `(line, col)` of
  every named declaration carrying a `@deprecated` JSDoc tag (`ts.getJSDocTags`),
  and answers by knip's reported name position. AST-exact, so a container's
  `@deprecated` never bleeds onto its members or vice versa (verified by test);
  `getJSDocTags` correctly hoists a leading JSDoc block onto a `const`/`let`
  declaration.
- `buildUnusedExportFindings` gained an optional `isDeprecated` predicate. When it
  matches: `details.deprecated: true`, the message names the annotation ("…is
  marked @deprecated and never imported…"), and the hint becomes
  `DEPRECATED_UNUSED_EXPORTS_REPAIR_HINT` (tombstone-removal framing). knip's
  `[target-config]` provenance is untouched — the overlay is local annotation
  evidence only.
- `knip-unused-exports-check.ts` injects the lookup from `ctx.services.readFile`.
- Conservative by construction: no location, unreadable file, or a position that
  resolves to no named declaration → no overlay. Does NOT search for `@deprecated`
  symbols knip considers reachable (out of scope, as specified).
- Docs: `scripts/drift-ai/README.md` (summary table + unused-exports section).
- Tests: `knip-unused-exports-deprecated.test.ts` (lookup, including no-bleed and
  `.tsx`/memoization) plus overlay + end-to-end cases in `knip-unused-exports.test.ts`.

## Goal

Add an explicit tombstone signal for exported symbols that are both marked
`@deprecated` and reported unused by the existing `unused-exports` check.

## Background

The brainstorm calls out `@deprecated` plus unreferenced as a conservative
refactor-residue signal. It should be an overlay on target-configured reachability
evidence, not a standalone dead-code verdict.

## Seams to touch

- `scripts/drift-ai/knip-unused-exports.ts`
- `scripts/drift-ai/knip-unused-exports.test.ts`
- possibly `scripts/drift-ai/parsed-source-cache.ts` if source lookup is needed
- `scripts/drift-ai/README.md`

## What to do

1. For each `unused-exports` symbol with a usable location, inspect nearby JSDoc
   or declaration trivia for `@deprecated`.
2. Add an overlay detail such as `deprecated: true` and adjust message/hint to
   say the symbol is both deprecated and reported unused.
3. Keep provenance as knip target-configured reachability plus local annotation
   evidence.
4. Do not emit extra rows unless the output stays clearer than a detail flag.
5. Keep noisy cases conservative: if the location is absent or source parsing is
   uncertain, omit the overlay.

## Testing

- Fixture tests for deprecated unused exports, non-deprecated unused exports,
  malformed/missing locations, and type/enum/namespace categories.

## Out of scope

- Finding deprecated symbols that knip does not report unused.
- Removing symbols automatically.
- Building a general JSDoc analysis engine.
