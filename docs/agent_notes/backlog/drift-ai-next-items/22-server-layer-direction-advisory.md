# 22 - server layer-direction advisory

Status: Done
Track: A
Size: medium
Depends on: none
Blocks: none

## Goal

Add a report-only architecture sensor for unambiguous server source layer
direction, starting with reverse imports such as `utils` importing `services` and
`services` importing `routers`.

## Background

Package-level direction is covered elsewhere, but within `packages/server/src`
some direction rules live mostly in prose. This task should be advisory until
real runs prove the rule is low-noise.

## Seams to touch

- `scripts/drift-ai/import-cycles-graph.ts`, if reusing graph construction
- new `scripts/drift-ai/layer-direction*.ts` files, or another focused name
- `scripts/drift-ai/types.ts`
- `scripts/drift-ai/check-metadata.ts`
- `scripts/drift-ai/check-registry.ts`
- `scripts/drift-ai/README.md`
- `docs/ai-harness.md`

## What to do

1. Reconfirm existing lint/import-boundary coverage first. Do not duplicate an
   existing gate.
2. Add a report-only check, recommended name `layer-direction`.
3. Implement the first two bans only:
   - `packages/server/src/utils/**` must not import
     `packages/server/src/services/**`;
   - `packages/server/src/services/**` must not import
     `packages/server/src/routers/**`.
4. Resolve relative paths and aliases. Reuse import-cycle graph machinery if it
   gives enough edge evidence without overfitting.
5. Report source file, imported specifier or target file, target layer, and repair
   hint.
6. Include a tiny explicit allowlist only for known legitimate exceptions.
7. Keep it opt-in until noise is measured.

## Testing

- Fixture tests for legal direction, reverse direction, relative paths, aliases,
  type-only imports if relevant, and allowlisted exceptions.
- Smoke against the repo with `--scope current --check layer-direction`.

## Out of scope

- General dependency-cycle detection.
- Enforcing facades.
- Making architecture direction a CI gate.

## Done notes

- Added opt-in `layer-direction` check using the existing resolved TypeScript
  module graph.
- Implemented the first two server-layer rules:
  `utils -> services` and `services -> routers`.
- Findings include source file, resolved target file, source/target layer,
  type-only evidence, repair hint, and `[drift-baseline]` provenance.
- Added a narrow allowlist for the current legitimate test edge
  `packages/server/src/utils/character-mapping.test.ts ->
  packages/server/src/services/character-create.ts`.
- Covered legal direction, relative imports, aliases, type-only imports,
  changed-scope filtering, allowlist behavior, and plugin skip/provenance wiring.
