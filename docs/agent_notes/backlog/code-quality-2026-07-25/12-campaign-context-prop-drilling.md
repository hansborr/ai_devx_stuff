# 12. "Am I the DM" has three client derivations over two predicates, one of which contradicts the server's own DM check, and the boolean is re-declared 41 times across 28 files

Status: **Done 2026-07-27** in
[CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md) slices **V1 and V2**, merge
`6cf8c78d5`; see [Landed](./00-index.md#landed). The membership-role predicate,
resolver, provider and real forwarder cleanup landed. The correction is right
but currently unobservable in application-produced data. The deferred
`campaignId` behaviour change remains excluded here and is now leaf 54.
Theme: Viewer identity has no single owner · Area: client · Severity: medium · Size: L

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

The client has no owner for "who is the viewer, relative to this campaign". The answer is
recomputed in three places from **two different predicates**: `campaign-detail-page.tsx`
and `character-sheet/sheet-state.ts` both compare `campaign.ownerId === user.id` (the sheet
behind its own `trpc.campaign.get` query), while `campaign-card.tsx` asks
`campaign.role === "dm"` — the membership role. Only the third one matches the server:
every server-side DM check is `member.role === "dm"` (`assertCampaignDm`, plus `chat.ts`,
`npc.ts`, `note.ts`, `map.ts`, `map-token.ts`, `encounter.ts`), so two of the three client
derivations use a predicate the authorization layer does not use. Downstream the boolean is
then converted *back* into a role: the only two producers of the `CampaignRole` that
`lib/drawer-perms.ts` consumes are `role={isDm ? "dm" : "player"}` expressions in the two
VTT content components, so a lossy boolean is round-tripped into the type the permission
layer actually wants.

The divergence is currently latent rather than live: the only production writer of
`role: "dm"` is campaign creation, which makes the owner the sole `dm` member, so ownership
and role agree for every campaign the app can create today. It becomes a real behavioural
split the moment a second DM or a transferred campaign is possible — and the client's DM
flag is UI-only, so this is a consistency defect, not an authorization hole: the server
enforces its own predicate on every mutation regardless of what the client believes.

The boolean's second cost is breadth. Repo-wide the two campaign-identity props account for
41 `readonly isDm` declarations across 28 non-test files and 42 `readonly campaignId`
declarations across 33; the maps and combat surfaces thread the same pair in parallel. Most
of those files *do* read `isDm` — it gates tab triggers, the invite panel, the settings tab,
the maps list actions, token draggability, the map dialogs and the fog colours — so this is
not a long unconsumed chain; six of the 28 files forward it without reading it. The
cost is the size of the declaration surface, not dead transport: adding a fourth piece of
viewer context ("can I roll for this character", "am I spectating") means editing another
two dozen declarations, and the handful of pure forwarders can only be tested by supplying
props they never read.

These are one problem: because nothing owns viewer identity, it is derived inconsistently at
the top and re-declared by hand all the way down.

## Evidence

- `packages/client/src/pages/campaign-detail-page.tsx:204` — `const isDm = user?.id === campaign.ownerId;`, computed from the `campaign: CampaignDetail` prop already in hand (`:198`) and passed to `CampaignTabs` at `:212-215`. `CampaignTabs` is a local component in the same file (`:120`).
- `packages/client/src/pages/character-sheet/sheet-state.ts:30-46` — `useCampaignContext(campaignId)`, the existing viewer hook: its own `trpc.campaign.get` query at `:37-39`, `const isDm = Boolean(campaignId && campaignQuery.data && campaignQuery.data.ownerId === user?.id)` at `:40`, and `canRoll` at `:41-44`. Its sibling `useRollPermission` is at `:49-56`. Sole consumer: `pages/character-sheet/sheet-layout.tsx:116-117`. Tests: `sheet-state.test.ts:62-92` (`useCampaignContext`) and `:94-110` (`useRollPermission`).
- `packages/client/src/components/campaign/settings/campaign-card.tsx:23` — `const isDm = campaign.role === "dm";` — a third derivation, from a **different** source of truth (membership role, not ownership); it is the only one of the three that matches the server's predicate. Its `campaign` is a `CampaignSummary` (`:9-11`) rendered one-per-row from `campaign.list` at `pages/campaigns-page.tsx:62`, so it holds no campaign detail and must not acquire a per-card query.
- `packages/client/src/lib/drawer-perms.ts:3` — `export type CampaignRole = "dm" | "player"`, the type the permission layer consumes.
- `packages/client/src/components/campaign/maps/map-detail-content.tsx:95` and `packages/client/src/components/campaign/combat/combat-map-content.tsx:136` — `role={isDm ? "dm" : "player"}`, the only two producers of that `CampaignRole`.
- `packages/server/src/utils/campaign-auth.ts:72-112` — `assertCampaignDm` throws once `member.role !== "dm"` (`:95`); same predicate at `routers/chat.ts:167`, `npc.ts:134`, `note.ts:169`/`:194`, `map.ts:62`, `map-token.ts:86`, `encounter.ts:90`. The server never consults `ownerId` to decide DM-ness: repo-wide, the only non-test server read of `ownerId` is `services/invite-service.ts:153`, a data field.
- `packages/server/src/routers/campaign.ts:128-137` — the only production writer of `role: "dm"`: campaign creation, which makes the owner the sole `dm` member. Hence the two predicates cannot disagree on data the app can create today; the divergence is latent, not live.
- `packages/server/src/routers/campaign.ts:104-115` — `mapCampaignSummary` exposes the viewer's `role` on `campaign.list`, which is why `campaign-card.tsx` can read it directly. `mapCampaignDetail` (`:84-95`) does **not** carry a top-level role, but does carry `members[]` with `userId` + `role`, so the viewer's role is derivable from a `CampaignDetail` in hand without a new endpoint.
- The drill chain, walked hop by hop: `campaign-detail-page.tsx:204` → `CampaignTabs` (`:214`) → `MapsPanel` (`:181`) → `maps-panel.tsx:19`/`:99` → `map-detail-view.tsx:51`/`:88` → `map-detail-content.tsx:38`/`:107` → `map-canvas.tsx:32`/`:155` → `map-canvas-overlays.tsx:38`/`:52` → `fog-overlay.tsx:28`/`:165`. **It is consumed along the way, not only at the end**: `CampaignTabs` at `:153`/`:165`/`:183`, `maps-panel.tsx:117`/`:151`/`:156`, `map-detail-content.tsx:95`/`:149`, `map-canvas.tsx:129` (token draggability), and finally `fog-overlay.tsx:165`. Only `map-detail-view.tsx` and `map-canvas-overlays.tsx` are pure forwarders in this chain.
- Pure forwarders repo-wide (declare `isDm`, never read it): `map-detail-view.tsx`, `map-canvas-overlays.tsx`, `combat-map-panel.tsx`, `combat-map-header.tsx`, `encounters/encounter-detail-view.tsx`, `combat/initiative-tracker/initiative-row.tsx` — six of the 28 files.
- `packages/client/src/components/campaign/maps/fog-overlay.tsx:165-166` — the deepest consumer: `FOG_COLOR_DM`/`FOG_COLOR_PLAYER`, `FOG_OPACITY_DM`/`FOG_OPACITY_PLAYER`.
- `packages/client/node_modules/react-konva/es/ReactKonvaCore.js` (version at `:149` — 19.2.4) — `:18` imports `useContextBridge, FiberProvider` from `its-fine`; `:153-154` wraps `StageWrap` in `FiberProvider`; `:48` takes `const Bridge = useContextBridge()` and `:94`/`:113` render `props.children` inside that `Bridge`. **React context therefore does propagate across the Konva reconciler out of the box**; no hand-written bridge is required.
- Counts (non-test files): 41 `readonly isDm` declarations across 28 files — 24 named interfaces plus 17 inline function-parameter type literals; 42 `readonly campaignId` declarations across 33 files.

## Proposed direction

1. **Adopt the server's predicate: membership role.** This is not an open product question —
   `assertCampaignDm` and every DM-gated router already define DM as `member.role === "dm"`,
   so the client aligning on ownership is the drift. Record the decision in a one-line note
   on the canonical helper (and in `packages/client/src/components/campaign/settings/MODULE.md`
   if that doc is otherwise touched). The only thing to confirm before writing code is that
   `campaign.get`'s `members[]` is the intended client source for the viewer's own role
   (it is: `mapCampaignDetail` includes `userId` + `role` per member).
2. **Put the predicate in one pure function, not one hook.** Add
   `campaignViewer(campaign, userId): { userId, role: CampaignRole | null, isDm }` in
   `packages/client/src/lib/`, accepting either a `CampaignDetail` (role from
   `members.find(m => m.userId === userId)?.role`) or a `CampaignSummary` (role from
   `campaign.role`), and deriving `isDm` *from* `role` — not the reverse. A pure function is
   the load-bearing choice: the two derivation sites that matter already hold a campaign
   object, and a hook-only design would force a query on each of them. Land it with tests
   and no call-site changes.
3. **Add `useCampaignViewer(campaignId)` only for the caller that holds no campaign object.**
   Today that is exactly one: the character sheet, which is the top-level route
   `/characters/$characterId` (`routes/character-sheet-route.ts:16-22`) with no
   campaign-detail ancestor, so it must fetch `campaign.get` itself. The hook wraps that
   query plus `campaignViewer`, and **replaces** `sheet-state.ts:30`'s existing
   `useCampaignContext` — move and rename rather than adding a second hook, or the codebase
   gains two adjacent viewer abstractions with nearly the same name. Carry `canRoll` across
   with it (either as a returned callback or as a thin `useRollPermission` next to it),
   move `sheet-state.test.ts:62-110` alongside, and update the single call site
   `sheet-layout.tsx:116-117`.
4. Repoint the three derivations, one commit each: `campaign-detail-page.tsx:204` calls
   `campaignViewer` on the `campaign` prop it already has; `campaign-card.tsx:23` calls it on
   the `CampaignSummary` it already has (behaviour-identical — it is already role-based — and
   it must stay query-free, since it renders once per row); `sheet-layout.tsx:116` moves to
   `useCampaignViewer`. No behaviour change is expected on current data, because owner and
   sole `dm` member coincide; a unit test that seeds a non-owner `dm` member and an owner who
   is not a member is the honest regression guard, and it is cheaper and more direct than an
   e2e. Re-read `docs/guides/add-client-feature-module-cache-socket.md` before touching the
   sheet's `campaign.get` usage.
5. Replace `role={isDm ? "dm" : "player"}` at `map-detail-content.tsx:95` and
   `combat-map-content.tsx:136` with the viewer's `role` directly, so `CampaignRole` stops
   being reconstructed from a lossy boolean and `drawer-perms.ts` gets the real value.
6. Add a campaign-viewer provider at the campaign-detail-page level carrying
   `{ campaignId, viewer }` — give it a name that cannot be confused with the hook that
   survives step 3 — and delete the `isDm` prop from the pure forwarders first:
   `map-detail-view.tsx`, `map-canvas-overlays.tsx`, `combat-map-panel.tsx`,
   `combat-map-header.tsx`, `initiative-row.tsx`, `encounter-detail-view.tsx` — since those
   removals cannot change behaviour. Then work outward through the consuming hops
   (`CampaignTabs` → `maps-panel.tsx` → `map-detail-content.tsx`) one file per commit. The
   provider covers the campaign-detail route only; the character sheet keeps the hook.
7. The Konva boundary is **not** a stopping point: react-konva 19.2.4 bridges context across
   `<Stage>` (`ReactKonvaCore.js:48`/`:94`/`:153-154`), so `map-canvas.tsx`,
   `map-canvas-overlays.tsx` and `fog-overlay.tsx` can read the context directly. Decide
   that hop on its merits, not on a technical barrier that is not there: prove the bridge
   with one test that renders a `<Stage>`-hosted consumer under the provider *before*
   converting `fog-overlay.tsx`, and keep the props if the canvas components' current
   explicit-prop testability is judged worth more than three deleted declarations.

## Scope / caveats

- React context crosses the Konva reconciler with the installed react-konva: 19.2.4 wraps
  `Stage` in `its-fine`'s `FiberProvider` and renders children through `useContextBridge()`,
  so context reaches `map-canvas-overlays.tsx`/`fog-overlay.tsx` unaided. Do not plan around
  a barrier — and equally, do not assume the bridge: pin it with the test in step 7, because
  it is a property of the installed version and a react-konva upgrade could change it.
- **Do not sell this as a security or authorization fix.** `isDm` on the client only chooses
  which affordances render; every DM-gated operation is re-checked server-side by
  `assertCampaignDm` and its per-router equivalents. The worst outcome of the current
  divergence is a button shown or hidden incorrectly, and only for data no production write
  path can currently create (owner is always the sole `dm` member). That is why this is
  medium severity for consistency and maintenance, not high.
- Do not collapse the two campaign ids the character sheet holds. `sheet-layout.tsx:112-114`
  uses `character.campaignId` for room membership and socket wiring, while
  `useCampaignContext` at `:116` takes the URL search param; `pages/MODULE.md:95-97` states
  that "Character sheet room membership uses `character.campaignId` as authoritative; the
  URL `campaignId` remains a context fallback for navigation from a campaign page." Feed
  `useCampaignViewer` the same id the current hook receives. Whether the sheet should derive
  DM-ness from `character.campaignId` instead is a separate behaviour change with its own
  doc update; it is not part of this leaf.
- If the two predicates turn out to be *both* wanted (ownership for destructive campaign
  actions such as delete/transfer, membership role for table permissions), the right outcome
  is two clearly named values — `isOwner` and `isDm` — not one. Do not force a merge; the
  server already models them separately (`campaign.ownerId` vs `CampaignMember.role`).
- Do not fold `campaignId` removal into the same commits as `isDm`. It appears on 42
  declarations and many of those components genuinely need it for query keys; churning both
  props at once makes the diff unreviewable. Sequence `isDm` first, then assess whether
  `campaignId` is worth the same treatment at all.
- Sequencing: this leaf is **last** of the three that rewrite `map-detail-content.tsx` and
  `combat-map-content.tsx`. Land **leaf 10**'s reset/store work first, then **leaf 13**'s
  canvas-shell extraction, then steps 5-7 here — otherwise the prop deletions land on JSX
  that leaf 13 is about to move, and every conflict is in the same two files. Note that if
  leaf 13's `<MapCanvasFrame>` lands first, `isDm` is passed through one fewer hand-written
  hop here. Leaf 11 also edits `map-canvas-overlays.tsx` (the `activeTool: string`
  declarations at `:34`, `:124`, `:146`), but only those; this leaf touches only the `isDm`
  prop, so the two can land in either order — just not concurrently in that file.
- Update `packages/client/src/components/campaign/maps/MODULE.md`,
  `packages/client/src/components/campaign/combat/MODULE.md` and
  `packages/client/src/pages/MODULE.md` to name the new owner of viewer identity
  (`docs/guides/add-module-doc.md`).
