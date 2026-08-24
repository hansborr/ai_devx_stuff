# 1. Six chat-message writers each re-invent persistence and delivery policy because there is no chat-message application boundary

Status: Not started
Theme: chat-message coordination boundary · Area: server · Severity: medium · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Every feature that posts to campaign chat — ordinary chat, whispers, dice
rolls, spell casts, feature uses, rests, combat actions — ends in the same
four steps: create a `chatMessage` row with the author include, map it to the
shared `ChatMessage` shape, look up the socket server, and broadcast to the
campaign room. The low-level primitives for those steps are already shared
(`MESSAGE_AUTHOR_INCLUDE`, `mapChatMessage`, `broadcastChatMessage`), but the
**coordination layer** — the sequencing, the recipient handling, and above all
the failure policy — is re-written at every one of the six production call
sites. Each writer separately decides whether a persist/broadcast failure
throws to the client, is logged and swallowed, or is fired and forgotten.

That freedom has already produced a defect class, not just duplication. The
newest writer, the feature-use chat post, awaits its persist and broadcast
**un-caught after the feature's optimistic-lock update has committed** — so a
chat hiccup turns a successfully consumed feature use into a client-visible
error, the exact policy mistake the older post-commit writers (cast-spell,
combat-chat, rest) each solved independently. Meanwhile the chat router is the
opposite problem: `chat.send` is anything but thin, owning presence scanning,
DM lookup, whisper-recipient validation, preview truncation, and
offline-notification creation inline — domains the routers charter says belong
in `services/`. Every new message-producing feature (the repo keeps adding
them) must re-derive all of this from scratch, and each derivation drifts.

## Evidence

- 6 production `chatMessage.create` sites, re-measured at the pin with
  `git grep -n "chatMessage.create" -- packages/server/src` after excluding
  test-shaped paths: `routers/cast-spell.ts:79`, `routers/chat.ts:120`,
  `routers/dice.ts:55`, `services/character-live-state/feature.ts:85`,
  `services/rest-service.ts:100`, `utils/combat-chat.ts:51`.
- `packages/server/src/routers/chat.ts:24-94` — router-local machinery only
  ordinary chat needs: `isUserOnline` presence scan over `io.fetchSockets()`
  (`:24-28`), `broadcastMessage` with whisper DM lookup (`:39-55`), preview
  truncation constants (`:57-58`), and `notifyWhisperIfOffline` creating
  offline notifications (`:72-94`).
- `packages/server/src/routers/chat.ts:120-157` — `send` inlines the full
  pipeline: create with `MESSAGE_AUTHOR_INCLUDE` (`:120-129`),
  `mapChatMessage` (`:131`), `getSocketIO` + broadcast (`:133-141`),
  conditional whisper notification (`:143-155`). Persist and broadcast are
  awaited un-caught (in-request throwing); only the notification is
  best-effort (`:90-93`).
- `packages/server/src/routers/dice.ts:55-75` — the same pipeline rebuilt:
  create (`:55-64`), map (`:66`), socket lookup + broadcast (`:68-73`), also
  throwing in-request.
- `packages/server/src/routers/cast-spell.ts:55-98` — `postCastSpellChat`
  reloads character/spell display data (`:55-74`), then persists, maps, and
  broadcasts with the entire body try/caught to a `log.warn` (`:76-98`): a
  second, log-and-swallow failure policy.
- `packages/server/src/utils/combat-chat.ts:46-96` — a third policy:
  `persistCombatChat` (`:46-62`) plus fire-and-forget `broadcastCombatChat`
  (`:74-96`) where even the failure logging is guarded (`:25-36`). Docstrings
  at `:38-45` and `:64-73` document the persist-vs-emit split as a deliberate
  auditable boundary.
- `packages/server/src/services/rest-service.ts:94-123` — a fourth policy:
  `createRestChatMessage` persists via `TxClient` **inside** both rest
  transactions (`:100`; short rest closes its default-isolation transaction at
  `:310`, while long rest sets Serializable isolation at `:426`), and `broadcastRestChat`
  broadcasts post-commit as `void` fire-and-forget (`:112-123`).
