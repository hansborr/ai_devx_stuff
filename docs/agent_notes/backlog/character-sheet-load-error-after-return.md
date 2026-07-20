# Character Sheet Load Error After Return

Status: Done — fixed 2026-07-19 (wave-1 ready-2026-07 drain, A14) in `packages/client/src/pages/character-sheet-page.tsx`: cached data now renders over a background-refetch error; the full-page error shows only when there is no data. The optional login-redirect was deliberately NOT added — the GuestGuard bounce makes it a no-op; a real session-expired pathway is a follow-up.
Date: 2026-07-03
Source: Migrated from the stale `docs/bugs` scratch file during the
docs/process audit cleanup.

## Context

Original scratch line: `Mysteriously got "failed to load character" after
looking away from character sheet`.

Current code no longer gives enough evidence to confirm this as fixed or still
live. `packages/client/src/pages/character-sheet-page.tsx` loads the sheet with
`character.get` and maps non-not-found query errors to `Failed to load
character`. Server coverage still asserts `character.get` success, not-found,
private-character hiding, and public-character access in
`packages/server/src/routers/character.test.ts`; realtime invalidation coverage
asserts `character.get` invalidation on `character:updated` in
`packages/client/src/hooks/realtime-invalidation-character-sheet.test.ts`.

No current test or clearly related commit reproduces the reported "after
looking away" transition, so this is parked as a reproduction target instead of
preserving a raw scratch file.

## Scope

- Reproduce the route transition or background/foreground sequence that causes
  the generic `Failed to load character` state, if it still exists.
- Determine whether the failure is a stale auth/session state, a route-param
  edge, a TanStack Query refetch behavior, or a backend `character.get` error.
- Add a focused route/page or e2e regression before changing behavior.

## Verification

- Focused client route/page test or e2e path for the reproduced transition.
- `bun run test -- <focused test file>`
