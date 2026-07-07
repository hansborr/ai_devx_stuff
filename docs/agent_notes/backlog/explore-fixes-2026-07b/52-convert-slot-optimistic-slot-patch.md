# 52 — Optimistically consume the spell slot in `convertSlotToPoints`

Status: Ready
Track: C (client) · Priority: P2 · Size: S · Depends on: 50

## Evidence (verified 2026-07-03; re-verify before implementing)

- `packages/client/src/hooks/character-sheet/use-sorcery-points.ts:41-44`
  — the `convertSlotToPoints` optimistic patch raises
  `stats.sorceryPoints` only.
- `packages/server/src/services/character-live-state/sorcery-point.ts:63-67`
  — the server both raises points and consumes the paying spell slot.

Failure: intermediate UI shows points increased while the just-spent slot
still renders as available, until `onSettled` invalidation + refetch
land. Wrong state a player can act on (e.g. try to cast with the
already-spent slot).

Related asymmetry, out of scope here: `createSlotFromPoints`
(`use-sorcery-points.ts:52-56`) has no optimistic patch at all — that is
a consistent "no optimism" choice, not a wrong intermediate state.

## Do

Extend the `onMutate` patch to also mark the level-`v.slotLevel` slot as
used (mirror how `use-spell-slots.ts` patches slot usage so the two hooks
stay consistent). Land after leaf 50 so the patch composes with the
async-cancel helper shape. TDD via the sorcery-points hook test.

## Verify

```
bun run test -- packages/client/src/hooks/character-sheet/use-sorcery-points.test.tsx
```

(Reconfirm the exact test filename before running.)

## Acceptance

During an in-flight conversion, the UI shows points up AND the paying
slot consumed; rollback restores both on error; tests green.