- `packages/server/src/services/character-live-state/feature.ts:71-100`,
  `:122-130` — the sixth writer got its policy wrong: `postFeatureUseChat`
  persists and broadcasts with an un-caught `await`, called after
  `consumeFeatureUse`'s CAS update (`:58-64`) has already committed, so a
  chat-delivery failure fails a feature use that succeeded.
- The mechanical primitives are already single-sourced — the duplication is
  strictly the layer above them:
  `packages/server/src/utils/chat-helpers.ts:5` (`MESSAGE_AUTHOR_INCLUDE`),
  `:13` (`mapChatMessage`);
  `packages/server/src/socket/chat-broadcast.ts:27` (`broadcastChatMessage`),
  whose options doc at `:8-13` fixes `dmUserId` as caller-resolved to keep the
  function free of data access.
- `packages/server/src/services/README.md:76-77` — the services taxonomy
  currently holds up `utils/combat-chat.ts` ("persists and broadcasts combat
  chat") as a `utils/` example, the placement question the prior pack deferred
  (`docs/agent_notes/backlog/code-quality-2026-07-25/SERVER-COMMENTS-PLAN.md:1203`).

## Proposed direction

Build a chat-message coordination surface at
`packages/server/src/services/chat-message-service.ts` — flat-service tier
per `services/README.md`, with a `chat-message-MODULE.md` companion — in
three layers, with callers keeping content construction throughout:

- **Layer 1, mechanism halves.** `persistChatMessage(db: DbClient | TxClient,
  data)` absorbing the create + `MESSAGE_AUTHOR_INCLUDE` + `mapChatMessage`
  triple and returning the mapped `ChatMessage`; `deliverChatMessage(server,
  message, opts)` wrapping `getSocketIO` + `campaignRoom` +
  `broadcastChatMessage`, a no-op when `io` is null. `dmUserId` stays
  caller-resolved per `chat-broadcast.ts:8-13`'s documented boundary.
- **Layer 2, exactly two named policy entry points.**
  `sendChatMessageInRequest` (persist then deliver, throwing, returns the
  mapped message — for `chat.send` and `dice.roll`) and
  `postChatMessageBestEffort` (try persist+deliver, warn-and-swallow — for
  cast-spell, combat-chat, and eventually `feature.ts`). rest-service
  intentionally gets **no** composed wrapper: it uses the raw halves
  (persist-in-tx via `TxClient`, `void` post-commit broadcast), documented in
  the MODULE.md as the supported third pattern.
- **Layer 3, request-facing chat send.** A shape-1 `sendChatMessage(ctx,
  input)` service extracting `chat.ts:24-94` plus the `send` body — whisper
  validation, DM resolution, presence check, offline notification, preview
  truncation — built on the halves, keeping presence/notification machinery
  out of the generic surface.

Migrate `utils/combat-chat.ts` into the service preserving its persist/emit
split as the two named halves — this consciously acts on the taxonomy
question the prior pack deferred (see Scope), and the halves structure
institutionalizes the auditability rationale its docstrings record.

`chat-message-MODULE.md` must state, as required deliverables: the decision
rule "source mutation already committed → best-effort log-and-swallow;
user-visible in-request action → throw", and the invariant that
`persistChatMessage` stays side-effect-free beyond the single create so
Serializable-retry callers (rest-service P2034 retry) remain safe.

Landing order (three slices; every landed commit leaves docs consistent):

1. **Slice B — land first: `chat.send` extraction.** Move `chat.ts:24-94` and
   the `send` body into the shape-1 `sendChatMessage(ctx, input)` service and
   update `routers-MODULE.md` in the same commit. This is the only outright
   thin-router violation and the highest standalone value; it must stand
   alone if the rest is descoped (its internals move onto the halves when
   slice A lands).
2. **Slice A — service halves + policies + mechanical migration.** Add the
   halves and the two policy entry points; migrate the 5 non-chat writers
   mechanically; swap the `services/README.md:76-77` utils example and update
   `rest-MODULE.md`, all in the same commit. `feature.ts` migrates
   behavior-preserving here — onto the **throwing** path, matching its
   current accidental behavior.
3. **Slice A2 — flagged behavioral commit.** Flip `feature.ts` from the
   throwing path to `postChatMessageBestEffort`, as its own explicitly-flagged
   commit: its un-caught await after a committed CAS update is the policy
   inconsistency this surface exists to prevent.

Descope fallback if slice A is rejected in review: land `persistChatMessage`
alone — the create+include+map triple is pure duplication with zero policy
content.

## Scope / caveats

- **Binding rulings** (constraints on any implementation of this leaf):
  - No monolithic send call owning persistence+broadcast+failure policy for
    all six writers; expose the composable halves so rest-service's
    inside-Serializable-transaction persist with post-commit broadcast stays
    legal.
  - No single centralized failure policy; ship exactly the two named entry
    points, and leave rest-service on the raw halves as a documented third
    pattern with no composed wrapper.
  - Whisper recipient resolution, presence checks, and offline notification
    stay **out** of the generic surface — they live only in the
    chat-send-specific shape-1 service.
  - `feature.ts`'s failure behavior must not change inside the mechanical
    migration; the flip to best-effort is a separate explicitly-flagged
    behavioral commit (slice A2).
  - No trailing doc-only slice: `services/README.md` and `rest-MODULE.md`
    updates ride the writer-migration commit; `routers-MODULE.md` rides the
    `chat.send` extraction commit.
  - The 6-writer unification does not land first: slice B (chat.send
    extraction) is the priority slice and must stand alone; minimal fallback
    is `persistChatMessage` only.
  - `persistChatMessage` stays side-effect-free beyond the single create
    (Serializable P2034 retry safety); state this invariant in
    `chat-message-MODULE.md`.
- **Deliberate-decision conflict, weighed not auto-rejected.** The prior pack
  recorded the combat-chat placement question as deferred — "worth its own
  leaf", explicitly not acted on
  (`docs/agent_notes/backlog/code-quality-2026-07-25/SERVER-COMMENTS-PLAN.md:1203`)
  — and `combat-chat.ts:38-45`/`:64-73` document the persist/emit split as an
  intentional auditable boundary. This leaf consciously acts on both: the
  halves structure preserves the documented split, and the doc updates
  (`services/README.md`, `rest-MODULE.md`, `routers-MODULE.md`) are carried in
  scope. That prior-pack deferral covered only the `utils/` taxonomy of
  `combat-chat.ts` and `character-campaign.ts`; the router pipelines, the
  six-writer coordination layer, and the presence/notification coupling here
  are new scope.
- **Known objection, answered by the slice order.** Because
  `chat-helpers.ts` and `chat-broadcast.ts` already centralize mapping and
  fan-out, each writer's residual pipeline is only ~10 lines, and a reviewer
  could argue only the `chat.send` extraction is worth doing. That is why
  slice B lands first and slice A is independently droppable down to the
  `persistChatMessage` fallback.
- **Out of scope:** message content construction and metadata shapes (stay
  with callers); `broadcast-registry.ts` internals and the whisper fan-out
  logic inside `broadcastChatMessage`; any change to rest-service's
  transaction or retry structure; the whisper-notification product behavior
  (moves verbatim into the shape-1 service).
- **Sequencing.** Leaf
  [008-chat-broadcast-facade-bypasses-registry.md](./008-chat-broadcast-facade-bypasses-registry.md)
  also concerns `socket/chat-broadcast.ts`, which `deliverChatMessage` wraps.
  No hard ordering, but the two must not be worked concurrently in
  `packages/server/src/socket/`; if 008 lands first, build
  `deliverChatMessage` on its post-change surface.
- `feature.ts`'s chat post sits inside `runTopLevelCommand` and behind a
  Pattern B CAS helper (`feature.ts:45-69`); read `docs/CONCURRENCY.md`
  before slice A touches it, and keep the migration outside the CAS helper
  surface.
