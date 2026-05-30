# drift:ai default config plain factory

Completed drift-ai review task 15.

## What changed

`DEFAULT_DRIFT_AI_CONFIG.checks` was a memoized lazy getter (task 14 deliberately
left it in place). It is now plain materialized data, and a `makeDefaultDriftAiConfig()`
factory replaces the `cloneDefaultConfig()` helper.

- `config-defaults.ts` — new `makeDefaultDriftAiConfig(): DriftAiConfig` returns a
  fresh, fully plain object on every call (`checks` built eagerly via
  `buildDefaultChecksConfig()`, which already `structuredClone`s each plugin's
  `defaultConfig`). `DEFAULT_DRIFT_AI_CONFIG` is now `= makeDefaultDriftAiConfig()`
  — an eager snapshot whose `checks` is a data property, no getter, no cache.
- Removed `cloneDefaultConfig()`. Its two callers (`config-parsing.ts`
  `parseDriftAiConfig`, `config.ts` `loadDriftAiConfig`) call the factory directly;
  `config-parsing.ts` re-exports `makeDefaultDriftAiConfig`.

## Why the getter was safe to drop

The getter papered over a registry/runtime import cycle through the old
`source-walk -> git-changed-scope -> config.js` path, which no longer exists. The
runtime closure of `config-defaults.ts` is now acyclic:
`config-defaults -> check-metadata -> *-check-config -> {config-paths, config-readers,
errors, path-util}` — all leaf modules; none re-enter `config-defaults`/`config-parsing`
at runtime (the check-config modules import `config.js` only as types). So eager
materialization at module load is cycle-safe. Full drift-ai suite and the CLI stay
green.

## Tests

`config-defaults.test.ts` (new):

- `Object.getOwnPropertyDescriptor(DEFAULT_DRIFT_AI_CONFIG, "checks")` is a data
  descriptor (no `get`/`set`).
- the shared snapshot equals a fresh factory build.
- two factory instances are distinct and never alias nested arrays or per-check
  config objects; factory copies never alias the shared snapshot's nested data.

## Validation

- `bun run test -- scripts/drift-ai` (478 passed)
- `bun run drift:ai --scope current --root scripts/drift-ai --check near-duplicates --format json`
- `bun run drift:ai --scope current --root scripts/drift-ai --check all --format text`
- `bun run typecheck`; ESLint clean on all touched files.
