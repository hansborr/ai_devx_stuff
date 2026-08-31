# 105. Three client comments document superseded contracts: a phantom onFinalize snapshot argument, an abandoned socket-filter design, and a nonexistent server file

Status: Landed on fix/cq-228
Theme: stale boundary comments · Area: docs · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Three comments in the client source describe integration contracts that no
longer exist, and each one sits exactly where a reader goes to understand the
boundary it misdescribes. The canvas-input `ToolHandler` interface promises
that `onFinalize` "receives a pre-mutation store snapshot" — but the signature
takes no argument and the dispatcher passes none, so a handler author who
trusts the doc writes a parameter that is never supplied. The character-sheet
key hook documents its three `queryFilter` members as the surface "for broad
prefix-match invalidation (socket hook)" — but the actual socket hook
(`useCharacterSheetSocket`) invalidates through a different path and no
production code reads any of the three filters; the prose justifies members
whose stated consumer abandoned them. And the map-image upload hook's
type-assertion-boundary comment tells the reader to verify the response shape
against `packages/server/src/routes/uploads.ts`, a file that does not exist —
the route lives in `upload-routes.ts`, so the one pointer meant to make the
cast checkable leads nowhere. Stale prose at a boundary is worse than no
prose: it costs each new reader a false model plus the time to disprove it.

## Evidence

- `packages/client/src/hooks/canvas-input/tool-handlers.ts:30-31` — "Called
  on mouseUp. Receives a pre-mutation store snapshot." directly above
  `onFinalize?(): void;`, a signature with no parameter.
- `packages/client/src/hooks/canvas-input/use-canvas-input.ts:108-112` — the
  mouseUp dispatcher calls `handler?.onFinalize?.();` with no argument.
- `packages/client/src/hooks/character-sheet/character-keys.ts:19-24` — the
  three filter members are each documented "for broad prefix-match
  invalidation (socket hook)"; they are constructed for every caller at
  `:37-39`.
- `characterFilter`, `spellsFilter`, and `inventoryFilter` have zero
  non-test reads outside their declarations and initializers: a fixed-string
  `git grep` over `packages/client/src` finds only `character-keys.ts` itself
  and `character-keys.test.ts:27-29`.
- The socket hook the comments point at, `useCharacterSheetSocket`
  (`packages/client/src/hooks/realtime-invalidation.ts:172-178`), invalidates
  via `useQueryInvalidation` and never imports `useCharacterKeys`.
- `packages/client/src/hooks/use-map-image-upload.ts:83-88` — the
  `type-assertion-boundary: json` comment cites
  `packages/server/src/routes/uploads.ts`; no such file exists
  (`packages/server/src/routes/` contains `upload-routes.ts`).
- `packages/server/src/routes/upload-routes.ts:56-59` — the actual success
  contract, `UploadSuccessResponse { url: string; size: number }`.

## Proposed direction

Correct the three stale comments to match current code — the
`tool-handlers.ts` `onFinalize` doc (no snapshot argument), the
`character-keys.ts` socket-filter prose (the filters have zero production
reads), and the `use-map-image-upload.ts` path `uploads.ts` →
`upload-routes.ts` — and route removal of the unused `CharacterKeys` filter
members to the client implementation lane
([062-character-key-hook-constructs-three-filter.md](./062-character-key-hook-constructs-three-filter.md)).

Mechanics, treating the TypeScript signatures, the production reference
graph, and `upload-routes.ts` as authoritative:

1. `tool-handlers.ts:30` — replace the snapshot sentence with what the
   dispatcher does: called on mouseUp with no arguments; handlers read
   current state from `useMapCanvasStore` themselves.
2. `character-keys.ts:19-24` — drop the "(socket hook)" claim from the three
   filter-member docs. If leaf 062 has not yet removed the members, describe
   them as currently test-only until that leaf lands; do not invent a new
   justification for them here.
3. `use-map-image-upload.ts:86` — point the comment at
   `packages/server/src/routes/upload-routes.ts`. The success body there is
   `{ url: string; size: number }`; the existing `as { url: string }` cast
   reads a safe subset and needs no change — the comment may note the
   subset explicitly.

## Scope / caveats

- Comment-only changes: no signatures, no runtime behavior, no test edits.
- Removing `characterFilter`/`spellsFilter`/`inventoryFilter` (and their
  `character-keys.test.ts:27-29` assertions) is explicitly out of scope
  here — it is owned by
  [062-character-key-hook-constructs-three-filter.md](./062-character-key-hook-constructs-three-filter.md).
  The two leaves partition cleanly (prose here, members there), but if 062
  lands first, step 2 collapses to deleting the three doc lines along with
  the members; avoid editing `character-keys.ts` in both leaves
  concurrently.
- The `use-map-image-upload.ts` comment is a
  `type-assertion-boundary: json` marker block; keep the
  `type-assertion-boundary: json -` marker line intact when rewording
  (see `docs/guides/local-eslint-rules.md`), or lint fails.
- The 2026-07-25 pack's client query-layer cluster
  ([16-client-query-layer.md](../code-quality-2026-07-25/16-client-query-layer.md),
  landed) reworked client query plumbing but did not remove the now-unread
  socket-labeled `CharacterKeys` members or touch these comments; the canvas
  and upload comments are new paths that pack never covered.
