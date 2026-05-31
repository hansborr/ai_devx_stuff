# Drift:ai duplicate-schemas chain transforms

Landed 2026-05-31. Completed drift-ai review task 31.

## What changed

- `duplicate-schemas` now models simple literal `.pick({ key: true })` and
  `.omit({ key: true })` masks when folding a `.object({...})` chain.
- Ambiguous pick/omit masks, non-literal masks, computed mask keys, non-`true`
  mask values, and unknown invoked links after `.object(...)` now decline rather
  than emitting the base key set as exact evidence.
- Known key-preserving links such as `.strict()`, `.describe(...)`, and
  `.readonly()` still preserve the base schema key set.

## Validation

- `bun run test -- scripts/drift-ai/duplicate-schemas.test.ts`
- `FORCE_VERIFY=1 bun run test -- scripts/drift-ai/duplicate-shapes.test.ts`
- `bun run lint:ratchet`
