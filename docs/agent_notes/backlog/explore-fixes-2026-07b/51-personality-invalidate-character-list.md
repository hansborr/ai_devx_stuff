# 51 — Invalidate `character.list` after a personality update

Status: Ready
Track: C (client) · Priority: P1 · Size: XS

## Evidence (verified 2026-07-03; re-verify before implementing)

- `packages/client/src/hooks/character-sheet/use-character-personality.ts:31-33`
  — `onSettled` invalidates only `characterKey` (`character.get`).
- `packages/server/src/routers/character.ts:131-143` — `updatePersonality`
  can change `name` and `visibility`.
- `packages/server/src/utils/character-mapping.ts:121-127` — the
  `character.list` summary carries both fields.
- `packages/client/src/lib/query-client.ts:3` — global `staleTime` 30s;
  `character.list` is per-user with no socket-driven invalidation path.

Failure: rename a character on the sheet, navigate back to the character
list within 30s — the list still shows the old name/visibility because
the list query is "fresh" and never refetches.

## Do

TDD: extend the personality hook test to assert the list key is
invalidated, then invalidate the `character.list` key alongside
`characterKey` in `onSettled` (derive the key the same way sibling hooks
do — reconfirm with `bun run code:intel refs` how list keys are built).

## Verify

```
bun run test -- packages/client/src/hooks/character-sheet/use-character-personality.test.tsx
```

(Reconfirm the exact test filename before running.)

## Acceptance

After a personality mutation settles, both the sheet detail and the
character list refetch; no other hook behavior changes.
