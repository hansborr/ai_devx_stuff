# Leaf 41 Batch 4b: TypeScript-ESLint Bug-Class Codemod Test Ratchets

Date: 2026-05-20

## Summary

Added two `type-aware-ts` ratchets scoped to the four Leaf 35 codemod
test-harness files:

- `ratchet/typescript-eslint-no-misused-promises-codemod-tests`
- `ratchet/typescript-eslint-only-throw-error-codemod-tests`

Both entries use explicit file literals for:

- `scripts/codemods/concurrency-guard.test.ts`
- `scripts/codemods/expand-barrel.test.ts`
- `scripts/codemods/structured-logging-fix.test.ts`
- `scripts/codemods/trpc-shared-schema-codemod.test.ts`

Both ratchets use `parserProfile: "type-aware-ts"` against the existing
`tsconfig.scripts.json` script project. A narrow
`scripts/codemods/tsconfig.json` now extends that scripts config and includes
only these four tests so TypeScript-ESLint project service can discover the
codemod test project from the files' directory.

The `eslint.config.js` lookup found no explicit non-default options for either
requested rule: the type-checked TypeScript preset is applied at the global
TypeScript layer, and the test-file overrides near the Vitest block only relax
other TypeScript rules or configure Vitest rules. The ratchets therefore use
empty `ruleOptions`.

The initial `@typescript-eslint/no-misused-promises` baseline captured zero
current findings. A zero-finding probe temporarily added an async callback to
`setTimeout` in `scripts/codemods/concurrency-guard.test.ts`;
`bun run lint:ratchet` reported the violation under
`ratchet/typescript-eslint-no-misused-promises-codemod-tests`, and the probe was
reverted before re-running `bun run lint:ratchet:update`.

The initial `@typescript-eslint/only-throw-error` baseline captured seven
current findings:

- `scripts/codemods/concurrency-guard.test.ts`: 1
- `scripts/codemods/expand-barrel.test.ts`: 2
- `scripts/codemods/structured-logging-fix.test.ts`: 2
- `scripts/codemods/trpc-shared-schema-codemod.test.ts`: 2

The coverage map's Leaf 35 codemod test-harness row now points to both
TypeScript-ESLint ratchets and has no remaining proposed bug-class rules.
The harness controls manifest, generated controls doc, and harness-check smoke
fixture were refreshed for the two new ratchet controls.

Exit path: drain the codemod test-harness bug-class findings to zero in Leaf
35, then move compatible coverage into normal lint or remove the temporary
ratchets once the main ESLint scope covers these files.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bash scripts/test-harness-check.sh`
