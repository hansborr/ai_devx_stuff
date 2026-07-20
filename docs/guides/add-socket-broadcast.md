# Add A Socket Broadcast

Use this path for server-to-client events whose payload and delivery policy
belong at the socket broadcast boundary.

The enforced post-commit registry boundary is ADR-0003:
`docs/adr/0003-socket-broadcasts-after-commit.md`.

1. Add or reuse a shared socket event schema in `packages/shared/src/schemas/`.
2. Register the event in `packages/server/src/socket/broadcast-registry.ts`.
   The registry entry owns the shared schema, room policy, low-cardinality log
   fields, and the literal typed emit.
3. Add or adjust the narrow family helper in `packages/server/src/socket/`,
   for example `encounter-broadcast.ts`, `character-broadcast.ts`, or
   `map-broadcast.ts`. Call `broadcast(...)` or `broadcastToUsers(...)` from
   that helper instead of calling `.emit(...)` directly outside the registry.
4. Persist through tRPC or the relevant service first.
5. Broadcast only after the committed write has succeeded.
6. Pass `ctx.logger` or the request logger through to the helper so
   `logBroadcast` is emitted at the registry boundary.
7. Add tests for shared schema validation, room or user delivery policy, and
   the calling mutation's broadcast side effect.

Direct emits of registry-owned events such as `"encounter:updated"` and
`"map:tokenUpdated"` are blocked outside `broadcast-registry.ts` by the local
ESLint rule `socket-registry-broadcasts`.
Broadcast helper calls inside Prisma `$transaction` callbacks are blocked by
`local/no-broadcast-in-transaction`; return committed data from the transaction
and broadcast after it resolves.
