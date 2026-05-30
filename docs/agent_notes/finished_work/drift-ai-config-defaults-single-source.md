# drift:ai config defaults single source

Completed drift-ai review task 06.

`DEFAULT_DRIFT_AI_CONFIG.checks` now derives from the plugin registry through
`buildDefaultChecksConfig()`, so per-plugin `defaultConfig` is the source of truth
for check defaults. `config-paths.ts` now only owns path normalization helpers,
which avoids importing `CHECK_PLUGINS` into a module that check plugins already
depend on.

`parseChecksConfig` clones omitted check config from each plugin default directly.
Config parsing tests cover registry-wide omitted defaults, `{}` parse defaults,
and the richer `near-duplicates` default shape.

Validation:

- `bash scripts/vitest.sh run --project=scripts scripts/drift-ai.test.ts scripts/drift-ai/near-duplicates.test.ts`
- `bun run drift:ai --scope current --root scripts/drift-ai --check near-duplicates --format json`
- `bun run typecheck`
- `bun run lint:ratchet`
- `bun run test:scripts`
