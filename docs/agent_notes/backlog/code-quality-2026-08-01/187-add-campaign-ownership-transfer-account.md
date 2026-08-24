# 187. Account deletion promises campaign ownership transfer, but no transfer operation exists

Status: Not started
Theme: campaign ownership lifecycle · Area: cross-cutting · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Account deletion blocks a user who owns a campaign with other members and instructs them to transfer or delete it. Campaign settings offer deletion but no transfer action, and the server exposes no ownership-transfer mutation. A DM who wants to preserve the campaign therefore cannot follow the product's instruction: they must either retain the account or destroy the campaign.

This is not just a missing convenience. `Campaign.owner` cascades on user deletion, so changing `ownerId` is the operation that preserves the campaign. The repository already models owner identity, campaign membership roles, authorization logging, campaign-detail mapping, broadcasts, and cache invalidation, making the missing lifecycle step bounded.

Ownership must not be confused with the `"dm"` role. Multiple members can be DMs, and the current authorization helper checks only that role. Reusing it for transfer would allow a co-DM to take ownership.

## Evidence

- `packages/server/src/routers/auth.ts:301-330` — `auth.deleteAccount` finds campaigns owned by the current user that have another member and rejects deletion with “Transfer or delete campaigns you own before deleting your account.”
- `packages/client/src/pages/settings-page.tsx:268-280` — the account danger zone repeats the transfer instruction when it recognizes that server message.
- A re-derived production search found only those two transfer instructions under `packages/shared/src`, `packages/server/src`, and `packages/client/src`; no ownership-transfer schema, mutation, or UI action exists at the pin.
- `packages/client/src/components/campaign/settings/campaign-settings-panel.tsx:126-221` — campaign settings implement a complete delete-confirmation flow but no ownership action.
- `packages/client/src/components/campaign/settings/campaign-settings-panel.tsx:224-237` — the panel renders settings, homebrew linking, and campaign deletion only.
- `packages/server/prisma/schema.prisma:1123-1144` — `Campaign.ownerId` is persisted and indexed, and the owner relation uses `onDelete: Cascade`; deleting the owner without transfer deletes the campaign.
- `packages/server/prisma/schema.prisma:1147-1162` — campaign membership separately stores a role and has a `campaignId_userId` unique key suitable for promoting the selected member.
- `packages/server/src/routers/campaign.ts:122-143` — campaign creation sets `ownerId` and independently creates the owner's membership with role `"dm"`.
- `packages/server/src/utils/campaign-auth.ts:72-112` — `assertCampaignDm` authorizes solely through `member.role === "dm"` and does not inspect `Campaign.ownerId`.
- `packages/server/src/routers/campaign.ts:187-212` — the existing update mutation shows the local persistence → `broadcastCampaignUpdate` → `mapCampaignDetail` pattern and returns `campaignDetailSchema`.
- `packages/client/src/pages/campaign-detail-page.tsx:136-190` — the settings tab is gated by the viewer's DM role, which is broader than owner identity.
- `packages/client/src/components/campaign/settings/campaign-settings-panel.tsx:36-54` — successful settings writes already invalidate both campaign detail and campaign list caches.
- `packages/server/src/routers/auth-delete-account.test.ts:105-133` — the existing integration test creates a second member, verifies deletion is blocked, and confirms the owner still exists, providing a natural end-to-end seam for transfer coverage.

## Proposed direction

1. Add `transferCampaignOwnershipInputSchema` to `packages/shared/src/schemas/campaign-inputs.ts` with `{ campaignId, newOwnerUserId }`, both using the shared ID field, and export its inferred type.

2. Add `assertCampaignOwner` in `packages/server/src/utils/campaign-auth.ts`. It must check `campaign.ownerId === userId`, not DM membership, and emit exactly one authorization decision under a distinct closed event such as `authz.campaign.owner`. Extend the event vocabulary in `packages/server/src/utils/request-logger.ts` and its type restrictions accordingly.

   Preserve campaign authorization mismatch semantics: a nonexistent campaign returns `NOT_FOUND`; an existing campaign whose owner is someone else returns `FORBIDDEN`. Cover a non-owner DM explicitly so role-based authorization cannot accidentally return.

3. Add `campaign.transferOwnership` to `packages/server/src/routers/campaign.ts`, accepting the shared schema and returning `campaignDetailSchema`. Validate that the selected user is an existing member of this campaign and is not already the owner.

   Persist the ownership change and promotion atomically: update `Campaign.ownerId` and set the target `CampaignMember.role` to `"dm"` through one nested `campaign.update` using the `campaignId_userId` unique membership selector. Condition the update on the expected current `ownerId`, or re-check ownership inside a transaction, so two transfers or a transfer racing account deletion cannot authorize against stale ownership. Read `docs/CONCURRENCY.md` before choosing the exact guard and reject a lost race cleanly.

4. After persistence, call `broadcastCampaignUpdate` and return `mapCampaignDetail`, matching `campaign.update`. No Prisma model changes are required.

5. Add a `TransferOwnershipSection` beside `DeleteCampaignSection` in `campaign-settings-panel.tsx`. Use `useCampaignViewerScope` and render it only when `viewer.isOwner` and at least one other campaign member exists; that preserves the canonical viewer/owner derivation landed by the prior pack's [12-campaign-context-prop-drilling.md](../code-quality-2026-07-25/12-campaign-context-prop-drilling.md) V1/V2 work. Populate a member picker from `campaign.members`, excluding the current owner, and require an explicit confirmation dialog patterned after campaign deletion.

   On success, invalidate both `invalidateCampaignDetail(campaign.id)` and `invalidateCampaignList()` so the new owner, roles, and list summaries converge immediately.

6. Follow TDD using the neighboring campaign router and settings-panel suites. Server coverage must include:

   - Owner success.
   - Rejection of a player and of a non-owner member whose role is `"dm"`.
   - Rejection of a target who is not a campaign member.
   - Atomic `ownerId` change plus target-role promotion.
   - Race rejection when expected ownership has changed.
   - Campaign survival and successful `auth.deleteAccount` for the former owner after transfer.

   Extend `campaign-settings-panel.test.tsx` for owner-only rendering, exclusion of self, member selection, confirmation, mutation input, and both cache invalidations.

## Scope / caveats

- The former owner remains a `"dm"` campaign member. Demotion is explicitly out of scope; they may leave separately.
- Transfers are limited to existing campaign members. Invited users and arbitrary non-members are out of scope.
- Do not change the `auth.deleteAccount` blocking rule. A user must still transfer or delete every multi-member campaign they own.
- Do not move existing campaign mutations into a service layer; router-inline implementation matches the neighboring update and delete procedures.
- This work changes no Prisma schema and requires no migration.
- Owner identity is the binding authorization rule. Using `assertCampaignDm` would allow a co-DM to steal a campaign.
- The owner check and write must share a concurrency guard. An ordinary pre-check followed by an unconditional update is insufficient.
- Coordinate the account-deletion error path with [184-human-readable-server-messages-act-client.md](./184-human-readable-server-messages-act-client.md). If leaf 184 has not landed, keep “Transfer or delete campaigns you own before deleting your account” unchanged so the current client substring branch continues to work; if it has landed, preserve the `owned_campaigns_exist` reason code instead.
- Follow `docs/guides/add-trpc-procedure.md`, `docs/authorization.md`, and the nearest `packages/client/src/components/campaign/settings/MODULE.md` before implementation.
