# drift:ai metadata runtime boundary

Completed drift-ai review task 20.

## What changed

- `check-metadata.test.ts` now walks the transitive relative value
  import/re-export closure for `check-metadata.ts`, `cli-args.ts`,
  `config-parsing.ts`, and `config-defaults.ts`.
- The boundary guard ignores type-only imports and fails on runtime/heavy modules:
  `check-registry`, concrete `*-check` plugins, `*-runner`, `*-graph`,
  `near-duplicates-fingerprint`, and `ts-morph`.
- Near-duplicate CLI/config constants and `NearDuplicateEngine` moved into the
  pure leaf `near-duplicates-config-values.ts`; runtime near-duplicate code
  re-exports those values to keep the existing public surface.

## Validation

- Hardened `check-metadata.test.ts` failed first on
  `near-duplicates.ts -> near-duplicates-fingerprint.ts`.
- `bun run test -- scripts/drift-ai/check-metadata.test.ts scripts/drift-ai/near-duplicates.test.ts`
- `bun run test -- scripts/drift-ai/config-defaults.test.ts`
- `bunx tsc -p tsconfig.scripts.json --noEmit`
- `bun run verify:changed`
