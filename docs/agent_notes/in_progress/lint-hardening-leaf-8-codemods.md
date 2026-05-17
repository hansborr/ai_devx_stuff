# Leaf 8 Codemods ESLint Coverage Inventory

Status: stopped by slice flood threshold on 2026-05-16.

## Probe

Temporarily changed `eslint.config.js` to:

- re-include `scripts/codemods/` and `scripts/codemods/**/*.ts` after the
  broad `scripts/**/*` ignore;
- keep `scripts/codemods/fixtures/**` ignored;
- add a `scripts/codemods/**/*.ts` project block pointing at
  `./tsconfig.scripts.json`, analogous to `scripts/code-intel/**/*.ts`.

Then ran:

```bash
bun run lint -- --max-warnings=0
```

The probe produced 70 findings: 59 errors and 11 warnings. Of the 59 errors,
16 are `eslint --fix`-able (mostly `simple-import-sort/imports` and
`@typescript-eslint/consistent-type-imports`); the remaining 43 errors and 11
warnings are the structural categories below. The total exceeds the slice
stop threshold, and the dominant non-autofix categories are implementation
shape pressure rather than incidental cleanup, so no partial fixes were made
and the temporary config change was reverted.

## Findings By Rule

- `complexity`: 17 errors.
- `no-magic-numbers`: 11 warnings.
- `@typescript-eslint/no-confusing-void-expression`: 7 errors.
- `@typescript-eslint/only-throw-error`: 7 errors.
- `max-params`: 6 errors.
- `local/max-lines`: 5 errors.
- `@typescript-eslint/consistent-type-imports`: 5 errors.
- `vitest/expect-expect`: 5 errors.
- `simple-import-sort/imports`: 4 errors.
- `@typescript-eslint/restrict-template-expressions`: 2 errors.
- `no-nested-ternary`: 1 error.

## Largest Implementation Categories

- Large codemod modules exceed the shared 300 effective-line cap:
  `concurrency-guard.ts` (805), `expand-barrel.ts` (1027),
  `structured-logging-fix.ts` (492), `trpc-shared-input.ts` (347), and
  `trpc-shared-output.ts` (354).
- Several codemod parser/transform helpers exceed complexity or parameter
  limits, especially `expand-barrel.ts`, `concurrency-guard.ts`,
  `structured-logging-fix.ts`, and the tRPC shared schema codemods.
- Test harnesses share a failure pattern around captured errors and command
  runners: void-expression shorthand callbacks, throwing non-`Error` values,
  and tests without explicit assertions.
- Smaller incidental work remains: import sorting/type imports, two numeric
  template literal conversions, one nested ternary, and warning-level magic
  numbers.

## Follow-Up Shape

Do not re-enable codemod ESLint coverage as one broad slice without first
choosing a cleanup strategy. Reasonable follow-up slices are:

- split/factor the largest codemod modules enough to satisfy existing shared
  caps;
- fix the repeated test harness assertion/error-shape pattern across all
  codemod tests;
- handle import/type-import/autofixable cleanup as a separate mechanical
  commit once the shape work is planned (the autofix subset on its own
  would not unblock coverage because the 28 hard structural errors remain
  blockers; running `--fix` first only shrinks the noise during the
  structural pass);
- only after the above, re-add the codemod project block and decide whether
  any tightly scoped config caps are still warranted.
