# drift:ai check metadata / runtime registry split

Completed drift-ai review task 14.

## What changed

Split check **metadata/config** from the **runtime** plugin registry so config/CLI
code can enumerate checks and parse config without loading the tool runners and
graph builders.

- New `scripts/drift-ai/check-metadata.ts` — the lightweight registry. Owns
  `CHECK_METADATA`, `ALL_CHECKS`, `DEFAULT_CHECKS`, `CHECK_USAGE`,
  `IMPLEMENTED_CHECKS`, and `buildDefaultChecksConfig()`. Imports only the per-check
  `*-check-config.ts` modules; no `*-runner`/`*-graph`/adapter imports.
- New `*-check-config.ts` per check (`comments`, `duplicates`, `ghost-files`,
  `suppressions`, `knip-orphan-files`, `import-cycles`, `near-duplicates`). Each
  exports a `CheckConfigMetadata<C, Id>` object (`id`, `usage`, `runByDefault`,
  `defaultConfig`, `parseConfig`, `selectConfig`) plus its parse helpers.
- `check-plugin.ts` — added `CheckConfigMetadata<C, Id>`; `CheckPluginDefinition`
  now `= CheckConfigMetadata<C, Id> & { resolveServices; preflight?; run }`.
- Runtime `*-check.ts` plugins now `...spread` their `*-check-config.ts` object and
  add only the runtime hooks. `check-registry.ts` is runtime-only (`CHECK_PLUGINS`,
  `checkPluginFor`); its order mirrors `CHECK_METADATA`.
- Consumers retargeted: `cli-args.ts`, `config-parsing.ts`, `config-defaults.ts`
  import from `check-metadata.js`. `report-builder.ts` keeps resolving the concrete
  plugin lazily via `checkPluginFor`. `scripts/drift-ai.ts` re-exports the metadata
  symbols from `check-metadata.js` and `CHECK_PLUGINS` from `check-registry.js`
  (public surface unchanged).

## Notes

- The `config-defaults.ts` `checks` getter is intentionally left in place; removing
  it (and proving it is no longer load-bearing) is task 15. This task only
  retargeted the import and refreshed the comment.
- `check-metadata.test.ts` adds a structural import-boundary guard: the lightweight
  modules must import no `check-registry`/`*-runner`/`*-graph`/`*-check` specifier.
  Those modules import none of those even as types, so the guard scans every
  `from "./…"` specifier.

## Validation

- `bun run test -- scripts/drift-ai` (473 passed)
- `bun run drift:ai --scope current --root scripts/drift-ai --check all --format text`
- `bunx tsc -p tsconfig.scripts.json --noEmit`
- ESLint clean on all touched files.
