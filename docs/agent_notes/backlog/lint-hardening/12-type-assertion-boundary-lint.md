# Leaf 12: Type-Assertion Boundary Lint

Status: Pass C landed (2026-05-17); `local/type-assertion-boundary`
at error for `e2e/**/*.ts` and linted scripts subset. 321 remaining
packages/* findings deferred to future leaves.
Depends on: Leaf 1
Related: Leaf 11's sanctioned-path pattern

Dependency detail: Leaf 1 gives this local rule a deterministic adoption gate
after the inventory is clean. Before Leaf 1, use report-only output or a
throwaway lint config for inventory; do not land warning-only enforcement.

## Problem

AGENTS.md allows type assertions only at framework, JSON, Prisma, and test
boundaries, or for `as const`, with a reason when the boundary is not obvious.
Today this is policy only — no lint enforces it, and the codebase contains a
mix of legitimate boundary casts and AI-introduced `as Foo` shortcut casts that
hide real type bugs.

This is a high-value AI footgun to catch.

## Rule Shape

This needs to be a local ESLint rule. Stock `no-restricted-syntax` can find
assertion nodes, but it cannot cleanly parse nearby reason comments,
differentiate sanctioned boundary contexts, and report the allowlist reason for
each matched file or expression.

Target:

- `TSAsExpression`;
- `TSTypeAssertion`;
- always allow `as const`.

Allow sanctioned boundary contexts:

- Prisma client result shapes;
- `JSON.parse` results;
- `req.body` / `req.params` in framework glue;
- mock construction in `*.test.ts` / `*.test.tsx`;
- explicit justified casts with a parseable nearby `reason` comment.

Start with a strict allowlist of file-path globs, similar to the existing
`e2ePreferRoleSelectorAllowlist` in `eslint.config.js`, so diagnostics always
name why the boundary is sanctioned.

Pair with the existing `no-explicit-any` rule. Together they cover the two
common type-escape hatches.

## Required Reason Syntax

Decide and fixture the reason syntax before inventory cleanup starts. Use this
parseable comment form for explicit justified casts outside the automatic
allowlist:

```ts
// type-assertion-boundary: <category> - <specific reason>
const value = source as TargetType;
```

Allowed categories:

- `framework` — framework glue such as route params or request bodies after
  the framework boundary has already validated shape.
- `json` — `JSON.parse` or JSON-compatible data crossing a schema/validation
  boundary.
- `prisma` — Prisma result shapes or generated-client boundary cases.
- `test` — test mock construction where the mock intentionally provides a
  partial contract.
- `interop` — external library boundary where upstream types are unavailable
  or wrong and a local wrapper is the narrowest fix.

Valid fixture examples should include `as const`, each allowed category above,
and an allowlisted path. Invalid fixture examples should include bare
`value as Foo`, vague reasons such as "make TS happy", unknown categories, and
comments separated from the assertion by unrelated code.

## Rollout

1. Add valid and invalid fixtures for the reason syntax before inventory.
2. Inventory current `as X` usage by package with `rg` and a small AST script.
3. Classify assertions into Prisma/JSON/framework boundary, test mock
   construction, `as const`, and shortcut casts.
4. Build the allowlist from legitimate boundary and test casts before turning
   on the rule.
5. Run report-only first and publish the shortcut-cast inventory.
6. Land cleanups for shortcut casts in package-scoped follow-ups.
7. Promote to `error` once the inventory is empty or every remaining cast has a
   justifying comment that the rule can parse.

## Exit Criteria

This leaf is complete when one of these outcomes is recorded:

- **Adopted as `error`** for a narrow first scope where all remaining
  assertions are `as const`, allowlisted boundaries, or parseably justified
  comments.
- **Adopted report-only** with a published inventory grouped by package and a
  named cleanup follow-up for the first package or assertion family.
- **Deferred after inventory** when shortcut casts are too numerous to clean
  in one focused slice, the sanctioned boundary categories are incomplete, or
  more than one package needs unrelated refactors before the rule can be
  trusted.

Stop the leaf rather than expanding scope if cleanup crosses unrelated package
boundaries, if the allowlist starts encoding individual convenience casts, or
if diagnostics cannot name the boundary category and repair action.

## Dependency Notes

This leaf benefits from Leaf 11 establishing the named-sanctioned-path pattern,
but it can move ahead if Leaf 11 stalls. Its sanctioned-path pattern can live
inside the rule's allowlist and reason parsing.

## Verification

- `rg` inventory plus any AST inventory tests.
- `bun run vitest run --project=eslint-rules`
- `bun run lint -- --max-warnings=0`
- `bun run verify:changed`
- If any category, path family, or assertion shape is deferred, scoped, or
  fully adopted with caveats, append a row to `evaluation-verdicts.md` before
  closing the leaf.
