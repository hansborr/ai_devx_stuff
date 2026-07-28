# 04. Socket broadcast boundary left half-migrated: a stale migration recipe, per-family tests that outlived the wrapper bodies and now re-test the registry, a sentinel registry entry, and triplicated room-exit emits

Status: Proposed — not promoted
Theme: socket emission boundary · Area: server · Severity: medium · Size: M

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

The socket layer was consolidated behind one boundary — `broadcast()` in
`socket/broadcast-registry.ts`, which owns schema validation, room resolution and
the `socket.broadcast` outcome log. That migration landed and closed (DX5.3a–f).
What did not happen is the cleanup behind it, and the result is a boundary that
is half a boundary.

Two symmetric failure modes fall out of that one cause.

**Inside registry scope**, every per-family helper is now a one-line call to
`broadcast(...)`. The helper *files* are documented design — `socket/MODULE.md:24-26`
names all five and says they "preserve stable call sites over the registry" — so
their existence is not the defect. What did not follow the bodies down is
everything attached to them: 347 lines of per-family test files still stand up
real socket servers to re-assert room delivery and the `socket.broadcast` log
contract, which the registry's own recipe (step 3) says is "covered generically
by `broadcast`/`broadcastToUsers` tests" and which `socket/MODULE.md:59-60` says
should stay thin. The helpers are also strictly *weaker*-typed than the thing
they wrap: `broadcastMapTokenUpdate(io, campaignId, mapId, logger)` is three
interchangeable strings where `broadcast(io, "map:tokenUpdated", { mapId, campaignId })`
names each one. The registry header still ships the numbered migration recipe
that produced this state, whose step 2 ("replace the per-family helper body with a
call to `broadcast`") describes finished work. And `notification:new` — the one
event whose delivery is *only* recipient-filtered — was forced into the
room-shaped `BroadcastEntry` type, so it carries a `room: () => ""` that no
consumer can use and an `emit` that exists solely to throw.

**Outside registry scope**, where the boundary explicitly does not reach
(presence transitions, and post-commit HP attribution), the same emit sequence
has been written more than once. `presence:userLeft` + `campaign:playerLeft` +
`markLastSeen` appears three times in `campaign-room-handler.ts`; the
post-commit `encounter:updated` fan-out over `LoggedHpChange[]` appears twice
under two names, in two directories, with four names and two interfaces covering
one concern. The next maintainer adding an event has to guess which of the two
worlds they are in.

Local socket type aliases (`AppSocket`, `AppServer`) are re-declared across three
files while `socket/index.ts` exports a structurally identical `AppSocketServer`
that seventeen files already import, ten of them production — the same
half-migration, at the type level.

## Evidence

- `packages/server/src/socket/map-broadcast.ts:12`, `:28` — 35-line file, two wrappers, each body a single `broadcast(io, "map:…", {…}, { logger })` call.
- `packages/server/src/socket/campaign-broadcast.ts:14-20`, `packages/server/src/socket/encounter-broadcast.ts:13-20`, `packages/server/src/socket/character-broadcast.ts:19` — 20 lines each, same one-expression shape. All four follow one consistent `(io, campaignId, <entityId>, logger?)` convention.
- `packages/server/src/socket/MODULE.md:24-26` — names `campaign-broadcast.ts`, `character-broadcast.ts`, `chat-broadcast.ts`, `encounter-broadcast.ts`, `map-broadcast.ts` and states their purpose: "preserve stable call sites over the registry". The per-family file layout is documented design, not drift.
- `packages/server/src/socket/MODULE.md:59-60` — "Registry payload, delivery, and logging contracts belong in `broadcast-registry.test.ts`; per-family helper tests should stay thin."
- `packages/server/src/socket/map-broadcast.test.ts` (44 lines), `campaign-broadcast.test.ts` (90), `character-broadcast.test.ts` (90), `encounter-broadcast.test.ts` (123) — 347 lines total over five one-expression functions. `campaign-broadcast.test.ts:43-90`, `character-broadcast.test.ts:43-90` and `encounter-broadcast.test.ts:44-91` each stand up a real socket server to re-assert room delivery and non-delivery to outsiders; `encounter-broadcast.test.ts:92`, `:108` re-assert the `socket.broadcast` success/skipped log contract that `broadcast-registry.test.ts` (598 lines) already owns.
- `packages/server/src/socket/broadcast-registry.ts:106-123` — numbered "Migration recipe (DX5.3c-DX5.3f follow this shape)"; step 2 describes work every helper has already had done to it. Step 3 (`:119-123`) already states that the boundary log contract is covered generically and that per-event tests should focus on schema + delivery policy.
- `packages/server/src/socket/broadcast-registry.ts:125-127` — links `docs/agent_notes/finished_work/socket-emit-inventory.md`, which is real and indexed; it also records that presence transitions and connection-envelope events are deliberately out of registry scope.
- `packages/server/src/socket/broadcast-registry.ts:186-201` — the `notification:new` entry: `room: () => ""` at `:188`, `logFields: () => ({})` at `:189`, a throwing `emit` at `:190-192`, the real `emitToUsers` at `:193-200` whose first room parameter is named `_room` and never read.
- `packages/server/src/services/notification-service.ts:72-75` — the only `notification:new` caller, and it passes no `room`; `packages/server/src/socket/chat-broadcast.ts:38-42` — the only `broadcastToUsers` caller that does pass one, and it always passes it. Between them the `entry.room(validated)` fallback at `:272` has no live consumer.
- `packages/server/src/socket/broadcast-registry.ts:146-161` — `chat:newMessage` is the *other* recipient-filtered entry, and it carries both a real `room`/`emit` pair and an `emitToUsers`: `chat-broadcast.ts:33-46` calls `broadcastToUsers` for whispers and `broadcast` for room messages. Any registry split has to keep that event in both halves; only `notification:new` is user-targeted-only.
- `packages/server/src/socket/broadcast-registry.ts:269` — `if (!entry.emitToUsers) throw …` inside `broadcastToUsers`. This is live defensive code today, not dead: `broadcastToUsers<Name extends RegisteredEvent>` accepts all seven registered names (`RegisteredEvent` at `:28-37`), so passing a room-only name compiles and throws at runtime. A keyed split turns the guard into a type error instead.
- `packages/server/src/socket/broadcast-registry.ts:262-273` — the body `broadcastToUsers` shares with every entry: `entry.schema.parse`, then `entry.logFields(validated)` at `:264`, then `entry.emitToUsers(io, options.room ?? entry.room(validated), …)` at `:272`. Both members a user-targeted entry would want to shed are read here, so the entry-type change has to land together with a change to this function.
- `packages/server/src/socket/broadcast-registry.ts:276` — `BROADCAST_REGISTRY` is exported. `broadcast-registry.test.ts:15` imports it, indexes it by all seven literal keys (`:109`, `:136`, `:160`, `:190`, `:214`, `:234`, `:254`), and sweeps `Object.keys(BROADCAST_REGISTRY)` at `:478-479` to assert every entry declares a `logFields` function — the runtime guard behind the invariant stated at `:59-65`.
- `packages/server/src/socket/campaign-room-handler.ts:53-63` (heartbeat, membership revoked), `:128-137` (explicit `campaign:leave`), `:159-167` (disconnect) — three copies of fetchSockets → `isLastSocketForUser` → `markLastSeen` → the same two emits.
- `packages/server/src/socket/campaign-room-handler.ts:154-158` — load-bearing 5-line comment: at `disconnecting` the socket is still in the room, so the count includes self.
- `packages/server/src/socket/campaign-room-handler.ts:19`, `:46`, `:85` — module-global `prisma` import used for membership checks, while `presenceService` is injected: an inconsistent seam in the same file.
- `packages/server/src/socket/auth-middleware.ts:11`, `packages/server/src/socket/connection-handler.ts:13-14`, `packages/server/src/socket/campaign-room-handler.ts:27-28` — `AppSocket` declared 3x, `AppServer` 2x.
- `packages/server/src/socket/index.ts:25-30` — `AppSocketServer`, structurally identical to both `AppServer` declarations; `:16-17` already imports `connection-handler` and `campaign-room-handler`.
- `packages/server/src/services/rest-encounter-attribution.ts:36-44` and `packages/server/src/services/character-live-state/encounter-attribution.ts:20-32` — the same loop over `readonly LoggedHpChange[]` calling `broadcastEncounterUpdate(getSocketIO(…), change.campaignId, change.encounterId, logger)`; they differ only in `(server: unknown, changes, logger?)` versus `(ctx, changes)`.
- `packages/server/src/services/rest-encounter-attribution.ts:25-33` — `logRestHpChange`, a pure pass-through to `logCharacterHpChangeInTx` that only relabels `before`/`after` into `beforeHp`/`afterHp`/`tempHp`.
- `packages/server/src/services/rest-encounter-attribution.ts:7-15` — JSDoc describing a function ("Returns the encounters to broadcast after the rest transaction commits") attached to `export interface RestHpChange` at `:16`; the function it describes is at `:25`.
- `packages/server/src/utils/encounter-hp-log.ts:112` — `logCharacterHpChangeInTx`, the single minter of `LoggedHpChange`; `:4-25` the transaction-boundary header; `:106-110` the multi-active-encounter rationale.
- `packages/server/src/socket/MODULE.md:21`, `:48` — already covers the registry and names `campaign-room-handler.ts` as owner of the leave/disconnect events; nothing documents the triplication as deliberate.

## Proposed direction

1. **Hoist the socket type aliases.** New `packages/server/src/socket/socket-types.ts` exporting `AppSocket` and the server alias; rewrite `auth-middleware.ts:11`, `connection-handler.ts:13-14`, `campaign-room-handler.ts:27-28` to import from it, and have `socket/index.ts` re-export `AppSocketServer` so its seventeen existing importers are untouched. Type-only, no runtime change.
2. **Retire the migration framing in the registry header.** Retitle `broadcast-registry.ts:106-123` to "Adding a registry event", drop the `DX5.3c-DX5.3f` parenthetical and step 2's migration wording, keep steps 1 and 3 (still valid how-to for a *new* event). Alternatively move the block wholesale into `packages/server/src/socket/MODULE.md`, which already covers the registry. Leave the `socket-emit-inventory.md` link at `:125-127` in place.
3. **Split the registry entry type.** Two separately-keyed registries — a room registry keyed by the six room-delivered events, and a user-targeted registry keyed by the two events that support recipient filtering (`chat:newMessage`, `notification:new`) — or a keyed conditional type. A plain union is not enough because `broadcast<Name extends RegisteredEvent>` indexes `BROADCAST_REGISTRY[name]` generically and would still need narrowing. `chat:newMessage` must appear in **both** registries: it is room-delivered for ordinary messages and user-filtered for whispers. `notification:new` appears only in the user-targeted one. `broadcastToUsers` then narrows to the user-targeted keys, so the `:269` guard becomes a type error rather than a runtime throw.

   The deletions do not fall out of the keying on their own — `broadcastToUsers` reads `entry.logFields` at `:264` and `entry.room` at `:272` for every entry, so the entry shape and that function move together:

   - **User-targeted entry shape: `{ schema, logFields, emitToUsers }`.** Dropping `emit` deletes the throwing stub at `:190-192` outright. Keep `logFields` **required** on both halves: `broadcast-registry.ts:59-65` states that it is mandatory by design "so a new event cannot opt out of the logging contract", and that invariant is worth more than the one line `logFields: () => ({})` costs at `:189`. So `:264` is unchanged and `:189` survives — the sentinel this step actually deletes is the unusable `room: () => ""` at `:188` plus the throwing `emit`. Do not make `logFields` optional on the user-targeted half to reclaim `:189`; that weakens the contract for exactly the events whose delivery is hardest to audit and forces a contradicting edit to the `:59-65` JSDoc.
   - **Drop the `entry.room(validated)` fallback at `:272`.** Give the user-targeted `emitToUsers` a `room: string | undefined` parameter and pass `options.room` straight through. Both live callers already settle it: `chat-broadcast.ts:38-42` always supplies `room`, and `notification-service.ts:72-75` supplies none while `notification:new`'s `emitToUsers` ignores the argument. Do **not** substitute `options.room ?? ""` in the helper — that relocates the empty-string sentinel from the entry into shared code, which is the smell this step exists to remove. If `chat:newMessage` should stop depending on a caller-supplied room, have its entry resolve `campaignRoom(payload.campaignId)` itself.
   - **Keep the registry sweep honest.** `BROADCAST_REGISTRY` is exported at `:276` and `broadcast-registry.test.ts` indexes it by all seven keys and iterates `Object.keys(...)` at `:478-479` to enforce the `logFields` contract. A two-registry split silently drops the user-targeted half out of that sweep. Either export a combined object for the test to walk or run the sweep over both halves; the user-targeted registry must not lose the guard.

   No runtime behaviour changes, given that the room argument stays ignored for `notification:new` and `logFields` stays required.
4. **Thin the per-family tests down to what the registry does not already cover.** Keep the five helper files where `socket/MODULE.md:24-26` documents them; the defect is the 347 lines of tests, not the 95 lines of wrappers. Each helper's own test should assert one thing — that the helper forwards its positional arguments into the right registry event name and payload shape (a spied `broadcast`), plus the `io === null` no-throw case. Delete the re-assertions of room delivery, outsider non-delivery, and the `socket.broadcast` log contract at `encounter-broadcast.test.ts:92`, `:108`; those belong to `broadcast-registry.test.ts`, per the registry recipe's own step 3 and `socket/MODULE.md:59-60`. A single table-driven test over the four thin helpers is the natural shape.
5. **Collapse the HP-attribution vocabulary to one broadcaster.** Keep a single fan-out over `readonly LoggedHpChange[]`; drop `broadcastRestHpAttribution`'s `server: unknown` parameter in favour of the same shape the live-state one uses; drop the `logRestHpChange` / `RestHpChange` pass-through or, at minimum, move the misplaced JSDoc at `rest-encounter-attribution.ts:7-15` onto `logRestHpChange` at `:25` where it belongs. Call sites are few and mechanical (`rest-service.ts:317`, `:442`, `stats-conditions.ts:105`, `:138`).

   `RestContext` (`rest-service.ts:140-145`) is already structurally assignable to `CharacterLiveStateContext` (`character-live-state/types.ts:4-9`) — identical modulo `readonly` — so the parameter change is mechanical. Decide where the surviving broadcaster lives before starting: leaving it in `character-live-state/encounter-attribution.ts` makes `rest-service.ts` import across service modules. `rest-encounter-attribution.test.ts` covers both dissolved symbols (`:70` `describe("logRestHpChange")`, `:219` `describe("broadcastRestHpAttribution")`); fold its surviving assertions into `character-live-state/encounter-attribution.test.ts` rather than deleting them.
6. **Extract only the shared announcement tail in `campaign-room-handler.ts`, last, and with no modes at all.** The genuinely common code is the three trailing lines each site runs once it has decided this is the user's last tab:

   ```
   await presenceService.markLastSeen(campaignId, userId);
   socket.to(room).emit("presence:userLeft", { campaignId, userId });
   socket.to(room).emit("campaign:playerLeft", { userId, campaignId });
   ```

   Extract exactly that as one `async announceUserLeft(socket, presenceService, { room, campaignId, userId })`, and leave all three control flows — fetch-before-leave + `socket.leave` + `if (isLastTab)` at `:53-63` and `:128-137`, early-return inside `void (async () => {…})()` with the swallowing `catch` at `:159-167` — exactly where they are. Do **not** give the helper a mode parameter, a boolean, or an awaited/fire-and-forget switch; the three sites differ in leave semantics, awaitability and error handling, and encoding that in the helper is the flattening the caveats below reject. Move nothing else, and leave the `:154-158` ordering comment attached to the disconnect block that it explains.

## Scope / caveats

- **Do not inline `broadcast()` at the call sites, and do not merge the wrapper files.** Deleting the wrappers and calling `broadcast` directly touches ~55 production references for no payoff beyond type naming. Folding the four one-expression files into a single `socket/broadcast-helpers.ts` is also wrong: `socket/MODULE.md:24-26` documents the per-family files as the deliberate stable-call-site facade, the merge removes no production indirection (the same five functions still wrap the same registry call), it rewrites 14 import statements across 13 production files plus their tests, it forces a `MODULE.md` edit, and the proposed filename collides with the existing `services/encounter-combat/broadcast-helpers.ts`. Step 4 keeps the files and fixes the thing that is genuinely out of line with the documented design — the test bulk.
- **All four wrapper families follow one signature convention**, `(io, campaignId, <entityId>, logger?)`; `broadcastCampaignUpdate` omits the entity id only because `campaign:updated` has no sub-entity. Do not go hunting for drift. The real complaint about the signatures is three interchangeable strings, and **no step in this leaf fixes that** — it is the price of the documented stable-call-site facade, and changing it means changing every call site. Note it and move on. The doc paragraphs above the wrappers are similar in intent but *not* identical text; `encounter-broadcast.ts:9-11` phrases the `logger` sentence differently on purpose. Do not "unify" them into a claim that is wrong for one of the five.
- **`chat-broadcast.ts` is not a one-expression wrapper and stays out of step 4's test thinning.** It owns real whisper-routing logic (sender + recipient + DM set construction) at `:33-37`, and its 328-line test file is testing that logic, not the registry.
- **Keep the `socket-emit-inventory.md` link at `:125-127`.** `docs/agent_notes/finished_work/socket-emit-inventory.md` documents DX5.3a–DX5.3f in detail, is indexed from `docs/agent_notes/finished_work/README.md:21`, and is the classification record for what is deliberately out of registry scope. Only the migration framing above it is archaeology.
- **Do not try to make one helper subsume all three room-exit sites.** They genuinely differ: heartbeat and `campaign:leave` `await`, fetch the room membership *before* leaving, and call `socket.leave(room)` first; disconnect must *not* leave, cannot `await` (it runs inside `void (async () => {…})()` because `disconnecting` is not an async-friendly hook), uses an early-return guard instead of an `if (isLastTab)` block, and deliberately swallows every error because the socket is on its way out. The shared tail is exactly the three announcement lines quoted in step 6 — not the last-tab detection, which is where the three sites actually differ. A conditional helper that flattens the three control flows into modes or flags is worse than the duplication.
- **`campaign-room-handler.ts:154-158` is load-bearing** and must survive verbatim (modulo rewrapping) wherever the code lands: it explains why the last-tab count includes self at `disconnecting`. Same for `encounter-hp-log.ts:4-25` (transaction-before-broadcast discipline) and `:106-110` (why every active encounter needs its own entry and broadcast).
- **Keep the `InTx` suffix.** Renaming `logCharacterHpChangeInTx` to something like `recordHpChangeForActiveEncounters` drops a real invariant marker — the function takes a `TxClient` and must run inside the caller's transaction. Whatever name wins has to keep that signal.
- **Step 6 is the only medium-risk item here**, even in its narrowed form. Last-tab detection and the `disconnecting` / `_cleanup` ordering break silently, and the disconnect site's `catch {}` will swallow a mistake made inside the extracted helper. `campaign-room.test.ts` and `presence-multi-tab.test.ts` are the guard — run them, and add coverage before refactoring, not after (TDD). If the three-line saving does not feel worth the risk, cutting step 6 entirely loses nothing else in this leaf.
- **Presence transitions stay out of the registry.** `presence:userLeft` / `campaign:playerLeft` are deliberately excluded per `broadcast-registry.ts:125-127` and the inventory doc. Routing them through `broadcast()` is not part of this leaf.
- The module-global `prisma` at `campaign-room-handler.ts:19` sitting next to an injected `presenceService` is a genuine seam inconsistency, but changing it changes the file's test seam. Note it; do not bundle it into step 6.
- Guides for the implementer: `docs/guides/add-socket-broadcast.md` and `docs/socket-architecture.md` for steps 2–4 and 6; `docs/guides/add-module-doc.md` if step 2 moves the recipe into `socket/MODULE.md`.
- **Sequencing with leaf 05.** Step 5 touches `services/rest-encounter-attribution.ts`, which leaf 05 step 4 also moves during the `services/rest/` promotion — do step 5 first, or rebase it onto the promotion; do not do both at once. Step 5 is also a *precondition* for leaf 05's decision, not just a merge conflict with it: dropping `logRestHpChange` / `RestHpChange` and unifying the fan-out dissolves `rest-encounter-attribution.ts` as a rest-owned internal file, which drops rest from three internal files to two and fails criterion 3 of `services/README.md:21-28`. Land step 5, then let leaf 05 re-count before promoting.
- If step 4 is done together with step 3, do step 3 first: the registry split changes what a thin per-family test can usefully assert.
