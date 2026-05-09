# Server Socket Emit Inventory

DX5.3a deliverable, closed at DX5.3f. Scoped the broadcast registry across
DX5.3b-DX5.3f. The inventory itself is recoverable via grep; what is durable
here is the classification, the registry-scope decision, and the explicit
"intentionally outside the registry" parking for the remaining direct emits.

Re-grep before reusing this classification:

```sh
rg -n "\.emit\(" packages/server/src -g "*.ts" -g "!*test.ts"
```

`*.test.ts` matches are client-side test drivers (e.g. `socket.emit("ping")`,
`socket.emit("campaign:join", ...)`); ignore them for this inventory.

## Final state at DX5.3f

The registry owns six events end-to-end. Every other server-side emit is
intentionally outside the boundary, in its owning module. Per-family adapter
helpers (`broadcastCampaignUpdate`, `broadcastCharacterUpdate`,
`broadcastEncounterUpdate`, `broadcastMapTokenUpdate`,
`broadcastMapLayerUpdate`, `broadcastChatMessage`) sit on top of the registry
as stable call sites and were kept under DX5.3c's "preserve clearer imports"
rule; nothing was unused at DX5.3f cleanup time.

## Classification

### Registry-owned (domain mutation / chat broadcasts)

All six events emit through `socket/broadcast-registry.ts`. The five
domain-mutation variants share `io.to(campaignRoom(id)).emit(event, payload)`
after a committed mutation; `chat:newMessage` adds an optional per-socket
recipient filter for whisper routing.

| Event              | Adapter                                                  | Notes                       |
| ------------------ | -------------------------------------------------------- | --------------------------- |
| `campaign:updated` | `socket/campaign-broadcast.ts`                           | DX5.3b landed (registry).   |
| `character:updated`| `socket/character-broadcast.ts`                          | DX5.3c landed (registry).   |
| `encounter:updated`| `socket/encounter-broadcast.ts`                          | DX5.3c landed (registry).   |
| `map:tokenUpdated` | `socket/map-broadcast.ts`                                | DX5.3c landed (registry).   |
| `map:layerUpdated` | `socket/map-broadcast.ts`                                | DX5.3c landed (registry).   |
| `chat:newMessage`  | `socket/chat-broadcast.ts` (whisper) + registry direct   | DX5.3d landed (registry).   |

`services/encounter-combat/broadcast-helpers.ts` (combat fan-out, DX5.3e
landed) calls `broadcast(io, "encounter:updated", ...)` directly and reuses
`emitCharacterUpdate` and `broadcastCombatChat` for character invalidation
and combat-chat fan-out. `broadcastCombatChat` persists via
`persistCombatChat` and emits via `broadcastChatMessage`, keeping the
DB-write half visibly in the service layer and the emit half on the
registry.

### Intentionally outside the registry boundary

Re-checked at DX5.3f. None of these belong on the registry in the DX5.3
scope; each is in its owning module by design. A future leaf may revisit if
the registry grows a user-targeted delivery model or absorbs the connection
envelope.

#### Presence-owned

Tied to room join/leave/heartbeat lifecycle, not to domain mutations. Live in
`campaign-room-handler.ts`.

| Event                    | Sites                                                                      |
| ------------------------ | -------------------------------------------------------------------------- |
| `presence:update`        | `campaign-room-handler.ts:104` (join ack, self-targeted)                   |
| `presence:userJoined`    | `campaign-room-handler.ts:110`                                             |
| `presence:userLeft`      | `campaign-room-handler.ts:61` (heartbeat eviction), `:135` (leave), `:165` (disconnect) |
| `campaign:playerJoined`  | `campaign-room-handler.ts:111`                                             |
| `campaign:playerLeft`    | `campaign-room-handler.ts:62`, `:136`, `:166` paired with `presence:userLeft` |

`campaign:player{Joined,Left}` sit in the campaign namespace by name but are
emitted only from presence transitions, paired one-for-one with the
`presence:user*` events. They are presence-owned, not registry-owned.

#### Registry-owned user-targeted delivery

| Event              | Site                                | Notes                                                  |
| ------------------ | ----------------------------------- | ------------------------------------------------------ |
| `notification:new` | `socket/broadcast-registry.ts` via `services/notification-service.ts` | Per-user multi-tab fan-out now routes through the registry with a global recipient-filtered policy that fetches all connected sockets instead of resolving a campaign room. |

#### Control / error-only

Connection envelope, owned by `connection-handler.ts`. Lifecycle events on a
single socket, not domain broadcasts.

| Event   | Sites                                              |
| ------- | -------------------------------------------------- |
| `pong`  | `connection-handler.ts:22` (initial), `:35` (ping) |
| `error` | `connection-handler.ts:48`                         |

## Registry scope rationale

The registry owns **domain mutation broadcasts plus `chat:newMessage`**:

1. The five domain-mutation events (`campaign:updated`, `character:updated`,
   `encounter:updated`, `map:tokenUpdated`, `map:layerUpdated`) share an
   identical shape — `io.to(campaignRoom(id)).emit(event, payload)` after a
   committed mutation. They were the cheapest proving ground.
2. `chat:newMessage` is a domain broadcast with the same room-targeted
   contract as the rest, but with whisper routing layered on top. DX5.3d
   kept it inside the registry boundary so the registry expresses
   "broadcast to room with optional per-socket recipient filter" exactly
   once instead of inventing it ad hoc later.
3. The combat fan-out helper composes registry-owned helpers; DX5.3e
   landed by routing the encounter emit directly through `broadcast(...)`
   and splitting `combat-chat` into a service-layer `persistCombatChat`
   plus a registry-owned `broadcastChatMessage` step.

## Whisper routing note (DX5.3d)

`chat-broadcast.ts` emits per-socket through `broadcastToUsers` in the
registry, filtering by `authorId | recipientId | dmUserId`. The registry's
emit-policy abstraction supports "to room" plus "to room, filtered to these
user ids" without leaking the per-socket loop into the call site. DX5.3d's
coverage requirement (room-wide chat + whisper recipient routing) is the
test that the registry models this correctly.
