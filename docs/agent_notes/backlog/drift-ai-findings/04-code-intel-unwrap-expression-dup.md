# 04. Identical unwrapExpression ts-morph helper duplicated in overview-call-targets.ts and overview-query.ts

Status: ✅ Implemented on `chore/driftai-audit` (2026-06-13); verified present in the live tree. The body below is the original finding — its cited line numbers predate the fix.
Theme: duplication · Area: tooling · Severity: quality-med · Size: XS

Source: drift:ai near-duplicates-2 + clone-candidates (drift-baseline; same pair merged) · Confidence: med

## Problem
`unwrapExpression` — a ts-morph helper that peels transparent `As`/`NonNull`/`Parenthesized`/`Satisfies` wrappers off an `Expression` via a `while` loop — is defined **byte-for-byte identically** in two sibling files:

`scripts/code-intel/overview-call-targets.ts:181-192` and `scripts/code-intel/overview-query.ts:209-220`, both:

```ts
function unwrapExpression(expression: Expression): Expression {
  let current = expression;
  while (
    MorphNode.isAsExpression(current) ||
    MorphNode.isNonNullExpression(current) ||
    MorphNode.isParenthesizedExpression(current) ||
    MorphNode.isSatisfiesExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
}
```

This is the exact maintenance hazard that warrants centralization: if ts-morph gains another transparent wrapper kind (or the set is otherwise tweaked) and only one copy is updated, the two AST-overview passes silently disagree about what a call expression "really is." The helper is load-bearing in both files — `overview-query.ts` calls it at 5 sites (lines 62, 132, 151, 157, 177) and `overview-call-targets.ts` at line 69 — so divergence would skew real overview output, not dead code. The directory already establishes the dedup pattern: `declaration-utils.ts` exports `declarationSpace` and is imported by `definition-query.ts` and `export-query.ts`. This helper has no home only by omission.

## Evidence
- `scripts/code-intel/overview-call-targets.ts:181-192` — `unwrapExpression` definition (confirmed current).
- `scripts/code-intel/overview-query.ts:209-220` — byte-identical `unwrapExpression` definition (confirmed current).
- `scripts/code-intel/overview-call-targets.ts:69` / `overview-query.ts:62,132,151,157,177` — six live call sites across the two files; both import `Expression` (type) and `Node as MorphNode` from `ts-morph`.
- `scripts/code-intel/declaration-utils.ts:5` — existing shared-helper precedent (`declarationSpace`), imported via `./declaration-utils.js` by `definition-query.ts:4` and `export-query.ts:3`.
- `scripts/code-intel.test.ts` — existing integration test exercising the code-intel CLI (no unit test isolates these overview modules).

## Proposed fix
1. Add `export function unwrapExpression(expression: Expression): Expression` to a shared code-intel util. Either extend `scripts/code-intel/declaration-utils.ts` (it already imports `Node` from `ts-morph`; add the `Expression` type import) or, if scoping it away from declaration concerns reads cleaner, create `scripts/code-intel/morph-utils.ts`. Prefer the latter only if a reviewer objects to mixing expression-walking into "declaration" utils; `declaration-utils.ts` is the lower-friction choice.
2. Replace both local `unwrapExpression` definitions with `import { unwrapExpression } from "./declaration-utils.js";` (note the `.js` ESM-extension convention used throughout this dir).
3. After removal, drop the now-unused `Expression` type import from whichever file no longer references it directly — verify with the compiler, since both files still pass `Expression`-typed values to the imported helper and may retain the type elsewhere.
4. Per repo TDD norm: extend `scripts/code-intel.test.ts` (or add a focused unit test beside the new util) asserting `unwrapExpression` strips a chained `(x as T)!` / `satisfies` wrapper down to the inner identifier — a regression net the current duplicated copies lack. Run with `bun run test:scripts:file -- scripts/code-intel.test.ts`.

## Verification / caveats
- False-positive risk is low: the bodies are confirmed identical and both import the same `MorphNode`/`Expression` symbols, so a single shared definition compiles against both call sites unchanged. Zero behavior change expected.
- Scope boundary: this is the only duplicated helper in the pair — do not opportunistically fold in `sortedUnique` (overview-call-targets.ts:194) or the `isProcedureKind`/broadcast predicates, which are not duplicated and are domain-specific to their files.
- Double-check before centralizing: confirm `overview-query.ts` and `overview-call-targets.ts` do not depend on `unwrapExpression` having module-private visibility (they don't — it's a pure function with no closure capture). Also re-run the full code-intel integration test, since these modules feed CLI overview output consumed elsewhere.
- This is a genuine dedup, not a lint-suppression case; a code change (shared export) is the right call.
