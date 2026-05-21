---
leaf: lint-hardening/19 (probe deferral)
status: deferred
recorded: 2026-05-19
parent_branch: feature/lint-hardening-review-followup
---

# Leaf 19 probe deferral: codemod test files

## Summary

Probed four `scripts/codemods/*.test.ts` files under the 300-line
`local/max-lines` ceiling, all already covered by
`tsconfig.scripts.json` via `scripts/codemods/**/*.ts`:

- `concurrency-guard.test.ts` (191 lines)
- `expand-barrel.test.ts` (194 lines)
- `structured-logging-fix.test.ts` (203 lines)
- `trpc-shared-schema-codemod.test.ts` (234 lines)

Full-repo lint with the four files unignored (and the parser-options
block extended to point them at `tsconfig.scripts.json`) produced
**20 errors total** across the four files. The findings repeat the
same shapes file-to-file:

- `@typescript-eslint/no-confusing-void-expression` — arrow functions
  returning a void expression (each file has 1–2 sites).
- `@typescript-eslint/only-throw-error` — `throw "string-literal"`
  instead of `throw new Error(...)` (each file has 1–2 sites).
- `vitest/expect-expect` — codemod-shape tests that call helpers
  without an `expect(...)` assertion at the call site (each file has
  1–2 sites).
- `simple-import-sort/imports` — autofixable reorder
  (`trpc-shared-schema-codemod.test.ts` only).

These are not mechanical: tightening braces around void-returning
arrow callbacks, switching to thrown Errors, and adding either
`expect(...)` assertions or `assertions` configuration changes test
semantics. Even the simple-import-sort autofix is a code change.

## Why deferred

Mirrors the slice 2 deferral and the slice 5 carve-outs: when the
gating change is more than a config-only ESLint adoption, leave it
for a leaf with explicit budget to make the wider call. Three
considerations made the deferral straightforward:

1. The `vitest/expect-expect` rule may have a sanctioned escape
   (decorating the helper itself with the `vitest/no-conditional-expect`
   pattern or configuring `expect-expect` to recognise the codemod's
   shape) — that policy belongs to a leaf with explicit budget.
2. The `only-throw-error` repair is mechanical but multiplies test
   surface; it should pair with codemod-side error-throwing review.
3. `no-confusing-void-expression` repairs need a quick review per
   site to confirm the brace addition doesn't alter behaviour.

The unused work branch
(`feature/lint-hardening-leaf-19-codemod-test-files`) was deleted;
no commits landed.

## Revisit

- Promote alongside Leaf 11 (`11-codemod-eslint-coverage.md`) when
  it gets explicit budget. Leaf 11 still parks the wider codemod
  coverage decision.
- Or, if a separate test-quality leaf (e.g., Leaf 10) gets explicit
  budget for the `vitest/expect-expect` policy, the codemod tests
  could ride along that decision.

## Cross-refs

- Backlog leaves:
  - `backlog/lint-followups/11-codemod-eslint-coverage.md`
  - `backlog/lint-followups/19-scripts-eslint-remaining-families.md`
- Verdict register: `backlog/lint-hardening/evaluation-verdicts.md`
- Sibling deferral:
  - `lint-hardening-leaf-19-scripts-top-level-non-scripts-tsconfig-deferral.md`
