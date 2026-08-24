# 8. The chat broadcast facade alone demands a concrete socket server and a caller-resolved room, so all seven call sites repeat policy the registry already owns

Status: Not started
Theme: broadcast facade consistency · Area: server · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The socket layer has five per-family broadcast facades over the broadcast
registry, and four of them share one shape: accept `AppSocketServer | null`,
take domain ids, and let the registry resolve the room, validate the payload,
and emit exactly one `socket.broadcast` outcome log — including the
`skipped` + `reason: no_socket_server` log when Socket.io is not running.
`broadcastChatMessage` is the lone outlier. It requires a **concrete**
`AppSocketServer` and a **caller-resolved** `room: string`, even though the
registry's shared chat contract already knows how to derive the campaign room
from the payload.

The cost lands on every caller. All seven production call sites re-derive
`campaignRoom(...)` from the same `campaignId` the payload already carries, and
all of them wrap the call in their own `if (io)` / `if (!params.io) return`
screen — seven copies of two decisions the registry entry points were built to
own. Worse, the guards structurally bypass the registry's skipped-outcome
logging: when sockets are disabled, the callers never reach
`broadcast`/`broadcastToUsers`, so the `no_socket_server` skipped log genuinely
never fires for chat. Chat is the one event family whose delivery observability
goes dark exactly in the environments (tests, scripts, socket-less servers)
that log was added for. A contributor copying a facade as the template for a
new event has a 1-in-5 chance of copying the wrong one.

## Evidence

- `packages/server/src/socket/chat-broadcast.ts:27-32` —
  `broadcastChatMessage(io: AppSocketServer, room: string, message, options)`:
  concrete server, caller-supplied room.
- The four sibling facade files all accept `AppSocketServer | null` and no room
  parameter: `packages/server/src/socket/campaign-broadcast.ts:15`,
  `encounter-broadcast.ts:14`, `character-broadcast.ts:14`, and
  `map-broadcast.ts:13` + `:29` (both map helpers).
- `packages/server/src/socket/broadcast-registry.ts:139-143` —
  `CHAT_MESSAGE_CONTRACT` already owns room derivation:
  `room: ({ campaignId }) => campaignRoom(campaignId)`.
- `packages/server/src/socket/broadcast-registry.ts:296-311` and `:323-338` —
  `broadcast` and `broadcastToUsers` both accept `io: AppSocketServer | null`
  and, on null, emit the skipped outcome log (`:305-307`, `:332-334`) with
  `reason: "no_socket_server"` (`:282`) before returning.
- `packages/server/src/socket/broadcast-registry.ts:168-174` — the registry
  doc-block's "Adding a registry event" step 2 prescribes exactly the sibling
  shape: a per-family helper whose body is one `broadcast(io, name, payload,
  { logger })` call.
- The 7 production call expressions (6 caller functions), each passing
  `campaignRoom(...)` and each behind a socket guard:
  - `packages/server/src/routers/dice.ts:69-72` — `if (io)` around the call.
  - `packages/server/src/routers/cast-spell.ts:90-93` — `if (io)`.
  - `packages/server/src/routers/chat.ts:40` — `if (!params.io) return;`
    ahead of the call at `:51` (and ahead of the whisper DM lookup at
    `:43-48`).
  - `packages/server/src/services/rest-service.ts:120-122` — `if (io)`.
  - `packages/server/src/utils/combat-chat.ts:83-85` and `:89-91` — two
    guarded calls in `broadcastCombatChat`, sharing `room` computed at `:80`.
  - `packages/server/src/services/character-live-state/feature.ts:95-98` —
    `if (io)`.
