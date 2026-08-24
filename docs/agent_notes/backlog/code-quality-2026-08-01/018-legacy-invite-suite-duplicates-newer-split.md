# 18. The legacy monolithic invite suite survived the split into focused manage/join suites, duplicating 16 of its 17 cases

Status: Not started
Theme: duplicate test suites · Area: server · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Invite router behavior was split into focused suites — `invite-manage.test.ts`
(create/list/revoke) and `invite-join.test.ts` (join), alongside
`invite-preview.test.ts` and `invite-concurrency.test.ts` — but the old
monolithic `invite.test.ts` was never deleted. It still carries 17 cases across
361 lines, and 16 of them re-test contracts the split suites already pin, with
a third copy of the same DM/player/campaign `beforeEach` setup. Anyone changing
an invite contract now updates duplicate assertions in two files, and the
generic filename gives no signal about which suite is authoritative — a reader
adding a new join case has three plausible homes and no rule for choosing.
Only one case is unique: the router-level proof that a pasted join URL is
accepted and its code extracted server-side.

## Evidence

- `packages/server/src/routers/invite.test.ts` — 361 lines, 17 `it(...)` cases;
  its `beforeEach` at `:20-36` (create DM + player users, log both in, create a
  campaign) is the same setup repeated at
  `packages/server/src/routers/invite-manage.test.ts:19-31` and
  `packages/server/src/routers/invite-join.test.ts:20-32`.
- All nine management cases overlap: `invite.create` ×4 (`invite.test.ts:42-91`),
  `invite.list` ×2 (`:97-131`), `invite.revoke` ×3 (`:137-190`) each have a
  counterpart in `invite-manage.test.ts:33-209` — which is otherwise a superset,
  adding NOT_FOUND-campaign and input-validation cases (`:87-115`) and a list
  auth case (`:150-156`) the legacy suite lacks.
- Seven of the eight join cases (`invite.test.ts:196-359`, minus the pasted-URL
  case) overlap `invite-join.test.ts:46-139`, which again goes further than the
  legacy file: revoked-code rejection, DM join-notification, and
  campaign-membership assertions at `:141-197`.
- The sole unique case is "accepts a pasted join URL and extracts the code
  server-side" at `invite.test.ts:251-270`.
- URL extraction itself has shared-level unit coverage
  (`packages/shared/src/schemas/campaign-inputs.ts:112-126` —
  `extractInviteCode` and the `joinCampaignInputSchema` transform — tested at
  `packages/shared/src/schemas/campaign-inputs.test.ts:291-358`), but
  `invite.test.ts:251` is the only end-to-end proof through the
  `invite.join` procedure.

## Proposed direction

Port the one unique pasted-join-URL extraction case (`invite.test.ts:251`) into
`packages/server/src/routers/invite-join.test.ts` and delete
`packages/server/src/routers/invite.test.ts`.

Mechanics: the ported case fits `invite-join.test.ts`'s existing `createInvite`
helper (`:34-44`) — create an invite, join with a
``code: `https://app.example.com/join/${invite.code}` `` payload, assert 200 and the
returned `campaignId`, matching the suite's house style. One commit. Verify
with `bun run test -- packages/server/src/routers/invite-join.test.ts`.

## Scope / caveats

- Out of scope: restructuring the split suites, touching
  `invite-preview.test.ts` / `invite-concurrency.test.ts`, or any change to the
  router (`packages/server/src/routers/invite.ts`) or
  `services/invite-service.ts` — this is a test-only deletion plus one port.
- Two overlaps are equivalent rather than byte-identical, and porting them is
  **not** in scope: the legacy uses-increment case asserts via a direct Prisma
  read (`invite.test.ts:235-238`) where the split suite asserts through
  `invite.list` (`invite-join.test.ts:68-73`), and the legacy duplicate-join
  case has a player re-join after joining (`invite.test.ts:326-350`) where the
  split suite has the owner join (`invite-join.test.ts:111-120`). Both pairs
  pin the same contracts (uses becomes 1; already-a-member is 409), so they
  count as covered; reinstating the player-rejoin membership origin would be a
  separate coverage decision, not part of this leaf.
- The shared schema tests do not make the ported case redundant — they cover
  extraction in isolation, while the ported case is the only proof the
  transform is wired through the live `invite.join` procedure. Port it before
  deleting; do not drop it on the theory that shared already covers it.
- No sequencing edges with other leaves in this pack, and no prior-pack
  coverage of the invite suites.
