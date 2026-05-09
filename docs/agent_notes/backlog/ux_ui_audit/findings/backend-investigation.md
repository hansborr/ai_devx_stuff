# Backend investigation — 2026-04-14

Auditor persona: senior backend engineer investigating reported bugs and surfacing proactive risks in routers, services, socket handlers, and authorization.

Scope: `packages/server/src/{routers,services,socket,utils,trpc}/`. Test health verified (`test:server`: 105 files, 1519 tests, all pass; duration 107s). DB health (`bun run db:status`): one pending migration warning in dev, SRD seed present, Prisma client up to date. Socket handlers contain no DB writes, consistent with `docs/socket-architecture.md`. No illegal `.update/.updateMany/.upsert` calls on locked delegates (`CharacterStats`, `EncounterParticipant`, `Encounter`, `CharacterSpellSlot`, `CharacterClass`) — the `never`-typed delegates in `utils/prisma-types.ts` are doing their job.

## What went well

- **Authorization primitives are well-structured.** `assertCampaignMember` / `assertCampaignDm` (`utils/campaign-auth.ts`) and `assertCharacterOwner` / `assertCharacterAccess` / `assertCharacterOwnerOrAccess` (`utils/character-auth.ts`) are called consistently and correctly at the top of mutations. The info-disclosure pattern (`NOT_FOUND` instead of `FORBIDDEN` on character ownership mismatches) is enforced in `character-auth.ts:19` and `character-auth.ts:68`.
- **Optimistic locking discipline is complete.** Every mutation on `CharacterStats`, `EncounterParticipant`, `Encounter`, `CharacterSpellSlot`, and `CharacterClass` routes through the `utils/*-mutations.ts` helpers. The type system (`TxClient`/`DbClient` typing those methods as `never`) prevents direct calls; spot-checked type tests in `utils/__type-tests__/` confirm this. The last-writer-wins policy for action-economy flags is explicit at `routers/encounter.ts:51-59`.
- **Note/NPC visibility redaction is rigorous.** `routers/npc.ts:44-60` returns empty `notes` for non-DM viewers at the mapper layer (defense in depth even if a query accidentally leaks the column). `routers/note.ts:67-82` implements player-visible filters (`shared` always, `private` only if author, `dmOnly` never) via `buildPlayerVisibilityFilter`.
- **Invite join flow uses a transaction.** `routers/invite.ts:128-170` wraps the `uses < maxUses` check + `uses++` increment + `campaignMember.create` in `$transaction`, which is the right shape.
- **Chat whisper ACL is correct.** `routers/chat.ts:162-180` filters whispers by `authorId OR recipientId` for players, and leaves DMs unfiltered (documented "DM sees all" rule).
- **Socket handlers are writeless.** `socket/campaign-room-handler.ts` only *reads* membership for gating; presence writes go through `PresenceService` (which owns its own Redis/DB writes with best-effort semantics).
- **Public procedures are SRD-only.** `publicProcedure` appears in `auth.ts` (register/login/refresh), `health.ts`, `srd.ts`, `monster.ts`, `magic-item.ts`. Searched for runtime write paths on `monster` and `magicItem` delegates — only seed scripts create rows, so the public read surface is SRD data exclusively.

## What went wrong

- **Encounter builder has no path to homebrew monsters** (case D2 below, major). `add-participant-dialog.tsx` and `monster-tab.tsx` only call `trpc.monster.list`, which is SRD-only. Even when a DM authors and links a `campaign`-visibility homebrew collection with a CR 2 monster, the add-participant dialog can never surface it. Server-side the data (`homebrewEntry` with `type="monster"`) exists and is reachable via `homebrew.listEntries`; the missing piece is that the dialog never queries it. Feature gap, not a server bug.
- **Client collapses all tRPC errors to a generic message** (case D3 below, minor). `campaign.get` correctly throws `TRPCError({ code: "NOT_FOUND" })` for a bad ID. The UI (`packages/client/src/pages/campaign-detail-page.tsx:239`) treats `isError` as a single bucket and shows "Failed to load campaign. Please try again." — indistinguishable from 500. The server is well-behaved; the fix is in `campaign-detail-page.tsx`.

