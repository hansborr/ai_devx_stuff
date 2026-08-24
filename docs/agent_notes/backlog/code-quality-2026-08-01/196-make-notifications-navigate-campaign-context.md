# 196. Notification clicks should open the campaign context their payload already identifies

Status: Not started
Theme: notification deep links · Area: cross-cutting · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Campaign notifications already identify the campaign—and, for offline whispers,
the message—that prompted them. The client nevertheless treats every
notification as a read-state toggle. An unread notification becomes read when
clicked, while clicking an already-read notification does nothing.

Users must close the popover, find the campaign, and select the relevant tab
manually. Contributors adding notification producers can populate the existing
payload fields but have no corresponding type-to-destination policy in the
client, leaving the notification workflow visibly incomplete.

## Evidence

- `packages/shared/src/schemas/notification.ts:9-16` — the closed notification
  type vocabulary includes `invite`, `campaignAccepted`, and `whisperOffline`.
- `packages/shared/src/schemas/notification.ts:23-50` — notification data exposes
  optional `campaignId` and `messageId`; the contract documents campaign context
  for invite/accepted notices and both identifiers for offline whispers.
- `packages/server/src/services/invite-service.ts:145-154` —
  `campaignAccepted` notifications populate `data.campaignId`.
- `packages/server/src/routers/chat.ts:82-89` — an offline-whisper notification
  populates both `campaignId` and `messageId`.
- `packages/client/src/components/notifications/notification-item.tsx:45-57` —
  the click handler only calls `onRead` for an unread item and never examines
  `notification.type` or `notification.data`.
- `packages/client/src/components/notifications/notification-popover.tsx:10-19`
  and `:51-58` — the popover is uncontrolled and passes notification items only
  the read callback, so the click path can neither close it explicitly nor
  request navigation.
- `packages/client/src/routes/campaign-detail-route.ts:21-26` and
  `packages/client/src/lib/campaign-tabs.ts:1-18` — `/campaigns/$campaignId`
  validates an optional `tab` search parameter whose accepted values include
  `overview` and `chat`.

## Proposed direction

Add a notification-type-to-destination map in the notification click path so
clicking marks read and navigates: `invite` and `campaignAccepted` go to the
campaign overview, while `whisperOffline` goes to the campaign chat tab through
the route's validated `tab` search parameter. Close the popover after starting
a destination-bound navigation.

Keep the map keyed by `NotificationType`, with values drawn from `CampaignTab`,
and resolve a destination only when `data.campaignId` is present. Do not infer a
destination merely because some other notification type carries a campaign ID;
`encounterStart` and `sessionReminder` need their own product decision.

Make `NotificationPopover` control the Radix `open` state and own the navigation
callback. The activation path should mark an unread item optimistically without
making navigation wait for that mutation; already-read destination-bound items
must still navigate. A legacy or malformed notification without `campaignId`
retains the current mark-read-only behavior.

Extend the focused notification item/popover coverage to pin overview and chat
destinations, navigation from an already-read item, popover closure, and the
missing-`campaignId` fallback.

## Scope / caveats

- Message anchoring is out of scope. Preserve `messageId` for a future
  chat-scroll or permalink feature; this leaf opens the chat tab only.
- Do not assign destinations to `encounterStart`, `sessionReminder`, or `system`
  as part of this change.
- Do not change campaign authorization or make an inaccessible campaign appear
  accessible; normal campaign-route handling remains authoritative.
- The 2026-07-25 shared pack stabilized the additive `Notification.data` shape
  in
  [SHARED-CLUSTER-PLAN.md](../code-quality-2026-07-25/SHARED-CLUSTER-PLAN.md).
  This leaf consumes that shape. It must not reintroduce the discriminated
  notification schema rejected there because legacy rows can fail whole-entity
  tRPC output validation.
