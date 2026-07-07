# 50 — Await query cancellation inside `snapshotAndSet`

Status: Ready
Track: C (client) · Priority: P1 · Size: S

## Evidence (verified 2026-07-03; re-verify before implementing)

- `packages/client/src/hooks/character-sheet/cache-helpers.ts:22-32` —
  `snapshotAndSet` snapshots and patches the cache synchronously with no
  `cancelQueries`.
- Every character-sheet optimistic `onMutate` uses it:
  `use-character-stats.ts:106,125`; `use-spell-slots.ts:40,59,76`;
  `use-sorcery-points.ts:41`; `use-inventory.ts:60,77`;
  `use-character-spells.ts:50,63`; `use-character-personality.ts:21`.
- `packages/client/src/hooks/use-notifications.ts:72-74,98-100` — the
  house-correct pattern: `await queryClient.cancelQueries(...)` before
  snapshotting.

Failure: a socket-driven `character:updated` invalidation starts a
`character.get` refetch; the player then uses a spell slot / adjusts HP;
the in-flight refetch resolves with the pre-click snapshot and overwrites
the optimistic value (pip flips back until `onSettled` re-invalidates).
Also: two rapid mutations on the same key — B snapshots A's optimistic
state, A errors, `restoreSnapshot` clobbers B. Self-healing but visible
flicker/regression on the live sheet during combat.

## Do

Adversarial-triage fix shape: change the shared helper, not eight hand
edits — make `snapshotAndSet` async, `await
qc.cancelQueries({ queryKey: key })` before `getQueryData`/`setQueryData`
(TanStack Query supports async `onMutate`; the returned context shape is
unchanged). Update the cache-helpers unit tests to `await` and add an
ordering assertion (cancel before read). Spot-check each caller's
`onMutate` still typechecks (they become promise-returning).

## Verify

```
bun run test -- packages/client/src/hooks/character-sheet
```

## Acceptance

All character-sheet optimistic writes cancel in-flight queries before
snapshotting; rollback contexts unchanged; hook-family tests green.
