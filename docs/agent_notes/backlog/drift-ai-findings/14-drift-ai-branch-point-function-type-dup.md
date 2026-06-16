# 14. BirthSizeDeltaComplexityFunction re-declares the exported BranchPointFunction it already depends on

Status: ✅ Implemented on `chore/driftai-audit` (2026-06-13); verified present in the live tree. The body below is the original finding — its cited line numbers predate the fix.
Theme: duplication · Area: tooling · Severity: quality-low · Size: XS

## Problem
`birth-size-delta-types.ts` is the branch-points overlay/consumer: it already imports `BranchPointMeasurer` from `./branch-points.js` (line 3). Yet it re-declares branch-points' exported per-function shape `BranchPointFunction` (`{name, line, branchPoints}`, all `readonly`) verbatim under the new name `BirthSizeDeltaComplexityFunction` (lines 59-63) instead of importing it.

The two declarations are byte-identical:

```ts
// branch-points.ts:35-39
export type BranchPointFunction = {
  readonly name: string;
  readonly line: number;
  readonly branchPoints: number;
};
// birth-size-delta-types.ts:59-63
export type BirthSizeDeltaComplexityFunction = {
  readonly name: string;
  readonly line: number;
  readonly branchPoints: number;
};
```

This is not an accidental shape collision — the data IS the same data. `BirthSizeDeltaComplexityFunction` is referenced exactly once, as the element type of `BirthSizeDeltaComplexity.topFunctions` (line 73), and that array is populated in `birth-size-delta-complexity.ts:50-54` by `result.metrics.functions.slice(...)`, where `metrics.functions` is typed `readonly BranchPointFunction[]` (branch-points.ts:46). The assignment compiles only because the two types are structurally identical; the local type is a hidden alias kept in sync by coincidence. It clears the bar because any field change to branch-points' `BranchPointFunction` silently desynchronizes this overlay and must be hand-mirrored to keep `topFunctions` assignable. The line-65 comment already documents that this models the same branch-points-per-function data.

## Evidence
- `scripts/drift-ai/branch-points.ts:35-39` — exported `BranchPointFunction = {readonly name, line, branchPoints}`.
- `scripts/drift-ai/branch-points.ts:46` — `BranchPointMetrics.functions: readonly BranchPointFunction[]` (the source of truth for topFunctions).
- `scripts/drift-ai/birth-size-delta-types.ts:3` — module already imports `BranchPointMeasurer` from `./branch-points.js`.
- `scripts/drift-ai/birth-size-delta-types.ts:59-63` — byte-identical re-declaration `BirthSizeDeltaComplexityFunction`.
- `scripts/drift-ai/birth-size-delta-types.ts:73` — the ONLY reference: `topFunctions: readonly BirthSizeDeltaComplexityFunction[]`.
- `scripts/drift-ai/birth-size-delta-complexity.ts:50-54` — `topComplexityFunctions` returns `result.metrics.functions.slice(...)` (a `BranchPointFunction[]`), proving the assignment relies on structural identity.

## Proposed fix
1. In `birth-size-delta-types.ts`, add `BranchPointFunction` to the existing `import type { BranchPointMeasurer } from "./branch-points.js";` line.
2. Remove the `BirthSizeDeltaComplexityFunction` declaration (lines 59-63) and change line 73 to `readonly topFunctions: readonly BranchPointFunction[];`. If the domain-specific name is wanted at the `topFunctions` site, instead keep one line: `export type BirthSizeDeltaComplexityFunction = BranchPointFunction;` — but prefer dropping it, since it has a single in-file consumer and no external importers (`rg "BirthSizeDeltaComplexityFunction"` returns only the two intra-file hits).
3. Do NOT touch `MutableScope` in `branch-points.ts` — it is the intentionally-mutable internal accumulator and a deliberately separate type.
4. Tests: the existing `birth-size-delta-advisory.test.ts` (lines 338, 399 construct `topFunctions: [{name, line, branchPoints}]` literals) already exercises this shape and will compile-check the swap; no new test needed. Run `bun run test:scripts:file -- scripts/drift-ai/birth-size-delta-complexity.ts` (or the advisory test) plus `bun run typecheck` to confirm the structural assignment in `topComplexityFunctions` still holds via the named import.

## Verification / caveats
- False-positive risk is low: confirmed the import edge already exists, the fields are identical and identically `readonly`, and the only consumer slices a `BranchPointFunction[]` straight in.
- Scope boundary: this is a pure type-aliasing cleanup in `scripts/drift-ai`; no runtime behavior, no Prisma/tRPC/socket surface. No migration.
- Double-check before merging: confirm no other package re-exports `BirthSizeDeltaComplexityFunction` (current `rg` shows none); if option 2's alias form is chosen, ensure the comment at line 65 still reads naturally above the surviving `BirthSizeDeltaComplexity` type.
