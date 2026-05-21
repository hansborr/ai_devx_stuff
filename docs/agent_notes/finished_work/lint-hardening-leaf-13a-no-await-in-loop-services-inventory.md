# Leaf 13a Inventory: no-await-in-loop / server services

Status: Resolved — rule deferred for this family. See verdict register
entry dated 2026-05-19.
Generated 2026-05-19 against
feature/lint-hardening-leaf-13a-no-await-in-loop-services.
Throwaway config: /tmp/eslint-no-await-in-loop-services.config.js
(not committed).

Scope: `packages/server/src/services/**/*.ts` excluding tests.

## Resolution

- Verdict: `no-await-in-loop` **deferred** for
  `packages/server/src/services/**`. 6 of 7 findings are
  intentional-sequential (post-commit fan-out preserving observable
  order, long-rest retry) or transaction-boundary (parallel awaits
  against the same Prisma transaction client are unsafe). The single
  `promise-all-safe` candidate at `character-delete.ts:50` is a
  read-only fan-out in the deletion path — not a bug — and rewriting
  it stays out of scope for the inventory leaf.
- No production code or eslint.config.js changes landed; the rule
  stays off and the leaf records the verdict for this slice.
- The other deferred Leaf 13 rule, `no-param-reassign` with
  `{ props: true }`, is not part of this slice.

## Summary

- Total findings: 7
- intentional-sequential: 3
- promise-all-safe: 1
- transaction-boundary: 3
- rate-limit-boundary: 0
- other: 0

Config note: the first probe matched
`packages/server/src/services/level-up/level-up-test-helper.ts`; that was
treated as a test-setup scope bug and the corrected final run excluded
`*-test-helper.ts` before classification.

## Findings

### intentional-sequential

- `packages/server/src/services/character-live-state/side-effects.ts:23` —
  deduplicated character update fan-out preserves planned order; existing
  tests assert the first/second call order. Brief excerpt:

  ```ts
  for (const characterId of new Set(plan.characterIds)) {
    await emitCharacterUpdate(ctx, characterId);
  }
  ```

- `packages/server/src/services/encounter-combat/broadcast-helpers.ts:36` —
  combat/spell results carry stable-ordered affected character ids, and the
  socket event order is observable before combat chat fan-out. Brief excerpt:

  ```ts
  for (const charId of result.affectedCharacterIds) {
    await emitCharacterUpdate(ctx, charId);
  }
  ```

- `packages/server/src/services/rest-service.ts:411` — long-rest retry
  attempts depend on the previous serialization-failure outcome and stop after
  the first successful transaction. Brief excerpt:

  ```ts
  try {
    const { result, chatPayload } = await runLongRestTransaction(character, input, ctx);
    if (chatPayload && input.campaignId) {
  ```

### promise-all-safe

- `packages/server/src/services/character-delete.ts:50` — read-only
  per-encounter participant queries are independent; `Promise.all` over
  `activeParticipants` would preserve result order while collecting
  adjustments. Brief excerpt:

  ```ts
  for (const ap of activeParticipants) {
    const allParticipants = await prisma.encounterParticipant.findMany({
      where: { encounterId: ap.encounterId },
  ```

### transaction-boundary

- `packages/server/src/services/character-delete.ts:37` — inside a Prisma
  `$transaction`; `setCurrentTurnIndex` uses the same transaction client and
  must serialize turn-index CAS writes before character deletion. Brief
  excerpt:

  ```ts
  for (const adj of adjustments) {
    await setCurrentTurnIndex(tx, adj.encounterId, adj.fromIndex, adj.toIndex);
  }
  ```

- `packages/server/src/services/combat-actions/initiative.ts:44` — inside a
  Prisma `$transaction`; sorted initiative/sort-order writes share the same
  transaction client and should not run in parallel. Brief excerpt:

  ```ts
  for (const p of sorted) {
    await blindUpdateParticipant(tx, p.id, {
      initiative: p.initiative,
  ```

- `packages/server/src/services/rest-service.ts:229` — transaction-client
  hit-dice writes are pass 2 of the canonical `Stats -> CharacterClass` lock
  order, so parallel awaits against the same transaction are unsafe. Brief
  excerpt:

  ```ts
  for (const step of plan.steps) {
    await spendHitDiceLocked(tx, step.classRecordId, step.previousHitDiceUsed, step.toSpend);
  }
  ```

### rate-limit-boundary

No findings.

### other

No findings.

## Recommended next step

"Defer for this family — 6 of 7 findings are intentional sequential/transaction-boundary patterns and the rule cannot distinguish them from the 1 promise-all candidates without per-site disables."

The distribution is dominated by ordered post-commit fan-out, transaction-client
writes, and retry control flow. Only one finding is an independent read-only
loop, so adopting the rule for this family would mostly add suppressions around
deliberate service patterns rather than prevent likely bugs.
