# local/type-assertion-boundary Batch 6 — Entry Dialog Registry

Completed: 2026-05-19
Scope: `packages/client/src/components/homebrew/entries/entry-dialog.tsx`

## Result

Drained the remaining 41 `local/type-assertion-boundary` ratchet findings by
moving the heterogeneous homebrew editor registry widening into a single
`defineEditor<TForm>` helper boundary.

`lint-ratchet.baseline.json` was refreshed with 0 current findings.

## Files

- `entry-dialog.tsx`
  - widened `EditorHandler` consumer-side form parameters from `never` to
    `unknown`
  - added `defineEditor<TForm>` with the only registry widening assertion
  - converted all 9 registry entries to concrete typed `defineEditor` calls
  - removed render, submit, and default `"feat"` call-site assertions
- `lint-ratchet.baseline.json`
  - removed the final `entry-dialog.tsx` baseline count

## Verification

- `bun run lint:fix` (passed with the existing `local/max-lines` warning for
  `entry-dialog.tsx`)
- `rm -rf node_modules/.cache/eslint-ratchet && bun run lint:ratchet`
- `bun run typecheck`
- `bun run test:changed` (7310 tests / 505 files)
- `bun run lint:ratchet:update`