- `packages/server/src/socket/broadcast-registry.ts:237-244` — the whisper
  entry's `emitToUsers` already carries the fallback
  `room ?? CHAT_MESSAGE_CONTRACT.room(payload)` (`:244`); its comment
  ("`broadcastChatMessage` always supplies the room today; the shared resolver
  is a defensive default") describes the current outlier state and goes stale
  the moment this lands.

## Proposed direction

Align `broadcastChatMessage` with its four siblings: accept
`AppSocketServer | null`, drop the `room` parameter, derive the room from the
payload, and delete the caller-side socket guards.

1. **Change the facade signature**
   (`packages/server/src/socket/chat-broadcast.ts:27-32`) to
   `broadcastChatMessage(io: AppSocketServer | null, message, options)`. For
   the room-message branch, drop the explicit `room` and let
   `broadcast`'s registry entry resolve it (`broadcast-registry.ts:309`
   already falls back to `entry.room(validated)`); for the whisper branch,
   either pass no `room` and rely on the `emitToUsers` fallback at `:244`, or
   derive `campaignRoom(message.campaignId)` once in the facade — pick one and
   say so in the doc comment. This is behavior-preserving: all seven callers
   pass `campaignRoom(...)` of the same `campaignId` the payload carries, so
   registry-side derivation produces the identical room string.
2. **Delete the seven caller-side guards and room arguments** at the call
   sites listed in Evidence, passing the possibly-null `io` straight through
   so the registry's `no_socket_server` skipped log finally fires for chat.
   In `combat-chat.ts`, the `room` local at `:80` loses its last consumer and
   goes with it.
3. **`routers/chat.ts` needs one real decision.** Its `if (!params.io) return`
   at `:40` currently also short-circuits the whisper DM database lookup at
   `:43-48`. After removing the guard, either accept the extra query in
   socket-less environments or resolve `dmUserId` only when `io` is non-null —
   but do let the facade run either way, so the skipped-outcome log is
   emitted.
4. **Update the two stale comments**: the "defensive default" note on the
   whisper entry (`broadcast-registry.ts:237-242`) and the
   `chat-broadcast.ts` doc comment describing the old contract.
5. **Tests**: extend `packages/server/src/socket/chat-broadcast.test.ts` to
   cover the null-`io` path (skipped log emitted, no throw) and registry-side
   room resolution; update caller-side tests that stub the old
   `(io, room, message)` arity.

## Scope / caveats

- **Whisper routing logic is out of scope.** The sender/recipient/DM set
  construction at `chat-broadcast.ts:33-42` is the facade's real job and stays
  exactly as is; this leaf changes only how `io` and the room reach it. The
  prior pack ruled the file "not a one-expression wrapper"
  ([04-socket-broadcast-surface.md](../code-quality-2026-07-25/04-socket-broadcast-surface.md),
  Scope bullets) for the same reason.
- **The other four facades and the registry entry points do not change.**
  They are already the target shape; this leaf finishes chat's migration to
  it.
- **Prior pack (CQ25-118).** The landed 2026-07-25 leaf
  [04-socket-broadcast-surface.md](../code-quality-2026-07-25/04-socket-broadcast-surface.md)
  built the registry split and `CHAT_MESSAGE_CONTRACT`, and its direction
  explicitly anticipated this move: "If `chat:newMessage` should stop
  depending on a caller-supplied room, have its entry resolve
  `campaignRoom(payload.campaignId)` itself." Its ruling declining signature
  churn on the wrapper families was scoped to the four *one-expression*
  wrappers and to the interchangeable-strings complaint — it does not cover
  chat, and the problem here (duplicated policy, lost skipped logging) is a
  different one. Do not reopen anything else that leaf closed.
- **Touching all seven call sites is the point, not scope creep** — but keep
  the edits mechanical (guard removal + argument removal); resist folding in
  unrelated cleanup of those routers/services.
- **No `socket/MODULE.md` change is needed**: it documents the per-family
  facade layout, not the outlier signature.
- **Coordinate with
  [001-chat-persistence-delivery-policy.md](./001-chat-persistence-delivery-policy.md).**
  It restructures chat persistence across the same caller files (`chat.ts`,
  `dice.ts`, `cast-spell.ts`, `combat-chat.ts`). No hard ordering, but do not
  work the two concurrently; whichever lands second rebases its call-site
  edits on the other.
- `rest-service.ts:121` intentionally fire-and-forgets (`void`); keep that
  shape when the guard comes off.
