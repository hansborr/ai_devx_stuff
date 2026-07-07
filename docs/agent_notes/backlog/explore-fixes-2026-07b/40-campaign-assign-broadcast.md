# 40 — Broadcast `campaign:updated` after character assign/unassign

Status: Ready
Track: SV (server) · Priority: P1 · Size: S

## Evidence (verified 2026-07-03; re-verify before implementing)

- `packages/server/src/routers/campaign.ts:208` — `campaign.update`
  broadcasts `campaign:updated` via `broadcastCampaignUpdate`.
- `packages/server/src/routers/campaign.ts:224-292` — `assignCharacter`
  and `unassignCharacter` mutate `CampaignDetail.members[].character`
  (`mapMemberDetail`, `:62-81`) but never broadcast; that helper is the
  file's only broadcast call site.
- `packages/client/src/hooks/realtime-invalidation.ts:66-76` — the client
  handler for `campaign:updated` already drives `invalidateCampaignDetail`.

Failure: DM has the campaign roster open; a player assigns their
character; the DM's roster shows "no character" for up to the 30s
staleTime instead of updating live like a name/description edit does.
Inconsistency bug — all infrastructure exists.

Overlap check: `../../finished_work/socket-emit-inventory.md` classifies
registry-vs-direct emits only; it does not record these as intentional
non-broadcasts.

## Do

TDD: extend the campaign router tests to assert the broadcast fires for
both mutations (mirror how `campaign.update`'s broadcast is asserted),
then call `broadcastCampaignUpdate` after persistence in both handlers —
after the mutation commits, matching the file's existing
broadcast-after-persistence ordering.

## Verify

```
bun run test -- packages/server/src/routers/campaign.test.ts
```

## Acceptance

Assign and unassign both emit `campaign:updated` after persistence;
existing auth/validation behavior unchanged; router tests green.
