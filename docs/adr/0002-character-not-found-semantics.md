---
id: ADR-0002
date: 2026-07-25
status: Accepted
enforced_by:
  - test-file:packages/server/src/utils/character-auth.test.ts
  - test-file:packages/server/src/utils/campaign-auth.test.ts
  - test-file:packages/server/src/routers/character-level-up.test.ts
guide: docs/guides/add-trpc-procedure.md
---

# Character ownership mismatch returns NOT_FOUND

## Context

`FORBIDDEN` on a character-by-id lookup confirms that the character exists and
belongs to someone else. That turns any character-scoped procedure into an
enumeration oracle: a caller can walk the id space and harvest valid character
ids without owning any of them. Campaign membership does not carry the same
risk, because a campaign's existence is already discoverable through invites
and member lists.

## Decision

`assertCharacterOwner`, `assertCharacterAccess`, `assertCharacterOwnerOrAccess`,
and `assertCharacterLinkedToCampaign` throw `NOT_FOUND` on every deny path,
defaulting to the message `Character not found`. A missing character and a
character owned by another user are indistinguishable on the wire — same code,
same message, same shape. `assertCampaignMember` and `assertCampaignDm`
deliberately diverge: missing campaign is `NOT_FOUND`, a real campaign the
caller cannot reach is `FORBIDDEN`.

The code is the invariant; the message is not universal.
`assertCharacterLinkedToCampaign` takes an optional `notFoundMessage`, and
`createInventoryItem` passes `Homebrew entry not available for this campaign` so
the error names the resource the caller was actually reaching for. That is
sound only because it is unreachable before ownership is proven: the same
service asserts `assertCharacterOwner` first, so a caller who sees the homebrew
message already owns the character and learns nothing new about it. An override
on a deny path that a non-owner can reach would reintroduce the oracle, so a new
`notFoundMessage` needs that ordering argument or the default message.

The audit trail carries what the response drops. Each deny path emits a
structured `logAuthzDecision` entry whose `reason` discriminates
`character_not_found`, `not_owner`, `not_owner_or_dm`, and
`character_not_linked_to_campaign`. Masking is a response-shape decision, not a
logging decision.

The doctrine extends by analogy to resources whose existence is itself
sensitive — notes, notifications, private homebrew collections, invite tokens.
Prefer `FORBIDDEN` only where existence is already public.

## Consequences

New character-scoped procedures call the existing helpers instead of
hand-rolling a `FORBIDDEN` branch; the collapsed code is the feature, and a
reviewer seeing `NOT_FOUND` on an authorization failure should not "correct" it.
Widening a deny path means adding a `reason` to the authz log, not a new error
code. Follow `docs/authorization.md` for the full visibility map and the linked
guide's auth step for the procedure recipe. The character-auth tests pin the
masking, the campaign-auth tests pin the deliberate `FORBIDDEN` contrast, and
the level-up router test pins that the mismatch still reaches HTTP as 404.
