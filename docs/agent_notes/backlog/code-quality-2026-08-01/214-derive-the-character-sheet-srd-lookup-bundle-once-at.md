# 214. Derive the character-sheet SRD lookup bundle once at composition

Status: Not started
Theme: Character-sheet composition derives the SRD lookup bundle twice · Area: client · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

A mounted character sheet observes the same SRD aggregate twice and derives its
complete lookup projection independently in each hook instance. The parent
already owns the loading, error, retry, and successful-data boundary, but it
does not pass that resolved bundle into the body it mounts.

The nested sheet-state hook consequently re-establishes an observer and rebuilds
maps, records, and lookup closures for data the composition boundary has
already resolved. Query caching prevents this from implying two network
requests, but the duplicate observer and derivation obscure ownership and add
avoidable work to every sheet mount.

## Evidence

- `packages/client/src/pages/character-sheet/sheet-layout.tsx:72-97` —
  `CharacterSheetContent` calls `useSrdLookups`, renders its loading and error
  states, and mounts the content body only after the lookup boundary succeeds.
- `packages/client/src/pages/character-sheet/sheet-layout.tsx:100-114` — the
  mounted `CharacterSheetContentBody` receives only the character and calls
  `useSheetState` without the lookup result already resolved by its parent.
- `packages/client/src/pages/character-sheet/sheet-state.ts:70-100` —
  `useSheetState` declares an SRD value in its return contract and invokes
  `useSrdLookups` again at line 100.
- `packages/client/src/pages/character-sheet/sheet-state.ts:116-135` — the
  nested hook returns its second SRD bundle and consumes it when calculating
  sheet armor class.
- `packages/client/src/hooks/use-srd-lookups.ts:118-148` — each hook instance
  derives five collections into maps, records, and lookup closures and memoizes
  that projection around its own query observer. Reproduce the two invocation
  count with `rg -n 'const srd = useSrdLookups\(\);' packages/client/src/pages/character-sheet/{sheet-layout.tsx,sheet-state.ts} | wc -l` (`2`), and the five-collection count with `sed -n '119p' packages/client/src/hooks/use-srd-lookups.ts | rg -o '\b(species|classes|subclasses|backgrounds|feats)\b' | wc -l` (`5`).

## Proposed direction

Pass the successful lookup bundle from `CharacterSheetContent` into
`CharacterSheetContentBody`, then pass that same value into
`useSheetState(character, campaign, srd)`. Type the new parameter from the
lookup hook's public return contract.

Remove the `useSrdLookups` import and invocation from `sheet-state.ts`.
Continue returning the supplied bundle as `s.srd` so the sheet body, dialog
slots, lookup-driven props, and armor-class calculation retain their current
shape and behavior. The parent remains the sole owner of loading, error,
refetch, and successful-data composition.

Update `sheet-state.test.ts` to provide a lookup fixture explicitly and assert
that the returned `srd` is the same object supplied by the caller. Keep the
character-sheet composition tests for loading, error/retry, and successful
rendering, and add a focused assertion that the body path consumes the
parent-resolved bundle without creating a nested lookup observer.

## Scope / caveats

- Land after, or rebase onto,
  [200-generic-srd-getall-contract-client-specific.md](./200-generic-srd-getall-contract-client-specific.md)
  so this change uses that leaf's final lookup-bundle procedure, schema, and
  type names rather than creating intermediate vocabulary.
- Coordinate with
  [039-responsive-character-sheets-keep-two.md](./039-responsive-character-sheets-keep-two.md)
  only if its implementation changes the character-sheet composition boundary.
  Do not fold responsive layout selection, panel mounting, or
  `SheetSharedProps` changes into this leaf.
- Preserve the lookup query's cache policy, five-collection payload, derived
  maps and closures, loading/error/retry UI, and all downstream sheet behavior.
  Other consumers of `useSrdLookups`, including VTT drawer tabs, remain
  unchanged.
- This finding is duplicate observation and derivation, not duplicate network
  fetching: TanStack Query continues to own request deduplication and caching.
