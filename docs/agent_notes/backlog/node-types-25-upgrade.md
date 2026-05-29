# @types/node 25 Upgrade

Status: Backlog
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
