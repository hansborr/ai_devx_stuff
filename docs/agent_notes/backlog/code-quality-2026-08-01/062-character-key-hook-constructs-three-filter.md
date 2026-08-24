# 62. useCharacterKeys builds three query-filter members and their QueryFilter type that no production caller ever reads

Status: Not started
Theme: dead cache-key surface · Area: client · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`useCharacterKeys` is the character sheet's central cache-key hook — its
module doc names it as the only place new character query keys should be
derived (`packages/client/src/hooks/character-sheet/MODULE.md:93-94`). On
every call it returns six members: three exact keys that all nine production
consumers use, and three prefix-match filter objects (`characterFilter`,
`spellsFilter`, `inventoryFilter`, typed by a local `QueryFilter` interface)
that nothing in production reads. Their doc comments claim they exist "for
broad prefix-match invalidation (socket hook)", but the socket hook takes a
different path entirely — `useCharacterSheetSocket` invalidates through
`useQueryInvalidation().invalidateCharacterSheet`, which constructs its own
query filters. The result is a phantom second invalidation API inside a
contract every character-sheet hook depends on: a contributor extending the
sheet has to work out which of the two representations is real, and every
caller allocates three filter wrappers per `characterId` change that no code
can observe.

## Evidence

- `packages/client/src/hooks/character-sheet/character-keys.ts:8-10` — the
  `QueryFilter` interface; its only use is typing the three filter members.
- `packages/client/src/hooks/character-sheet/character-keys.ts:19-24` — the
  three filter members, each doc-commented "for broad prefix-match
  invalidation (socket hook)".
- `packages/client/src/hooks/character-sheet/character-keys.ts:37-39` — all
  three `queryFilter`/`infiniteQueryFilter` wrappers constructed inside the
  hook's `useMemo` for every caller.
- Measured at the pin: each of `characterFilter`, `spellsFilter`, and
  `inventoryFilter` has exactly two production matches across the 389
  production `.ts`/`.tsx` files under `packages/client/src` — its interface
  declaration and its initializer, both in `character-keys.ts` — so zero
  production reads. The only other matches in the package are the hook's own
  test (`character-keys.test.ts:27-29`).
- Exactly nine production modules call `useCharacterKeys`, all in
  `packages/client/src/hooks/character-sheet/`: `use-character-stats.ts:102`,
  `use-character-personality.ts:17`, `use-character-level-up.ts:16`,
  `use-character-spells.ts:40`, `use-spell-slots.ts:38`,
  `use-sorcery-points.ts:44`, `use-inventory.ts:39`, `use-rest.ts:28`, and
  `use-weapon-masteries.ts:18`. Eight destructure only `characterKey`,
  `spellsKey`, or `inventoryKey`; `use-weapon-masteries.ts` binds the whole
  object but reads only `keys.characterKey` (`:23`).
- The broad invalidation the comments promise lives elsewhere:
  `packages/client/src/hooks/realtime-invalidation.ts:172-181`
  (`useCharacterSheetSocket` calls `invalidateCharacterSheet`) and
  `packages/client/src/lib/query-invalidation.ts:95-102` (which builds its
  own `queryFilter`/`infiniteQueryFilter` objects).
- `packages/client/src/hooks/character-sheet/character-keys.test.ts:23-30` —
  the "derives query filters with queryKey property" block is the sole reader
  of the three members anywhere in the repo.

## Proposed direction

Delete the `characterFilter`/`spellsFilter`/`inventoryFilter` members and the
`QueryFilter` interface from `useCharacterKeys` in
`packages/client/src/hooks/character-sheet/character-keys.ts`, dropping the
corresponding assertions in `character-keys.test.ts`; the doc-comment
correction is owned by
[105-client-source-comments-preserve-three.md](./105-client-source-comments-preserve-three.md).

Concretely: remove the interface at `character-keys.ts:8-10`, the three
members (with their attached doc comments) at `:19-24`, and the three
initializers at `:37-39`; the `QueryKey` import at `:1` stays (the exact keys
use it). In `character-keys.test.ts`, delete the second `it` block at
`:23-30`; the other two blocks (`:11-21`, `:32-42`) cover the surviving
exact-key contract and stay as-is. No consumer changes are needed — the nine
callers listed above never touch the deleted members.

## Scope / caveats

- **Deletion only — no invalidation behavior changes.** The real broad
  invalidation path (`lib/query-invalidation.ts`,
  `hooks/realtime-invalidation.ts`) is out of scope, as is any change to
  which keys the sheet hooks invalidate.
- **Comment corrections are owned by
  [105-client-source-comments-preserve-three.md](./105-client-source-comments-preserve-three.md).**
  The split is explicit: this leaf removes the members (their false "(socket
  hook)" doc comments go with them, since they are physically attached);
  leaf 105 owns correcting stale client-source comments, including any
  remaining prose about the abandoned filter design and its other two sites
  (canvas tool handlers, upload-route reference). No hard ordering, but do
  not edit `character-keys.ts` concurrently in both.
- **Do not touch the test tRPC mocks.** The mock `queryFilter` /
  `infiniteQueryFilter` members (e.g. `test/mock-trpc.tsx:318`, `:339`)
  serve `lib/query-invalidation.test.tsx` and other suites; they are not
  orphaned by this deletion.
- **Not a reopen of the landed 2026-07-25 client cluster (CQ25-117).** That
  cluster's query-layer slices reworked `lib/query-invalidation.ts` but never
  ruled on these unread return members; shrinking the hook's contract does
  not disturb anything the cluster landed, and the MODULE.md test-seam
  statement about `character-keys.ts` remains true afterwards.
