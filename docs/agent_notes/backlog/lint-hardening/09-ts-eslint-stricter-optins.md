# Leaf 9: typescript-eslint Stricter Opt-Ins

Status: Pass A landed (2026-05-17); promise-function-async adopted at
`error`; strict-boolean-expressions deferred
Depends on: Leaf 1 (zero-warning gate)

Dependency detail: Leaf 1 is needed so stricter opt-ins either land as
enforced rules or stay report-only. Inventory before Leaf 1 should use a
throwaway config only; do not commit warning-severity migration pressure
without a named follow-up.

## Problem

`typescript-eslint` `strict-type-checked` already gives Musi a strong baseline
(`no-floating-promises`, `no-misused-promises`, `no-unnecessary-condition`,
`no-deprecated`, `no-unsafe-*`, `use-unknown-in-catch-callback-variable`,
etc.). A handful of additional opt-in rules sit *outside* `strict-type-checked`
and are high-value for catching AI mistakes that pass the type checker but
behave wrong at runtime.

## Candidate Rules

| Rule | Why |
|---|---|
| `@typescript-eslint/switch-exhaustiveness-check` | Musi has discriminated-union heavy domain code (rules, character states, encounter actions). AI routinely adds a new variant without updating every `switch`. This rule fires when a union case is missing and no `default` clause exists. |
| `@typescript-eslint/strict-boolean-expressions` | Catches `if (someString)` / `if (count)` / `if (maybeUndefined)` truthiness bugs. AI-generated null checks frequently rely on JS truthiness in ways that break for `0`, `""`, and other falsy-but-meaningful values. Expect noise on first run; consider package-scoped rollout (server-only first). |
| `@typescript-eslint/prefer-readonly` | Encourages `readonly` on class members never reassigned. Beginner-friendly because the auto-fix tells you exactly what is mutable when it should not be. |
| `@typescript-eslint/consistent-type-exports` | Pairs with the existing `consistent-type-imports`. Keeps type-only re-exports clean (matters more when other plugins start reading import graphs). |
| `@typescript-eslint/promise-function-async` | Reports functions that return a `Promise` but are not declared `async`. Surfaces accidental thenable returns. |

## Rollout

1. Before enabling `switch-exhaustiveness-check`, inventory discriminated-union
   `switch` statements that already have a `default` branch. The rule does not
   report missing cases when `default` exists, so decide whether each default
   should be removed, replaced with an `assertNever` helper, or documented as
   an intentional catch-all outside this rule's coverage.
2. Inventory each rule by adding it at `warn` to a throwaway config and
   running `bun run lint`. Dump the violations. The `warn` severity here is
   strictly local inventory scaffolding, not a committed state.
3. Decide per rule:
   - `switch-exhaustiveness-check`: enable globally at `error`. Expect a
     handful of legitimate misses.
   - `strict-boolean-expressions`: roll out per package (server, then shared,
     then client). Configure `allowString`, `allowNumber`, `allowNullableBoolean`
     thresholds based on the inventory.
   - `prefer-readonly`: enable globally at `error` after a single pass of
     auto-fix.
   - `consistent-type-exports`: enable globally at `error` after a single
     pass of auto-fix.
   - `promise-function-async`: landed in Pass A (2026-05-17) with three
     override blocks (test files, mock-trpc factories, dynamic-import
     loaders) plus ~22 production async additions. No overlap with
     existing `no-floating-promises` was observed in the inventory.
4. For each rule, document the diagnostic-to-fix mapping in
   `docs/ai-harness.md` if the standard message is not self-explanatory.

## Adaptation Policy

These are correctness rules — prefer fixing the code. Scope-silencing is
only appropriate for `strict-boolean-expressions` where a deliberate
truthiness check has a written rationale.

## Verification

- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- `bun run verify:changed`
- Targeted package tests for any production code reshaped.
- If any rule is rejected, deferred, subset-adopted, or fully adopted with
  caveats/scoped exceptions, append a row to `evaluation-verdicts.md` before
  closing the leaf.

## References

- [switch-exhaustiveness-check](https://typescript-eslint.io/rules/switch-exhaustiveness-check/)
- [strict-boolean-expressions](https://typescript-eslint.io/rules/strict-boolean-expressions/)
- [prefer-readonly](https://typescript-eslint.io/rules/prefer-readonly/)

## Implementation Result

Pass 2 landed three tractable opt-ins at `error`:

- `@typescript-eslint/consistent-type-exports`: 0 findings.
- `@typescript-eslint/prefer-readonly`: 17 findings fixed by `eslint --fix`
  across e2e page-object `page` fields and the client `ErrorBoundary`
  retry handler.
- `@typescript-eslint/switch-exhaustiveness-check`: 2 findings fixed.

Switch fix notes:

- `packages/server/scripts/pgexec.ts`: enumerated all eight `typeof` cases and
  kept the defensive `default` branch for script safety.
- `packages/client/src/components/character-create/wizard-state.ts`: reworked
  the reducer to split navigation actions through a `NavigationAction` type
  guard while retaining the existing exhaustive step-data switch.

Pass A landed `@typescript-eslint/promise-function-async` at `error`.

- Added three override blocks: test files (`**/*.{test,spec}.{ts,tsx}`),
  client tRPC mock factories (`packages/client/src/test/mock-trpc*.{ts,tsx}`),
  and dynamic-import loader callbacks (`packages/client/src/routes/**/*-route.ts`
  plus `packages/client/src/pages/character-sheet/sheet-dialogs.tsx`).
- After overrides, lint reported 87 remaining findings. The fix pass resolved
  20 server clean-db callbacks, 44 server router/SRD pass-throughs, 7
  interactive Prisma transaction callbacks, 2 fan-out sites, 3 server test
  helper callbacks, and 11 misc production/script one-offs.
- The pass used 84 `async` additions and 3 per-line disables with reasons: 1
  PrismaPromise array builder feeding `$transaction([...])` batching and 2
  cached in-flight promise helpers that intentionally return the stored Promise.
- Code/helper fixes touched 22 files outside docs/config (19 production/script
  files plus 3 server test-helper files).

Deferred:

- `@typescript-eslint/strict-boolean-expressions`: 423 findings; future work
  should review intent per package, starting with shared, then e2e/scripts, then
  smaller server/client slices.
