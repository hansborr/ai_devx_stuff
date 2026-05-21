# local/type-assertion-boundary Batch 4a

Completed: 2026-05-19
Scope: Leaf 07 server one-count framework/test boundary drain

## Result

Drained six server-side ratchet findings. The cold `lint:ratchet` run reports
91 current findings after clearing `node_modules/.cache/eslint-ratchet`.

## Files

- `packages/server/src/utils/socket-helpers.ts`: labeled the guarded Fastify
  socket server decorator assertion as a framework boundary.
- `packages/server/src/socket/auth-middleware.ts`: labeled the Socket.io
  `handshake.auth` token read as a framework boundary.
- `packages/server/src/utils/character-campaign.ts`: labeled the Fastify
  fallback logging accessor assertion as a framework boundary.
- `packages/server/src/test/character-fixtures.ts`: labeled the test-only tRPC
  create-character response envelope unwrap.
- `packages/server/src/test/trpc-helpers.ts`: labeled the generic test-only
  tRPC response envelope unwrapper.
- `packages/server/src/utils/map-helpers.ts`: replaced the map layer Prisma
  JSON cast with `fromJson<Record<string, unknown>>(l.data, {})`.

## Verification

- `bun run lint:fix`
- `rm -rf node_modules/.cache/eslint-ratchet && bun run lint:ratchet`
- `bun run typecheck`
- `bun run test:changed`
