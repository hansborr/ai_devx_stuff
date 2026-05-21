# local/type-assertion-boundary Batch 4b

Completed: 2026-05-19
Scope: Remaining server one-count finding drain

## Result

Drained nine server-side ratchet findings. The cold `lint:ratchet` run reports
82 current findings after clearing `node_modules/.cache/eslint-ratchet`, and
`lint-ratchet.baseline.json` was refreshed with `bun run lint:ratchet:update`.

## Files

- `packages/server/src/routers/campaign.ts`: replaced the unique-violation
  error cast with `Prisma.PrismaClientKnownRequestError`.
- `packages/server/src/routers/encounter.ts`: moved the `Object.keys` interop
  boundary comment onto the `for...of` statement that contains the cast.
- `packages/server/src/routers/homebrew.ts`: labeled the guarded
  `Record<string, unknown>` interop boundary in `resolveDataRef`.
- `packages/server/src/routers/magic-item.ts`: replaced indexed last-item cast
  with `items.at(-1)`.
- `packages/server/src/seed/seed-srd-equipment.ts`: replaced JSON parse casting
  with Zod schemas inferred into the seed types.
- `packages/server/src/seed/seed-srd-magic-items.ts`: replaced JSON parse
  casting with Zod schemas inferred into the seed type.
- `packages/server/src/services/character-live-state/feature.ts`: labeled the
  throw-guarded active feature narrowing boundary.
- `packages/server/src/services/upload-service.ts`: labeled the as-const tuple
  widening boundary used by the MIME type guard.
- `packages/server/src/utils/character-mapping.ts`: removed the Prisma include
  cast; lint/typecheck showed `classFeature` is inferred as non-null here, so
  the mapper now reads `f.classFeature.name`.

## Verification

- `bun run lint:fix`
- `rm -rf node_modules/.cache/eslint-ratchet && bun run lint:ratchet`
- `bun run typecheck`
- `bun run test:changed`
- `bun run lint:ratchet:update`

