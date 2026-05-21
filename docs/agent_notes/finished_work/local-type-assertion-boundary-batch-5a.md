# local/type-assertion-boundary Batch 5a

Completed: 2026-05-19
Scope: Client label-only one-count finding sweep

## Result

Drained 41 client-side ratchet findings with boundary comments only. The cold
`lint:ratchet` run reports 41 current findings after clearing
`node_modules/.cache/eslint-ratchet`, and `lint-ratchet.baseline.json` was
refreshed with `bun run lint:ratchet:update`.

The starting baseline contained 40 client files at count 1 plus
`packages/client/src/components/homebrew/entries/entry-dialog.tsx` at count 42.
To hit the requested 82 -> 41 target, this batch labeled all 40 one-count
files and one additional Radix Select boundary in `entry-dialog.tsx`; the
remaining 41 findings are still in that file.

## Files

- Labeled client tRPC/data-shape boundaries for campaign, map, encounter,
  invite, homebrew collection, SRD equipment, SRD lookup, ability-roll, and
  add-participant query/mutation data casts.
- Labeled dropdown literal-union boundaries for native select and Radix Select
  handlers, including the single extra `entry-dialog.tsx` entry type selector.
- Labeled DOM event/element narrowing, `Object.keys`, as-const tuple
  `.includes`, guarded `Record<string, unknown>`, form-field value, canvas tool
  shape, tRPC error-shape, visibility-map, and refresh response boundaries.

## Verification

- `bun run lint:fix`
- `rm -rf node_modules/.cache/eslint-ratchet`
- `bun run lint:ratchet`
- `bun run typecheck`
- `bun run test:changed`
- `bun run lint:ratchet:update`
