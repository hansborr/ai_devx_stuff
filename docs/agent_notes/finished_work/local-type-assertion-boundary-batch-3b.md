# local/type-assertion-boundary Batch 3b

Completed: 2026-05-19
Scope: Leaf 07 package-side ratchet drain, client batch 3b

## Result

Drained all 12 target findings across six client files without adding boundary
labels. `lint:ratchet` reports 102 current findings after clearing
`node_modules/.cache/eslint-ratchet`.

## Files

- `packages/client/src/components/campaign/notes/notes-panel.tsx`: removed 2
  casts by constructing explicit create/update mutation payloads after the
  `data.id` branch narrows the save mode.
- `packages/client/src/components/campaign/npcs/monster-tab.tsx`: removed 2
  casts by adding `CreatureType` and `MonsterSize` guards for dropdown string
  values.
- `packages/client/src/components/homebrew/monster/monster-ability-scores.tsx`:
  removed 2 casts by narrowing the ability-key tuple and routing computed
  updates through an exhaustive patch helper.
- `packages/client/src/components/sheet/add-spell-dialog.tsx`: removed 2 casts
  by validating spell school/class dropdown strings before setting filter
  state.
- `packages/client/src/components/sheet/spell-filter-bar.tsx`: removed 2 casts
  by parsing school values with the shared Zod schema and guarding prepared
  filter literals.
- `packages/client/src/lib/api-base.ts`: removed 2 chained framework casts by
  adding the client Vite env ambient declaration in
  `packages/client/src/vite-env.d.ts` and reading `import.meta.env` directly.

No latent schema or shape bug was found; no Leaf 29 follow-up was added.

## Verification

- `bun run lint:fix`
- `bun run lint:changed` via a temporary Git index so the staged-content guard
  saw the intended files without modifying the real index
- `bun run typecheck`
- `bun run test:changed`
- `rm -rf node_modules/.cache/eslint-ratchet && bun run lint:ratchet`
