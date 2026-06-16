# Socket.io Architecture

This is the real-time rulebook for Musi. If a feature needs persistence, validation, or authorization decisions, start in tRPC, not Socket.io.

## Core Boundary

- tRPC owns queries and mutations.
- Socket handlers validate inbound payloads, manage room membership and presence, and broadcast already-persisted results.
- Client socket listeners invalidate TanStack Query caches or update ephemeral presence state.

The normal flow is:

1. Client calls a tRPC mutation.
2. Server validates and persists.
3. Server broadcasts to the campaign room.
4. Clients invalidate/refetch.

Use socket-only flows only for ephemeral concerns such as join/leave, ping, and presence heartbeat.

## Authentication

- The client sends the access token in `socket.handshake.auth.token`. For where that token comes from and how it is refreshed on the client, see `docs/guides/client-auth-session.md`.
- `socketAuthMiddleware` reuses `verifyAccessToken()`.
- On success, `socket.data.user` is populated with `{ id, email, displayName }`.
- On failure, the connection is rejected and the client sees `connect_error`.

## Rooms And Presence

- Room naming is `campaign:<campaignId>`.
- `campaign:join` validates the payload and requires live campaign membership.
- After join, the caller receives `presence:update` with the deduped online users in that room.
- Other clients receive `presence:userJoined` and `campaign:playerJoined` only once per user, even if that user has multiple tabs open.
- `campaign:leave` and `disconnecting` emit leave events only when the departing socket was that user's last socket in the room.
- `presence:heartbeat` revalidates membership. If a user was removed from the campaign, the server evicts the socket from the room and emits the usual leave events.
- Presence is derived from `io.in(room).fetchSockets()`, not from a separate Redis TTL store. `lastSeenAt` is written when the user's last socket leaves.

## Event Surface

Client -> server:

- `campaign:join`
- `campaign:leave`
- `presence:heartbeat`
- `ping`

Server -> client families:

- Presence: `presence:update`, `presence:userJoined`, `presence:userLeft`
- Campaign/meta: `campaign:playerJoined`, `campaign:playerLeft`, `campaign:updated`
- Entity invalidation: `character:updated`, `encounter:updated`, `map:tokenUpdated`, `map:layerUpdated`
- Chat/notifications: `chat:newMessage`, `notification:new`
- Misc: `error`, `pong`

All event schemas live in `@musi/shared/schemas/socket-events.ts`.

## Validation And Rate Limiting

- Every inbound payload is Zod-validated in the socket handlers before any work runs.
- Rate limiting is per-socket, in-memory, and enforced in middleware.
- Throttled requests surface through the `error` event with code `RATE_LIMIT`; other emitted socket errors use `INTERNAL_ERROR`.

## Redis Adapter

- Horizontal fan-out is enabled only when both `ENABLE_REDIS_ADAPTER=true` and `REDIS_URL` are set.
- Without that flag, Socket.io runs in single-instance mode.
- Presence logic works in both modes because it derives from room membership, not a separate store.

## Client Integration

- `packages/client/src/hooks/socket-context.tsx` owns the connection lifecycle and reconnect behavior.
- `useSocket()` exposes `socket`, `isConnected`, and `connectionError`.
- `packages/client/src/hooks/realtime-invalidation.ts` owns feature-level
  cache invalidation for campaign, encounter, map, and character-sheet socket
  events.
- `ConnectionStatus` stays hidden while connected and shows reconnect/disconnect state otherwise.

## File Map

- `packages/shared/src/schemas/socket-events.ts` — event contracts and room helpers
- `packages/server/src/socket/` — auth, join/leave, rate limiting, and broadcast entry points
- `packages/server/src/services/presence-service.ts` — derived online-user and `lastSeenAt` logic
- `packages/client/src/hooks/socket-context.tsx` — provider and auth-aware connection setup
- `packages/client/src/hooks/realtime-invalidation.ts` — cache invalidation listeners
- `packages/client/src/components/common/connection-status.tsx` — connection indicator UI
