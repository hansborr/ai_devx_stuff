# 10 - Fix character-live-state module doc

Status: Parked
Track: D (docs/feedforward)
Size: small
Depends on: none
Blocks: 11, 41

## Goal

Make `character-live-state/MODULE.md` describe the module surface that actually
exists, and document the no-barrel-compatible facade convention in
`packages/server/src/services/README.md`.

## Background

The harness review found a live doc drift: `character-live-state/MODULE.md`
claims `index.ts` is the public facade, but that file no longer exists. The
current routers import several internal files directly. This task is the
doc-only repair; it does not introduce or migrate code to a new facade.

## Seams to touch

- `packages/server/src/services/character-live-state/MODULE.md`
- `packages/server/src/services/README.md`
- For examples only: `combat-actions/MODULE.md`, `spell-casting/MODULE.md`,
  and `level-up/MODULE.md`.

## What to do

1. Replace the stale `index.ts` facade statement with the actual current public
   surface for `character-live-state`.
2. Make the doc explicit about whether external routers currently import
   per-operation files directly, and which files are intended as stable entry
   points.
3. Add a short convention to `services/README.md`: service-module facades are
   named, logic-bearing `<module>.ts` files, not re-export-only `index.ts`
   barrels. Note that `no-barrel` still allows logic-bearing facades.
4. Do not change imports in routers in this task.

## Testing

- `bun run module:index:check`
- `bun run format:changed:check`

## Out of scope

- Restoring or creating `character-live-state.ts`.
- Migrating routers to a facade.
- Building a facade-leak sensor. That is task 41.
