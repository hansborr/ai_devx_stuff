# 252. Expose persisted notification history beyond the newest twenty rows

Status: Not started
Theme: The notification UI ignores the server cursor, making every persisted notification after the newest 20 inaccessible · Area: client · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The notification server exposes cursor-paginated history, but the client loads
only the newest twenty rows and discards the returned cursor. Once a user has
more than twenty persisted notifications, every older row becomes inaccessible
through the UI.

The server calculates `unreadCount` across all unread rows, independently of
the visible page. The bell can therefore report unread notifications that the
user cannot inspect or mark individually. With no client history path or
retention boundary, that inaccessible tail continues growing.

## Evidence

- `packages/shared/src/schemas/notification-inputs.ts:16-20` — the list input
  accepts an optional cursor and a bounded page size.
- `packages/shared/src/schemas/notification-inputs.ts:42-46` — the response
  contract includes both `nextCursor` and the global `unreadCount`.
- `packages/server/src/routers/notification.ts:31-50` — the server counts every
  unread notification for the user independently of the current page, fetches
  one extra row, and returns `nextCursor` when more rows exist.
- `packages/client/src/hooks/use-notifications.ts:57-68` — the client constructs
  an ordinary `useQuery` with a fixed limit of twenty and neither supplies nor
  consumes a cursor.
- `packages/client/src/hooks/use-notifications.ts:20-47` — the hook models one
  flat response, and its socket handler prepends directly to that single
  `notifications` array.
- `packages/client/src/hooks/use-notifications.ts:70-115` — optimistic
  mark-one and mark-all updates also traverse only the flat one-page array.
- `packages/client/src/components/notifications/notification-popover.tsx:10-12`
  and `:51-61` — the popover receives the flattened array and renders it
  without any load-more or history affordance.

## Proposed direction

Convert `useNotifications` to
`trpc.notification.list.infiniteQueryOptions(...)` with
`useInfiniteQuery`, passing the existing twenty-row limit and deriving each
next page from `lastPage.nextCursor`. Flatten `data.pages` in server order for
the hook's public `notifications` result, and expose `hasMore`, `loadMore`, and
`isFetching` alongside the existing status and mutation fields.

Add a Load more or View older notifications control beneath the loaded list.
Render it only while another page exists, disable it during any list fetch, and
guard `fetchNextPage()` with both `hasNextPage` and `!isFetching`. Use the
whole-query `isFetching` state rather than only `isFetchingNextPage`, preserving
the hooks module's existing protection against a page fetch cancelling an
in-flight refresh.

Retype the cache helpers around TanStack Query `InfiniteData`. Socket delivery
must deduplicate across every loaded page, prepend a new notification to the
first page without discarding older pages or page parameters, and increment
the cached unread count exactly once. If no cache exists yet, seed a valid
one-page infinite-data shape rather than recreating the old flat response.

Make optimistic mutations page-aware:

- Mark-one searches every page, changes the matching row once, and decrements
  the cached unread count only when that row transitioned from unread.
- Mark-all updates every loaded row and sets the cached unread count to zero.
- Both operations snapshot and restore the complete infinite cache on error,
  then retain the existing settle-time invalidation.

Add focused tests before implementation for two-page flattening and cursor
progression, affordance visibility and fetch guarding, a socket prepend with
multiple pages loaded, duplicate detection on an older page, mark-one on an
older page, mark-all across pages, and complete rollback. Extend the popover
tests to cover loading older history without disturbing notification
activation behavior.

## Scope / caveats

- Sequence after
  [064-pagination-suites-systematically-avoid-tie.md](./064-pagination-suites-systematically-avoid-tie.md).
  That proposal corrects the notification server's timestamp cursor and
  explicitly excludes client infinite-query work; this client should consume
  its settled opaque cursor contract.
- Coordinate popover and mark-read edits with
  [196-make-notifications-navigate-campaign-context.md](./196-make-notifications-navigate-campaign-context.md).
  Preserve that proposal's destination mapping, already-read navigation,
  popover closure, and missing-campaign fallback while adding history access.
- [code-quality-2026-07-25/56-infinite-list-refetch-cost.md](../code-quality-2026-07-25/56-infinite-list-refetch-cost.md)
  (CQ25-207) declined `maxPages` as a general cursor-list rule and declined
  propagating `gcTime: Infinity` to parameterized lists. Do not add either
  policy here; retain every page the user loads under the normal finite cache
  lifetime.
- Do not redesign the shared notification schemas, server pagination, unread
  counting, persistence retention, or mark-all semantics. This proposal
  consumes the existing history contract.
- Preserve reconnect invalidation, socket listener cleanup, optimistic
  rollback, and socket replay deduplication while changing the cached data
  shape.
