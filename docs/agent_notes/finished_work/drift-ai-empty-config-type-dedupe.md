# drift:ai empty config type dedupe

Completed drift-ai review task 21.

## What changed

- `import-cycles-check-config.ts`, `knip-orphan-files-check-config.ts`, and
  `suppressions-check-config.ts` now export their empty config type aliases.
- The matching runtime plugin modules import those aliases as types and no
  longer duplicate local `Record<string, never>` aliases.
- No config shape, parsing, defaults, or runtime behavior changed.

## Validation

- `bun run test -- scripts/drift-ai/check-metadata.test.ts scripts/drift-ai/knip-orphan-files.test.ts scripts/drift-ai/import-cycles.test.ts scripts/drift-ai/suppressions.test.ts`
- `bun run lint:ratchet`
- `bunx tsc -p tsconfig.scripts.json --noEmit`
