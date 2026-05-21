# Leaf 41 Root/Package TS Config Coverage

Date: 2026-05-21

## Summary

Sub-batch B brought the maintained root/package TS config files under normal
ESLint:

- `knip.config.ts`
- `playwright.config.ts`
- `vitest.config.ts`
- `vitest.slow.config.ts`
- `packages/client/vite.config.ts`
- `packages/client/vitest.config.ts`
- `packages/server/prisma.config.ts`
- `packages/server/vitest.config.ts`
- `packages/shared/vitest.config.ts`
- `scripts/vitest.config.ts`
- `eslint-rules/vitest.config.ts`

The batch added `tsconfig.configs.json` as a dedicated parser project and an
ESLint block that uses project service for those exact files while leaving
`local/max-lines` disabled. Exact re-includes keep the global
`**/*.config.{js,mjs,ts}` ignore intact, including later re-includes for
`scripts/vitest.config.ts` and `eslint-rules/vitest.config.ts`.

## Findings

- `simple-import-sort/imports`: 3 findings, autofixed in
  `packages/client/vite.config.ts`, `packages/client/vitest.config.ts`, and
  `vitest.slow.config.ts`.
- `no-magic-numbers`: 1 finding in `playwright.config.ts`, handled by adding
  `CI_RETRIES`.
- `@typescript-eslint/no-misused-spread` / `@typescript-eslint/no-misused-promises`:
  6 paired findings in `vitest.slow.config.ts`, handled by awaiting the imported
  per-package project configs before spreading them.
- No ratchet or baseline update was needed.

Changed-gate relevance now explicitly covers `knip.config.*`,
`playwright.config.*`, root `prisma.config.*`, and package
`packages/*/prisma.config.*`; `scripts/test-verify.sh` covers the new paths.

## Verification

- `bun run lint -- --max-warnings=0`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run docs:lint-coverage-map:check`
- `bash scripts/test-verify.sh`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bash scripts/test-harness-check.sh`
- `bun run typecheck`
- Extra config-load check: `bun run test:slow -- --project=shared --testNamePattern=__codex_no_match__`

The Root/package config block is now done.
