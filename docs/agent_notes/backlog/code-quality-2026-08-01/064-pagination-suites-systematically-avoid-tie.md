# 64. Pagination suites never seed equal-order-key rows at page boundaries, so three timestamp-cursor endpoints silently skip tied rows today and none of the five can catch a tie regression

Status: Not started
Theme: pagination tie coverage · Area: tests · Severity: high · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Five server pagination surfaces — chat messages, notifications, combat logs,
magic items, and monsters — each have a dedicated "paginates with cursor" test,
and every one of those tests builds fixtures in which the ordering keys are
unique by construction. The notification helper spaces every `createdAt` by one
second; the combat-log helper's seed function is explicitly documented as
producing strictly increasing timestamps; the chat test posts messages
sequentially over HTTP and never forces equality; the magic-item and monster
tests page through the seeded SRD corpus and assert only that the second page
is non-empty and does not overlap the first. Across the five suites — 1,385
lines in total — there is not a single intentional equal-order-key
page-boundary case.

That means the tests certify pagination only under the one condition where
tie-breaking is unnecessary. The gap is not hypothetical, and it splits into
two production shapes that must not be conflated:

- **Chat, notification, and combat-log paginate on a bare timestamp with no
  tie-breaker.** The cursor value *is* `lastItem.createdAt.toISOString()`, and
  the next page filters `createdAt: { lt: ... }` (chat, notification) or
  `{ gt: ... }` (combat log). Two rows sharing the boundary timestamp — easy
  for bulk-created notifications or combat-log entries written in one burst —
  are skipped: the strict inequality excludes every row equal to the cursor,
  not just the ones already returned. This is a live data-loss defect that the
  suites are structurally incapable of seeing.
- **Magic-item and monster already use a unique id as the cursor value**
  (Prisma `cursor: { id }, skip: 1`), so nothing is skipped — but their
  `orderBy` is non-total (`name` alone; `challengeRating, name`). Two items
  with the same name, or two monsters tied on CR and name, have no defined
  relative order, so page composition at such a boundary is
  database-plan-dependent and can duplicate or reorder rows across pages.

Because the fixtures avoid ties, any of this can regress — or stay broken —
while every current assertion stays green. Contributors reading the suites
reasonably conclude cursor pagination is covered; it is covered only for the
inputs that cannot exercise it.

## Evidence

- `packages/server/src/test/notification-test-helper.ts:22-31` — the shared
  notification fixture sets
  `createdAt: new Date(Date.now() - (count - i) * MS_PER_SECOND)` (`:29`),
  spacing every row by one second; equal-timestamp boundaries cannot occur.
- `packages/server/src/services/encounter-combat/combat-log.test.ts:176-192` —
  `seedLogs` is commented "Insert `count` logs with strictly increasing
  createdAt so cursor/order is deterministic" (`:176`) and writes
  `createdAt: new Date(base + i * 1000)` (`:188`).
- `packages/server/src/routers/chat.test.ts:165-206` — the sole chat
  pagination case posts five messages sequentially over HTTP, then asserts
  page lengths and two content positions (`:187`, `:205`); it neither forces
  equal timestamps nor asserts the complete ID sequence.
- `packages/server/src/routers/magic-item.test.ts:85-113` — asserts the second
  page is non-empty (`:108`) and disjoint from the first (`:109-112`), nothing
  about completeness or order at the boundary;
  `packages/server/src/routers/monster.test.ts:101-130` is the same shape.
- Measured at the pin: the five suites (`chat.test.ts` 269 + `notification.test.ts`
  165 + `magic-item.test.ts` 311 + `monster.test.ts` 370 + `combat-log.test.ts`
  270) total exactly 1,385 lines and contain zero equal-order-key
  page-boundary cases.
- `packages/server/src/routers/chat.ts:185-195` — cursor filter
  `createdAt: { lt: new Date(input.cursor) }` (`:185`), `orderBy:
  { createdAt: "desc" }` alone (`:188`), and
  `nextCursor = lastItem.createdAt.toISOString()` (`:195`): a timestamp-only
  cursor with strict inequality, so equal-timestamp boundary rows are skipped.
- `packages/server/src/routers/notification.ts:28-45` — identical shape:
  `createdAt: { lt: ... }` (`:28`), `orderBy: { createdAt: "desc" }` (`:34`),
  ISO-timestamp `nextCursor` (`:45`).
- `packages/server/src/services/encounter-combat/combat-log.ts:92-106` —
  `createdAt: { gt: new Date(input.cursor) }` (`:92-94`) against
  `orderBy: [{ round: "asc" }, { createdAt: "asc" }]` (`:99`), timestamp
  `nextCursor` (`:106`): same skip defect, ascending direction, round-major
  ordering.
- `packages/server/src/routers/magic-item.ts:108-110` — id cursor
  (`cursor: { id: input.cursor }, skip: 1`) but `orderBy: { name: "asc" }`
  only: a non-total order.
  `packages/server/src/routers/monster.ts:159-161` — id cursor with
  `orderBy: [{ challengeRating: "asc" }, { name: "asc" }]`, also non-total.
