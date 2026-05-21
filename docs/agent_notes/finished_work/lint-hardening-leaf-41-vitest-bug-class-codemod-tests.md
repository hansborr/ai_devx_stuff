# Leaf 41 Batch 4a: Vitest Bug-Class Codemod Test Ratchets

Date: 2026-05-20

## Summary

Added `@vitest/eslint-plugin` to the lint ratchet third-party plugin allowlist
under the `vitest` namespace with `pluginExport: "default"`, matching the
default import shape used by `eslint.config.js` and the ratchet runner's
default-import generation.

Added two `minimal-ts` ratchets scoped to the four Leaf 35 codemod test-harness
files:

- `ratchet/vitest-expect-expect-codemod-tests`
- `ratchet/vitest-valid-expect-codemod-tests`

Both entries use explicit file literals for:

- `scripts/codemods/concurrency-guard.test.ts`
- `scripts/codemods/expand-barrel.test.ts`
- `scripts/codemods/structured-logging-fix.test.ts`
- `scripts/codemods/trpc-shared-schema-codemod.test.ts`

The entries mirror `eslint.config.js`'s `vitest/expect-expect`
`assertFunctionNames` allowlist and `vitest/valid-expect` `{ maxArgs: 2 }`
option.

The initial `vitest/expect-expect` baseline captured five current findings:

- `scripts/codemods/concurrency-guard.test.ts`: 1
- `scripts/codemods/expand-barrel.test.ts`: 1
- `scripts/codemods/structured-logging-fix.test.ts`: 1
- `scripts/codemods/trpc-shared-schema-codemod.test.ts`: 2

The initial `vitest/valid-expect` baseline captured zero current findings. A
zero-finding probe temporarily added an unchained `expect(1)` to
`scripts/codemods/concurrency-guard.test.ts`; `bun run lint:ratchet` reported
the violation under `ratchet/vitest-valid-expect-codemod-tests`, and the probe
was reverted before re-running `bun run lint:ratchet:update`.

The coverage map's Leaf 35 codemod test-harness row now points to both Vitest
ratchets while leaving the type-aware `@typescript-eslint/only-throw-error` and
`@typescript-eslint/no-misused-promises` bug-class rules proposed for Batch 4b.
The harness controls manifest and generated controls doc were refreshed for the
two new ratchet controls, and the harness-check smoke fixture was kept in
parity with the copied live ratchet registry.

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
