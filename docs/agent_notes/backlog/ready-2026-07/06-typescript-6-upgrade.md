# TypeScript 6 Upgrade

Status: Done — implemented and verified 2026-07-19 on `auto/ready-b-ts6`
Date: 2026-05-28

## Why Parked

The dependency refresh updated TypeScript within 5.x. TypeScript 6 is a major
compiler upgrade and should be handled alone so compiler behavior changes are
not confused with ESLint 10, Node type, or runtime dependency migrations.

## Current Footprint

- Root dev dependency: `typescript` 5.9.3.
- Base compiler config: `tsconfig.base.json`.
- Project references: root `tsconfig.json` plus package configs under
  `packages/{shared,server,client}` and script/e2e configs.
- TypeScript API consumers: `scripts/code-intel/**`, lint-ratchet helpers,
  codemods, and `ts-morph`.
- Type-aware ESLint depends on `typescript-eslint`, so confirm parser support
  before running a full lint gate on TypeScript 6.

## Plan

1. Read the official TypeScript 6.0 release notes before changing dependencies.
2. Run a baseline `bun run typecheck` and `bun run build`.
3. Upgrade only `typescript` first. Do not combine with ESLint 10 or
   `@types/node` 25 unless TypeScript 6 explicitly requires it.
4. If `typescript-eslint` warns about unsupported compiler versions, decide
   whether to pause or do a narrowly documented companion bump.
5. Fix compile errors in package flow order: shared, server, then client.
6. Run script tests because code-intel and codemod utilities use TypeScript
   compiler APIs.
7. Update docs only if compiler invocation, supported TypeScript version, or
   code-intel behavior changes.

## Risk Areas

- `verbatimModuleSyntax`, `Node16` module resolution, project references, and
  declaration emit can expose different errors across packages.
- TypeScript API changes can break code-intel and codemod scripts even when app
  source compiles.
- New compiler diagnostics may overlap with existing ESLint rules. Prefer
  code fixes over disabling diagnostics.
- `skipLibCheck` is enabled, so third-party type breakage may only surface at
  direct use sites.

## Verification

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `bun run build`
- `bun run test:scripts`
- `bun run test`
- `bun run lint`
- `bun run code:intel -- exports packages/shared/src/index.ts`
- `bun run verify:changed`