- Wire cursors are already opaque strings:
  `packages/shared/src/schemas/chat-inputs.ts:41`,
  `notification-inputs.ts:18`, and `encounter-inputs.ts:282` declare
  `cursor: z.string().optional()`; `magic-item-inputs.ts:23` and
  `monster-inputs.ts:34` use `idField.optional()`.
- Client consumers never inspect cursor contents:
  `packages/client/src/components/campaign/npcs/monster-tab.tsx:230` and
  `components/compendium/magic-item-list.tsx:141` round-trip `nextCursor`
  opaquely via `getNextPageParam`; the chat panel
  (`components/campaign/chat/chat-panel.tsx:185`), notifications hook
  (`hooks/use-notifications.ts`), and encounter detail view
  (`components/campaign/encounters/encounter-detail-view.tsx:233-234`) issue
  single-page queries that send no cursor at all today.

## Proposed direction

Keep the test spine, but this leaf is **not test-only**: for three of the five
endpoints the new tie tests are expected to fail against current production
(the equal-timestamp skip described above), so the leaf carries the cursor
fixes those tests force. Follow TDD — land the failing tie tests first, then
the fixes, in one leaf.

**Test spine (all five endpoints).** Seed multiple pages containing several
rows that share the boundary sort tuple, traverse pages until `nextCursor` is
null, and assert the exact ordered ID sequence with no omissions or
duplicates. Tie fixtures must be seeded via direct Prisma inserts with
explicitly pinned equal `createdAt` values — extend the
`notification-test-helper.ts:22-31` seeding pattern; chat's HTTP `sendMessage`
path cannot force equal timestamps. Each tie test must assert its own tie
precondition by reading back the seeded timestamps, so that DB defaults or
timestamp-precision quirks cannot let the case go vacuously green.

**Production fix, shape 1 — chat, notification, combat-log** (timestamp-only
cursor, no tie-breaker; `chat.ts:185-195`, `notification.ts:28-45`,
`combat-log.ts:92-106`): converge on the id-cursor idiom the repo already uses
in magic-item/monster — Prisma `cursor: { id: lastItem.id }, skip: 1`, with
`orderBy` extended to end in `id`: `[{ createdAt: "desc" }, { id: "desc" }]`
for chat and notification; `[{ round: "asc" }, { createdAt: "asc" },
{ id: "asc" }]` for combat-log, keeping round-major order. The wire cursor
stays an opaque `z.string()` — `nextCursor` becomes an id instead of an ISO
timestamp; clients round-trip it opaquely (and the chat, notification, and
combat-log clients currently send no cursor at all), so no shared-schema or
client change is needed. Do not add cursor-format validation to the schemas.

**Production fix, shape 2 — magic-item, monster** (cursor value already a
unique id; the gap is only the non-total `orderBy`): append `id: "asc"` as the
terminal `orderBy` key at `magic-item.ts:108` and `monster.ts:159`, and add
duplicate-name (and, for monster, duplicate-CR+name) fixtures straddling a
page boundary.

Do not describe all five discriminators as "cursor keys" while working this:
magic-item/monster have a correct unique cursor and a defective ordering,
while chat/notification/combat-log have a defective cursor. The fixes differ
accordingly.

The encounter-combat service directory has a MODULE.md
(`packages/server/src/services/encounter-combat/MODULE.md` — `listCombatLogs`
is described as "cursor-paginated" at `:19` and `:71`); read it before editing
`combat-log.ts` and update it if the wording implies timestamp-cursor
semantics. Per-suite runs go through the root script, e.g.
`bun run test -- packages/server/src/routers/chat.test.ts`.

## Scope / caveats

- **Out of scope:** client cache/infinite-query changes, whisper-visibility
  filtering in chat, offset-style pagination elsewhere, and any redesign of
  the shared cursor input schemas.
- **Cursor payload change is a wire-behavior change.** Switching
  chat/notification/combat-log `nextCursor` from ISO timestamps to ids
  invalidates any persisted or in-flight cursor and would break any consumer
  that parses the cursor as a date. Re-verify at implementation time by
  grepping client and server for cursor parsing; as of the pin, the only
  `getNextPageParam` users are monster/magic-item (opaque), and the three
  affected endpoints' clients send no cursor.
- **Combat-log round-major ordering is the trap.** An id cursor without
  `round` retained ahead of `createdAt` in `orderBy` interleaves rounds;
  equal-`createdAt`-across-different-round rows are the case most likely to be
  mis-fixed. Cover it explicitly.
- **Tie fixtures can silently stop being ties.** Seeded "equal" timestamps can
  diverge via DB defaults or timestamp precision — hence the mandatory
  tie-precondition assertion in every tie test.
- `packages/shared/src/schemas/encounter-inputs.test.ts:1003-1009` passes an
  ISO-timestamp literal as a valid cursor. It still passes (the schema is an
  opaque string), but update the literal to an id-shaped value so the fixture
  stops implying timestamp semantics.
- Serialize with leaf 024. If 024 lands first, apply the id-shaped combat-log
  cursor fixture update in encounter-combat-inputs.test.ts; if 064 lands first,
  024 must carry that updated fixture while splitting the test file.
- No prior-pack ruling owns server-side pagination test coverage.
