# 16 - Guide breadcrumbs and hook advisories

Status: Parked
Track: D (docs/feedforward)
Size: small-medium
Depends on: none
Blocks: none

## Goal

Make the highest-value task guides visible where agents edit: routers, socket,
rules, and e2e. Add advisory hook routing and matching `MODULE.md` breadcrumbs.

## Background

The review found that guides exist but are not spatially discoverable. This task
uses the existing protected-files advisory mechanism and adds non-hook
breadcrumbs for clients that do not receive the advisory.

## Seams to touch

- `scripts/ai-hooks/protected-files.sh`
- `scripts/ai-hooks/throttle-state.sh` if a new throttle key is needed.
- `scripts/ai-hooks/test.sh` or a focused protected-files test if one exists.
- Relevant `MODULE.md` files:
  - server routers area, if documented;
  - `packages/server/src/socket/MODULE.md`;
  - shared rules area docs, if documented;
  - e2e docs or guide references.

## What to do

1. Add path advisories for:
   - `packages/server/src/routers/**` -> `docs/guides/add-trpc-procedure.md`;
   - `packages/server/src/socket/**` -> `docs/guides/add-socket-broadcast.md`;
   - `packages/shared/src/rules/**` -> `docs/guides/change-rules-logic.md`;
   - `e2e/**` -> `docs/guides/add-e2e-test.md`.
2. Add advisory-only tamper guidance for `lint-ratchet.baseline.json`,
   `eslint.config.js`, and suppression registers. Do not hard-block.
3. Add one-line `See: docs/guides/...` breadcrumbs to the nearest module or area
   docs for the same surfaces.
4. Keep advisories throttled so one session does not get spammed.

## Testing

- Focused hook tests for each new path advisory and tamper advisory.
- `bash scripts/ai-hooks/test.sh` if using the aggregate suite.
- `bun run module:index:check` if module docs change.

## Out of scope

- Injecting full guide contents into context.
- Blocking edits to lint configs.
- Building `docs:intel`.
