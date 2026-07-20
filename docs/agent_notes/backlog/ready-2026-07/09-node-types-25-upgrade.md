# @types/node 25 Upgrade

Status: Done — implemented 2026-07-20 on `auto/ready-b-deps20`; Node 25 adds no typecheck regression
Date: 2026-05-28

## Why Parked

`@types/node` 25 is a major ambient type upgrade. Musi runs on Bun, but many
scripts, configs, tests, and server files use Node-compatible built-in modules,
so a type-only major can still create broad compile fallout.

## Current Footprint

- Root dev dependency: `@types/node` 24.12.4.
- Explicit `types` references:
  - `tsconfig.configs.json` uses `["node"]`.
  - `tsconfig.e2e.json` uses `["node", "@playwright/test"]`.
- Many scripts and tests import `node:*` built-ins. Server runtime code also
  uses Node-compatible modules through Bun.

## Plan

1. Review the Node 25 type release notes and compatibility notes before
   updating.
2. Keep this as a type-only dependency change; do not combine with TypeScript 6
   or runtime Node/Bun changes.
3. Update `@types/node`, run `bun install`, and inspect compile failures before
   changing code.
4. Prefer narrow type fixes over changing runtime behavior. Treat changed
   overloads for `fs`, `net`, `child_process`, timers, URL, and process APIs as
   boundary cleanups.
5. If Bun-specific runtime assumptions conflict with Node 25 types, document
   the reason and pin or narrow types rather than masking with broad casts.

## Risk Areas

- Type changes may surface mostly in scripts and config files, not product
  source.
- E2E config and Playwright setup read both Node and Playwright globals.
- `NodeJS.ErrnoException` and timer/socket types are used in daemon and process
  helpers; these are common breakpoints for major Node type updates.

## Verification

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `bun run test:scripts`
- `bun run lint`
- `bun run build`
- `bun run e2e -- --list`
- `bun run verify:changed`

### 2026-07-20 verification-coverage follow-up

- `bun run worktree:init` passed and regenerated the secondary-worktree
  environment before the E2E checks.
- `bun run typecheck` passed. Its root `tsc -b` project references cover
  `packages/shared`, `packages/server`, `packages/client`, and
  `tools/lint-ratchet`; it also passed `tsconfig.scripts.json` and
  `tsconfig.eslint-js.json`.
- `bunx tsc -p tsconfig.e2e.json` passed with root `@types/node` 25.9.5.
- `bunx tsc -p tsconfig.configs.json` compiled the explicit configs surface
  with root `@types/node` 25.9.5, but reported the five existing TS2769
  diagnostics for `coverage` in the client, server, shared, scripts, and lint
  ratchet Vitest project configs. The same command, with `typeRoots` redirected
  to the base's cached `@types/node` 24.12.4, reported the identical five
  diagnostics. Vitest 4.1.7 excludes `coverage` from its `ProjectConfig`, so
  these diagnostics are pre-existing config-project debt rather than Node 25
  fallout; B20 does not alter the base-owned Vitest configs.
- After exporting the generated root `.env`, `bun run e2e -- --list` passed and
  listed 131 tests in 21 files. Running the command without exporting `.env`
  still exits 1 in this secondary worktree because the Node-based Playwright
  process does not receive the generated `SERVER_PORT`.
- No Node 25 compatibility code change was needed.
