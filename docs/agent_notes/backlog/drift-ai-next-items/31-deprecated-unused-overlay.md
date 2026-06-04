# 31 - `@deprecated` unused overlay

Status: Parked
Track: C
Size: small-medium
Depends on: 30 optional
Blocks: none

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