## Areas for improvement

See "Investigation log" below. Each case has severity, file/line, and a suggested fix (but no fix implemented — out of scope for this audit).

## Suggestions

- Promote `notification.markRead` to the same `NOT_FOUND` pattern character/homebrew use (see case #6).
- Add an `E2E_TEST`/dev-friendly reset endpoint for in-memory rate limits, or document how devs bypass them (case #9).
- Consider a campaign-wide `inventoryAccess` helper so DM can read/write player inventory during play without the inconsistency in case #3.

## Open questions for the backend dev

- (Self) Should `campaign.assignCharacter`'s "not a member" error be `NOT_FOUND` instead of `FORBIDDEN` for consistency with `character-auth.ts`'s info-hiding philosophy? (Case #5)
- Is `map.list` returning token counts inclusive of hidden tokens acceptable UX for players, or should hidden tokens be excluded from the count? (Case #10)

---

## Investigation log

### Case #1 — Invite join has a check-then-act race (still bounded by unique constraint)
**Severity:** minor (bounded by DB, not a true exploit)
**Files:** `packages/server/src/routers/invite.ts:128-170`

Inside the `$transaction`, the code reads `invite.uses` and compares to `invite.maxUses`, then issues `{ uses: { increment: 1 } }` and `campaignMember.create`. Under default READ COMMITTED isolation, two concurrent joins can each see `uses = maxUses - 1` and both pass the check, producing `uses = maxUses + 1` after both increments. The `campaignMember` PK `campaignId_userId` blocks the same user twice, but two different users can both consume the "last" slot.

**Suggested fix:** Either (a) use `updateMany` with `where: { id, uses: { lt: maxUses } }` and treat `count === 0` as `BAD_REQUEST "invite full"`; or (b) use `$executeRaw` with `SELECT … FOR UPDATE` on the invite row; or (c) raise transaction isolation to `Serializable` for this one path. Option (a) is simplest and mirrors the homebrew-entry optimistic-lock pattern already in use (`routers/homebrew.ts:219`).

### Case #2 — `login` has a classic user-enumeration timing oracle
**Severity:** minor (rate-limited; still a shape issue)
**Files:** `packages/server/src/routers/auth.ts:119-151`

`login` short-circuits on `!user` *before* `verifyPassword` runs. Attacker measuring response time can distinguish "email exists" from "email does not exist" even with `TOO_MANY_REQUESTS` throttling at 10/15min (low threshold, but per-IP).

**Suggested fix:** Always run `verifyPassword` against a constant dummy bcrypt hash when the user is missing, and always return the same `UNAUTHORIZED` error. The async-hash cost roughly equalizes timing. Alternatively, perform the bcrypt work on a scheduled delay.

### Case #3 — Inventory auth is inconsistent between `create`/`delete` and `update`/`list`
**Severity:** minor (UX papercut for DMs running combat)
**Files:** `packages/server/src/routers/inventory.ts:110,144,161,192`

- `create` → `assertCharacterOwner` (only the PC owner can add items)
- `list` → `assertCharacterOwner` (DM cannot view a player's inventory)
- `update` → `assertCharacterOwnerOrAccess` (DM can modify as long as character is in a campaign they DM)
- `delete` → `assertCharacterOwner` (DM cannot delete items from a player)

During play, a DM can toggle attunement on a player's item but cannot view the list to know what's there, nor add a dropped item, nor remove a destroyed one. Per `docs/authorization.md`, DM access to a player's character during gameplay is the intended pattern.

**Suggested fix:** Promote all four procedures to `assertCharacterOwnerOrAccess` (and add the `campaignId` input field to `create`/`delete`/`list` schemas in `shared`). If there's a design reason to keep `create`/`delete` player-only (e.g. loot RP agency), document it in `docs/authorization.md`.

### Case #4 — `homebrew-campaign.linkCollection` lets a DM attach any `campaign`-visibility collection they can read
**Severity:** minor (not a leak; authors of shared collections accept distribution)
**Files:** `packages/server/src/routers/homebrew-campaign.ts:19-50`

The check `col.visibility === "private" → NOT_FOUND` blocks private collections. `public` and `campaign` visibility both pass. If a user authored a `campaign`-visibility collection expecting it to be shared only with specific campaigns, any DM who learns the `collectionId` can re-broadcast it to a different campaign's members.

**Suggested fix:** For `campaign` visibility, require that the collection already be linked to a campaign the caller DMs OR that the caller is the author. Right now `campaign` visibility behaves identically to `public` for read+link. Alternatively, rename the visibility levels if this is by design (e.g. `public` / `shared` / `private` where `shared` = "opt-in by any DM").

### Case #5 — `campaign.assignCharacter` and `campaign.unassignCharacter` throw `FORBIDDEN` on non-membership
**Severity:** minor (stylistic inconsistency)
**Files:** `packages/server/src/routers/campaign.ts:210-216,285-291`

Other routers either throw `NOT_FOUND` or let `assertCampaignMember` decide. These two procedures inline a custom `FORBIDDEN` response, which differs from the house pattern.

**Suggested fix:** Replace the inline findUnique + throw with `assertCampaignMember(ctx.prisma, input.campaignId, ctx.user.id)`. It already returns `NOT_FOUND` when the campaign is missing and `FORBIDDEN` when the user isn't a member, matching every other router.

### Case #6 — `notification.markRead` reveals notification existence across users
**Severity:** minor (low-value info leak)
**Files:** `packages/server/src/routers/notification.ts:53-80`

`markRead` does `findUnique` → if missing, `NOT_FOUND`; if `userId !== ctx.user.id`, `FORBIDDEN`. The distinguishable error lets a caller enumerate notification IDs.

**Suggested fix:** Single-query fix: `await ctx.prisma.notification.updateMany({ where: { id, userId: ctx.user.id }, data: { read: true } })` — then if `count === 0`, throw `NOT_FOUND` uniformly. One query, no leak, no `findUnique`.

### Case #7 — Auth rate limiter is per-instance, in-memory
**Severity:** minor (known-limitation; documented?)
**Files:** `packages/server/src/trpc/rate-limit.ts`

`createAuthRateLimiter()` stores counters in a `Map`. Running more than one server instance behind a load balancer divides the effective rate limit by the instance count; an attacker who can land on any instance has N× the limit. For single-instance deployments this is fine.

**Suggested fix:** When moving to multi-instance, migrate to a Redis-backed limiter (Redis is already present for Socket.io — see `docs/socket-architecture.md`). A tiny `INCR key EX windowMs` pattern is sufficient.

### Case #8 — `encounter.addParticipant` reads conditions then mutates JSON conditions non-atomically
**Severity:** minor (re-add race)
**Files:** `packages/server/src/routers/encounter.ts:234-279`

When adding a character participant, the code reads `characterCondition` rows and merges them into `data.conditions` before calling `encounterParticipant.create`. If a condition is added to the character between this read and the participant create, it's silently lost from the participant's starting conditions. The participant create itself is fine.

**Suggested fix:** Either (a) wrap both in a `$transaction` with a re-read inside; or (b) accept the race (conditions are routinely managed during combat anyway) and document it. I'd accept it — the user impact is minimal and the fix adds a transaction for a cold path.

### Case #9 — `E2E_TEST` env rate-limit multiplier is the only bypass; no dev-runtime reset hook
**Severity:** minor (DX, not correctness)
**Files:** `packages/server/src/trpc/rate-limit.ts:16,53`

`DISABLE_RATE_LIMIT=true` fully disables; `E2E_TEST` ×100s the window. Neither is exposed through a dev endpoint. If an auditor hammers login during exploration, they can get locked out for 15 minutes.

**Suggested fix:** Document in `CLAUDE.md` that devs can export `DISABLE_RATE_LIMIT=true` in their shell, or add a `/trpc/_test/resetRateLimit` procedure gated to `NODE_ENV=development`.

### Case #10 — `map.list` token count ignores player visibility
**Severity:** trivial
**Files:** `packages/server/src/utils/map-helpers.ts:155-166`, `packages/server/src/routers/map.ts:60-70`

`mapMapSummary` returns `_count.tokens` straight from Prisma, which counts hidden (`isVisible: false`) tokens. A player sees "12 tokens" on a map summary even if only 4 are visible to them.

**Suggested fix:** If the product cares, switch to two counts — `{ visible: countWhereVisibleTrue, total: _count.tokens }` — and return only `visible` for non-DM viewers. Otherwise, leave as-is.

---

## Test health snapshot

```
Test Files  105 passed (105)
Tests       1519 passed (1519)
Duration    106.88s
```

pg client-query deprecation warnings (x10) appear in test output — cosmetic, from the `pg` driver used by Prisma; will go away when upgrading to `pg@9`.

## DB health snapshot

```
WARN: 1 pending migration(s) — run 'bun run --filter @musi/server db:migrate'
OK  : connected to database
OK  : SRD seed present (Species rows: 9)
OK  : Prisma client up to date
```

The pending migration in the dev database should be applied before auditors hit the server — worth flagging to `team-lead` so nobody's repro is contaminated by stale schema.

---

## Auditor-flagged cases (from `dm-auditor`)

### Case D1 — Monster search case sensitivity: cannot repro server-side
**Severity:** minor (likely client-side flake)
**Files:** `packages/server/src/routers/monster.ts:119` (server is correct); auditor surface is `packages/client/src/components/campaign/monster-tab.tsx`

**Repro:** DM auditor reports `goblin` returns 0 results, `Goblin` returns 3 in the encounter add-participant → monster search.

**Root cause:** None found on the server. Direct `GET /trpc/monster.list?input={"search":"goblin"}` vs `{"search":"Goblin"}` returns identical data (4 goblin/hobgoblin entries, including Goblin Minion CR 1/8 and Goblin Warrior CR 1/4). The Prisma query uses `mode: "insensitive"` at `routers/monster.ts:119`, which PG evaluates via `ILIKE`. The query's `orderBy: [{ challengeRating: "asc" }, { name: "asc" }]` reliably returns the same results for both casings.

**Likely explanation:** The 300ms debounce in `monster-tab.tsx:247` combined with TanStack Query's `keepPreviousData` behavior can show stale results while a new query fetches — the "0 results" may have been a visual flash between debounce cycles. Or the `filters.search` state was contaminated by a preceding CR filter the auditor didn't notice.

**Suggested fix:** Not a server fix. UI dev may want to add an `isFetching` indicator to the result list while results are being re-queried to reduce flicker, and show a "No monsters found" message only once the query resolves (not during the fetch).

### Case D2 — Homebrew collections not reachable from encounter builder
**Severity:** major (feature gap, blocks DM workflow on homebrew-heavy campaigns)
**Files:** `packages/client/src/components/campaign/add-participant-dialog.tsx:258`, `packages/client/src/components/campaign/monster-tab.tsx:260`

**Repro:** DM authors a CR 2 homebrew monster in a `private` collection → collection is visible under Homebrew → opens encounter → Add Participant → Monsters tab → searches by name → no results. The CR 2 monster cannot be added to the encounter.

**Root cause:** The Monsters tab queries only `trpc.monster.list`, which reads from the `monster` table (SRD seed data). Homebrew monsters live in `homebrewEntry` rows with `type = "monster"`. There is no server procedure that returns a unified list merging SRD monsters with homebrew entries relevant to a campaign.

**Suggested fix:** Two options:
1. Add a new server procedure like `encounter.listAvailableMonsters({ campaignId, search })` that unions `monster` (all SRD) with `homebrewEntry` rows from collections linked to the campaign via `campaignHomebrewCollection`. Return both in a single typed shape.
2. Have the Monsters tab run two queries in parallel (`monster.list` + `homebrew.listEntries` per linked collection) and merge client-side.
Option 1 is cleaner (single query, one N+1 defense point, one place to paginate) and is what the server layer is designed for. The `campaignHomebrewCollection` join table is already in place. Also requires: a shared `MonsterLike` type (SRD + homebrew parsed via `validateHomebrewData`) and a mapper that normalizes both shapes.

**Agreed implementation contract** (with `ui-dev` and `dm-auditor`, 2026-04-15). Captured here so the eventual implementer has the full shape in one place:

1. **Source discriminator = tagged union, not flat flag.** Each row carries existing `MonsterSummary` fields plus an explicit:
   ```ts
   source: { type: "srd" } | { type: "homebrew", collectionId: string, collectionName: string }
   ```
   Not `isHomebrew: boolean` + nullable `collectionId`. The union guarantees that the collection fields are only present (and only required) when homebrew, keeps impossible states unrepresentable, and lets the UI render the origin badge with a single exhaustive switch.

2. **Default ordering = SRD first, homebrew after, each group sorted by name.** Stable across all three endpoints so the client doesn't need per-endpoint ordering logic. Homebrew grouped together (not interleaved) so DMs can scan for "what did I author" at a glance.

3. **Pagination/search shape shared across all three endpoints.** Single input contract:
   ```ts
   { query?: string, limit?: number, cursor?: string, source?: "all" | "srd" | "homebrew" }
   ```
   Matches whatever `monster.list` does today for `query`/`limit`/`cursor`; the `source` filter lets the same component power "all", "SRD only", and "my homebrew only" toggles without three separate queries. Keeping the shape identical across the three endpoints lets the client reuse one search component for monsters, spells, and magic items.

`MonsterResultRow` needs zero client-side field changes beyond the tagged union. Owner: backend-dev (me), post-audit.

**Pattern repeats for spells and magic items** (raised by `dm-auditor`, confirmed 2026-04-15). The same SRD-only-query gap exists in two more places:
- `packages/client/src/components/sheet/add-spell-dialog.tsx:139` — calls `trpc.srd.listSpells` only. Homebrew spells authored in `homebrewEntry` with `type="spell"` are invisible in the Cast dialog.
- `packages/client/src/components/compendium/magic-item-list.tsx:197` — calls `trpc.magicItem.list` only. Homebrew magic items (`homebrewEntry` with `type="magicItem"`) are invisible when adding to character inventory.

Recommend implementing D2 as the reference for the monster case (`encounter.listAvailableMonsters`), then applying the same contract (tagged `source` union, SRD-first ordering, shared pagination/search shape) to spells and magic items as `listAvailableSpells` / `listAvailableMagicItems`. Could be a single sibling PR or three small ones. The cached-linked-collections drift argument (two separately-cached queries drift mid-session) is equally true in all three cases — favors server-side UNION for each.

### Case D3 — UI cannot distinguish 404 from 500 on `campaign.get`
**Severity:** minor (UX papercut; no data loss)
**Files:** `packages/client/src/pages/campaign-detail-page.tsx:237-244`

**Repro:** Navigate to `/campaigns/does-not-exist` → UI shows "Failed to load campaign. Please try again." instead of "Campaign not found" or a redirect.

**Root cause:** `campaign.get` throws `TRPCError({ code: "NOT_FOUND" })` at `routers/campaign.ts:121-123`; this is the correct server behavior. The client's error handler at `campaign-detail-page.tsx:238-244` treats any `isError` as generic and calls `onRetry={refetch}`, which is actively misleading for a 404 (retrying an invalid ID won't help).

**Suggested fix:** Inspect `campaignQuery.error` (tRPC client exposes `data.code` via `TRPCClientError`) and branch:
- `code === "NOT_FOUND"` → render "Campaign not found" + link to `/campaigns`
- `code === "UNAUTHORIZED"` → redirect to login
- otherwise → current retry-on-500 UI
This is purely a client change; `packages/client/src/lib/` may want a small `tRpcErrorClassifier` helper since this pattern will repeat.

### Case D4 — Invite "Copy code" button copies a URL; server accepts only bare code
**Severity:** minor (UX label mismatch; no data exposure)
**Files:** `packages/client/src/components/campaign/invite-panel.tsx:36-38,65`; server `packages/server/src/routers/invite.ts:125-138`

**Repro:** DM views invite panel → "Copy code" button (aria-label "Copy code ABCDEFGH") actually copies `http://localhost:8000/join/ABCDEFGH`.

**Root cause (backend):** `invite.join` procedure validates `input.code` via `joinCampaignInputSchema` against the exact `campaignInvite.code` field. The server has no URL-stripping logic. There's no "paste code here" UI field today — the join page reads `code` from the route param — so the mismatch doesn't break any existing flow. But if a user shares the copied URL with a teammate who pastes it into a future manual-entry UI, the lookup will fail.

**Suggested fix:** Two changes, both cheap.
- UI: Rename the copy button's aria-label and tooltip to "Copy invite link" (accurate) or copy only the `invite.code` string and add a second "Copy link" button if DMs want the URL.
- Server: In `invite.join`, pre-process the input: accept either `<code>` or a URL ending in `/join/<code>` and extract the last path segment. Defensive and one-liner: `const code = input.code.match(/([A-Za-z0-9]+)$/)?.[0] ?? input.code;`. Costs nothing and future-proofs against the label mismatch.

### Case D5 — XP summary "wrong" finding does not reproduce; SRD data confirms displayed values
**Severity:** none (auditor recall error, not a bug)
**Files:** `packages/shared/src/rules/xp.ts:113-135`, `packages/server/src/seed/seed-srd-monsters.ts`, monster data in DB

**Repro:** DM auditor reported: encounter with Bugbear Warrior (believed CR 1/2 → 100 XP), Owlbear (CR 3 → 700 XP), custom NPC CR 2 → XP summary showed CR 3 / CR 2 / **CR 1 / 200 XP**. Auditor flagged the CR 1/200 XP line as wrong.

**Investigation:** Verified live via `GET /trpc/monster.list?input={"search":"Bugbear"}`:
```
{"id":"monster-bugbear-warrior","name":"Bugbear Warrior","challengeRating":1,"xp":200,...}
{"id":"monster-bugbear-stalker","name":"Bugbear Stalker","challengeRating":3,"xp":700,...}
```
Bugbear Warrior's seed value is `challengeRating: 1, xp: 200`. `crToXp(1) = 200` per `CR_TO_XP` table at `rules/xp.ts:15-50`, matching SRD 5.2.1.

**Root cause:** Auditor recalled SRD 2014's Bugbear (CR 1), but thought the Warrior variant was CR 1/2 — it is CR 1 per SRD 5.2.1 (the revision this codebase seeds from). The XP summary correctly showed CR 1 / 200 XP. No bug.

**Suggested action:** Ask the DM auditor to re-run the scenario with known CRs (pick monsters directly off `docs/SRD_CC_v5.2.1.pdf`) if they still suspect a bucketing issue. The `calculateEncounterXp` logic at `rules/xp.ts:118-135` is covered by 10 tests in `rules/xp.test.ts` and matches the SRD table.

---

## Second-pass auditor questions (maps + combat/map interplay)

### Case D6 — Add-participant does not auto-create a map token
**Severity:** none (intentional decoupling); UX gap for client
**Files:** `packages/server/src/routers/encounter.ts:234-279`, `packages/server/src/utils/encounter-participant-helpers.ts:7-33`

**Question:** When a combatant is added to an encounter with a linked map, is a token auto-created?

**Answer:** No. `encounter.addParticipant` only writes an `encounterParticipant` row (via `buildAddParticipantData`). Tokens are a separate `mapToken` entity managed independently by `mapToken.create` / `encounter-map.linkParticipantToToken`. This is intentional — encounters can run without maps, and tokens can exist without encounters — but it means two manual steps for the DM.

**Recommendation:** Keep the server model unchanged. Client can add a "Place token" affordance on new participants when the encounter has a linked map (opens Add Token dialog pre-filled with participant name + `encounterParticipantId`). No new server procedure needed; existing `mapToken.create` accepts `encounterParticipantId`.

### Case D7 — `autoLinkTokens` mutation is character-only and silent
**Severity:** minor (button mislabel + missing monster/NPC handling)
**Files:** `packages/server/src/routers/encounter-map.ts:70-113`

**Question:** What does "Auto-link character tokens" actually do?

**Answer:** It finds character-type participants in the encounter, finds character-tokens on the linked map (`mapToken` rows with matching `characterId` and no `encounterParticipantId` yet), and sets `token.encounterParticipantId` on one-to-one matches. It does not create tokens, and it completely ignores monster/NPC participants (filter `characterId: { not: null }` at line 78). The response shape is `{ linked: updates.length }` — if zero matches exist, the DM gets `{ linked: 0 }` with no user-facing indication.

**Recommendation:** Three options.
1. Rename the UI button to "Link character tokens" (cheapest; accurately describes behavior).
2. Extend the server to also auto-create missing tokens for un-tokenized character/monster/NPC participants (new endpoint `autoPopulateTokens` that adds to the map, respecting visibility defaults).
3. Show the `linked` count to the user as a toast ("Linked 2 tokens; 3 participants had no matching token").

**Agreed plan (with `dm-auditor`, 2026-04-15):** new sibling endpoint `encounter.spawnTokensForUnmappedParticipants({ encounterId, defaultVisibility?, anchorCell? })`, **not** a `createMissing` flag on `autoLinkTokens`. Rationale: a flag would turn one procedure into two distinct DB-write shapes, which breaks "one procedure, one purpose" and complicates TanStack Query invalidation (one query key would need to invalidate both token-link and token-create caches). Two endpoints keeps broadcast invalidation targeted (`autoLinkTokens` → encounter + token-link; `spawnTokensForUnmappedParticipants` → encounter + token-create). Companion UX: two buttons ("Link existing" and "Spawn missing") or a combined "Populate tokens" that calls both sequentially. Owner: backend-dev (me). Ships with the `ui-dev` rename of the existing button.

**Placement contract (raised by `dm-auditor`, 2026-04-15):** stacking N tokens at `(0, 0)` is a bug-magnet — overlapping tokens become unselectable in Konva, and the DM has to hunt-and-drag. Input accepts optional `anchorCell: { col: number, row: number }` so the client can pass the DM's last-clicked cell; when absent, default to the top-left visible cell after fit-to-screen and snake right (wrap to the next row at the map edge). Server-side validation: anchor cell must be inside map bounds, and placement must skip any cell already occupied by another token (scan existing `mapToken` rows, advance to the next free cell). Response should include the per-token placements so the client can animate in or highlight new arrivals.

### Case D8 — Edit Map DOES support mutating grid + dimensions
**Severity:** none (client gap only)
**Files:** `packages/shared/src/schemas/map-inputs.ts:56-64`, `packages/server/src/routers/map.ts:72-100`

**Question:** Is width/height/gridSize/gridType intentionally immutable?

**Answer:** No — the server fully supports mutation of all four. `updateMapInputSchema` lists all as optional updatable fields. `map.update` passes them through `buildMapUpdateData` and calls `assertResizeIsSafe` to reject shrinks that would leave tokens out of bounds (utils/map-helpers.ts:76-94). If the Edit Map dialog only exposes name + background, that's a client UX gap.

**Recommendation:** `ui-dev` to expose grid fields in the Edit Map dialog. No server change needed.

### Case D9 — Fog of war is a single shroud visible to all roles
**Severity:** design observation (not a bug)
**Files:** `packages/server/prisma/schema.prisma:186-192,1382-1390`, `packages/server/src/utils/map-helpers.ts:138-153`

**Question:** Is fog persisted per-user or is there a single shroud mask with a DM override?

**Answer:** Single shroud. Fog lives in `mapLayer` rows with `type: "fog"` and arbitrary JSON `data`. `mapMapDetail` filters `gmNotes` layers from non-DM viewers but passes fog as-is to everyone — there's no server-side "DM sees through fog" logic. So "Reset to all-hidden" affects all viewers identically. This is a valid model (simpler, less storage, easier to diff over WebSocket), but:

**Product question:** Is a DM-sees-through-fog rendering (e.g. 50% opacity when `user.role === "dm"`) desired? If so, the implementation is entirely client-side — the server data is correct. If a per-user fog is required, the schema needs extension (e.g. `fogOverride` JSON per `campaignMember`).

**Resolution (ux-expert, 2026-04-15):** Model #1 — DM-opacity client render. Keep the server neutral; defer the `fogOverride` schema change until someone owns stealth/vision/dynamic-lighting end-to-end. Pattern for `ui-dev`: DM fog ~35% opacity, players ~95%, paint-mode bumps DM to ~60%, warm charcoal `hsla(30, 15%, 8%, x)` instead of gray to preserve the spellbook identity. **No server change required.**

### Case D10 — Attack action has a robust discriminated-union schema
**Severity:** none (server is correct; client form is bare)
**Files:** `packages/shared/src/schemas/attack-roll-inputs.ts:36-86`

**Question:** Is the server accepting attack metadata as freeform?

**Answer:** No. `attemptAttackInputSchema` is a `z.discriminatedUnion("mode", [...])`:
- `mode: "character"` → `weaponItemId`, optional `versatile`, `criticalRange` (≥18), `extraCritDice` (0-10), `rollMode`. Server auto-computes attack/damage from character stats + inventory.
- `mode: "custom"` → `attackName` (1-100 chars), `attackBonus` (-10..99), `damageDice` (regex `^\d+d\d+$`, no modifiers in the string), `damageBonus` (-10..99), `damageType` (1-50 chars), optional crit fields, `rollMode`.

Server-side rolling and DB writes are in `services/encounter-combat/attack-action.ts` → `services/combat-actions/combat-actions.ts` with full concurrency protection via `expectedRound`/`expectedTurnIndex`. If the DM had to type every field manually, the UI isn't preloading: for character attackers, weapon dropdown should come from the participant's character inventory; for monster attackers, the action dropdown should come from the monster's `actions` JSON. Both data sources exist on the server already.

**Recommendation:** `ui-dev` pre-population work; no server change.

**Caveat on monster-action autopopulation (raised by `dm-auditor`, confirmed 2026-04-15):** `monsterActionSchema` (`packages/shared/src/schemas/monster.ts:63-66`) is `{ name: string, description: string }` — no structured attack fields. The SRD seed stores action mechanics in the `description` prose (e.g. "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 7 (1d8 + 3) piercing damage."). Two paths:
1. **Fragile regex on current data (v1, client-side only)**: parses common SRD shapes; breaks on homebrew prose. Pick this for the audit-follow-up PR.
2. **Schema upgrade (v2, roadmap)**: extend `monsterActionSchema` with an optional `attack: { bonus, damageDice, damageBonus, damageType } | null`, reseed SRD with parsed values, and migrate homebrew monsters lazily. Costlier but durable; would also enable future combat-automation.

**Confidence signal for v1 parse (raised by `dm-auditor`, 2026-04-15):** parser returns `{ confidence: "confident" | "guessed", fields: {...} }` so the custom-attack dialog can distinguish clean regex matches from partial fallbacks. `ui-dev` renders "guessed" values with a visual cue (italic placeholder color, `(from stat block)` hint, or a `title=` tooltip) so the DM reviews before committing a roll — no regression over today's behavior (empty defaults, DM types manually) in the worst case. Failure mode on homebrew prose that doesn't match: `confidence: "guessed"` with all fields empty; DM fills in manually as they do today. When v2 schema upgrade lands, the same parser becomes a one-time seed-migration helper.

Recommend (1) ship in the `ui-dev` PR; (2) tracked on the roadmap as "structured monster attacks" and paired with any server-side automation of monster turns.

### Case D11 — Token↔participant link is FK-typed with a unique constraint
**Severity:** reference answer
**Files:** `packages/server/prisma/schema.prisma:1356-1380`

**Question:** Is Token↔participant coupled by name or FK?

**Answer:** Strongly typed FK coupling.
- `MapToken.characterId String? @map("character_id")` with cascade delete when character is deleted.
- `MapToken.encounterParticipantId String? @unique @map("encounter_participant_id")` — the `@unique` means at most one token per participant.
- On participant delete, `encounterParticipantId` is set to NULL (`onDelete: SetNull`) so the token survives.

Implementation notes for the "click participant → highlight token" feature: client joins via `encounterParticipantId`. Client already receives the token list (from `mapMapDetail`) and the participant list (from `mapEncounterDetail`); a simple `Map<participantId, tokenId>` keyed off the token's FK is enough.

---

## No findings for

- Socket DB writes (none present)
- Direct `.update`/`.updateMany`/`.upsert` on locked delegates in non-helper code (none present)
- Runtime creation of SRD monsters/spells/magic items (none; only seed)
- Protected-procedure bypasses (every authenticated route uses `protectedProcedure`)
