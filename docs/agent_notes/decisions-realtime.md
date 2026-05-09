# Decisions — realtime

Realtime-domain entries split out of `DECISIONS.md` once it crossed ~400
lines. See `DECISIONS.md` for the full preamble (when to read, when to add,
entry template) and the index of domain files.

---

## Presence: socket-scoped via `io.in(room).fetchSockets()`, not per-user counter

Status: Active
Domain: realtime

### Context
The original presence implementation kept an in-memory map of
`userId → count` and incremented/decremented on connect/disconnect. It
broke with multi-tab: closing one tab decremented the user to zero even
though another tab was still open, and Redis-adapter crashes stranded
counts above zero forever.

### Decision
Presence is derived on demand from socket membership:
`io.in(`campaign:${id}`).fetchSockets()` returns live sockets; map to
distinct user IDs. No stored counters, no reconciliation job.

### Consequences
- Presence queries cost one Redis round-trip per call — fine for current
  scale, revisit if presence becomes hot.
- Any new "who's in this room" feature reuses the same derivation — do
  not add parallel counter state.
- Tests that want deterministic presence need to control socket
  connections, not mock a counter.

### References
- `packages/server/src/services/presence-multi-tab.test.ts`
- `docs/socket-architecture.md`

---

## Socket.io does not write

Status: Active
Domain: realtime

### Context
Early real-time features were tempted to handle writes directly in
socket handlers (ack-based mutations, etc.). This bypasses tRPC's
validation, auth context, and output schemas — and forks the audit/log
story across two protocols.

### Decision
tRPC owns every mutation and query. Socket.io is a broadcast-only
channel: the mutation persists → server emits → other clients invalidate
TanStack Query caches and re-read via tRPC. No validation, no auth
decisions, no DB writes in socket handlers.

### Consequences
- A new real-time feature = new tRPC mutation + server-side broadcast +
  client-side cache invalidation. Do not add a socket-only write path
  "for latency."
- Broadcast payloads should be small — the canonical data lives in the
  query result, not the socket event.

### References
- `docs/socket-architecture.md`
- `AGENTS.md` realtime guidance
