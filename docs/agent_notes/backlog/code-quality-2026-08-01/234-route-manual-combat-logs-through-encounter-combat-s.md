# 234. Route manual combat logs through encounter-combat's fan-out coordinator

Status: Not started
Theme: Manual combat logs bypass the encounter-combat fan-out coordinator · Area: server · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Manual combat-log creation performs the same post-persistence encounter and
combat-chat delivery sequence as other encounter-combat mutations, but
reconstructs that sequence locally. Ordering, failure-policy, logging, or
payload changes made in the module's coordinator can therefore omit the manual
log path.

The duplication also contradicts the module's documented request-facing
boundary: `addCombatLog` is listed among entry points that own fan-out through
`fanOutBroadcasts`, yet it directly calls the two lower-level broadcasters.

## Evidence

- `packages/server/src/services/encounter-combat/combat-log.ts:18-25` —
  `chatOpts` locally reconstructs the context, campaign, user, and logger
  options already assembled by the shared coordinator.
- `packages/server/src/services/encounter-combat/combat-log.ts:50-70` — after
  persisting the structured log, `addCombatLog` directly broadcasts the
  encounter update and then awaits combat-chat delivery.
- `packages/server/src/services/encounter-combat/broadcast-helpers.ts:25-54` —
  `fanOutBroadcasts` owns the standard encounter, affected-character, and
  optional combat-chat sequence.
- `packages/server/src/services/encounter-combat/MODULE.md:43-49` — the module
  contract says its request-facing entry points own their auth assertions and
  `fanOutBroadcasts` fan-out.
- `packages/server/src/services/encounter-combat/combat-log.test.ts:21-23` —
  current focused tests deliberately supply an empty server, making the
  encounter update and combat-chat socket emit no-ops while leaving combat-chat
  persistence unasserted; they do not verify the paths' coordination.

## Proposed direction

After the existing `combatLog.create`, pass a result-shaped value to
`fanOutBroadcasts` with `affectedCharacterIds: []` and a chat payload containing
the manual log's `description`, `action`, and an empty
`concentrationDescriptions` array. Await that coordinator before returning the
mapped structured log, preserving the current persistence-then-encounter-then-
chat ordering.

Delete `chatOpts` and the now-unused direct imports of
`broadcastEncounterUpdate`, `broadcastCombatChat`, `CombatChatOpts`,
`getSocketIO`, and replace them with the coordinator import. Do not introduce a
second manual-log-specific adapter around the coordinator.

Extend `combat-log.test.ts` with an observable socket context that proves one
manual-log call persists the structured log, emits the encounter update, emits
the corresponding combat-chat message, and emits no character update. Retain
the coordinator tests that pin ordering and best-effort chat failure behavior.

## Scope / caveats

- Preserve authorization, active-encounter validation, participant ownership
  checks, structured-log persistence, mapping, and return shape.
- Preserve the current post-persistence ordering and failure policy. Do not
  make combat-chat failures escape or make encounter delivery best-effort
  unless a separately approved policy proposal changes those semantics.
- Rebase against
  [001-chat-persistence-delivery-policy.md](./001-chat-persistence-delivery-policy.md)
  if it changes the combat-chat surface, and do not implement overlapping
  combat-chat edits concurrently.
- [code-quality-2026-07-25/SERVER-COMMENTS-PLAN.md](../code-quality-2026-07-25/SERVER-COMMENTS-PLAN.md)
  (CQ25-75) leaves the placement of combat-chat orchestration in `utils/` as a
  services-versus-utils taxonomy question. This proposal does not reopen that
  question; it only removes an intra-module bypass of the existing
  coordinator.
