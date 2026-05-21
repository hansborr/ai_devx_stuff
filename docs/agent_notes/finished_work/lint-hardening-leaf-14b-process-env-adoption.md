# Leaf 14b Adoption: process.env

Status: Resolved — verdict in register dated 2026-05-19.
Generated 2026-05-19 against
feature/lint-hardening-leaf-14b-process-env.
Probe: reproducible `rg` inventory plus adopted `no-restricted-syntax`
selector.

Scope: production source in `packages/shared/src/**`,
`packages/server/src/**`, and `scripts/**`, excluding tests, test helpers,
and `packages/server/src/generated/**`.

## Resolution

- Verdict: raw `process.env` member access is banned outside named
  config/bootstrap/script boundaries.
- `packages/server/src/config/env.ts` is the sanctioned server env reader.
  `DATABASE_POOL_MAX` moved into the env schema as an optional positive
  integer and `packages/server/src/prisma/client.ts` now consumes
  `serverEnv.databasePoolMax`.
- The only unsanctioned production read was
  `packages/server/src/prisma/client.ts`; after the refactor, the inventory
  has zero unsanctioned production rows outside allowlisted files.
- `scripts/code-intel/daemon-process.ts` and
  `scripts/code-intel/perf-check.ts` remain sanctioned child-process
  `env: process.env` pass-through boundaries. `scripts/db-status.ts` remains
  a sanctioned local admin display tool.
- The allowlist override disables the whole `no-restricted-syntax` rule for
  named files. Some entries need only `process.exit`, some only
  `process.env`, and seed scripts need both; keeping the single override
  matches the existing restricted-primitive config shape.

## Inventory

Initial probe:

```bash
rg -n 'process\.env' packages/shared/src packages/server/src scripts \
  --type ts \
  -g '!**/*.test.ts' \
  -g '!**/*.spec.ts' \
  -g '!**/__tests__/**' \
  -g '!**/test/**' \
  -g '!**/*test-helper*' \
  -g '!packages/server/src/generated/**'
```

Initial rows:

```text
scripts/db-status.ts:61:  const dev = process.env["DATABASE_URL"];
scripts/db-status.ts:62:  const test = process.env["TEST_DATABASE_URL"];
scripts/db-status.ts:63:  const e2e = resolveE2eDatabase(process.env["E2E_DATABASE_URL"], test, dev);
scripts/db-status.ts:64:  const redis = process.env["REDIS_URL"];
scripts/db-status.ts:65:  const serverPort = process.env["SERVER_PORT"];
scripts/db-status.ts:66:  const viteDevPort = process.env["VITE_DEV_PORT"];
scripts/db-status.ts:67:  const corsOrigin = process.env["CORS_ORIGIN"];
scripts/code-intel/daemon-process.ts:39:    env: process.env,
scripts/code-intel/perf-check.ts:110:      env: process.env,
packages/server/src/prisma/client.ts:7:  const raw = process.env["DATABASE_POOL_MAX"];
packages/server/src/config/env.ts:155:export function loadServerEnv(source: EnvSource = process.env): ServerEnv {
```

Classification:

- `packages/shared/src`: 0 rows.
- `packages/server/src/config/env.ts`: sanctioned helper default source.
- `packages/server/src/prisma/client.ts`: unsanctioned production read,
  moved into `loadServerEnv`.
- `scripts/db-status.ts`: sanctioned local database-status display/admin
  tool.
- `scripts/code-intel/daemon-process.ts` and
  `scripts/code-intel/perf-check.ts`: sanctioned child-process environment
  pass-through.

Final probe rows are allowlisted only:

```text
scripts/code-intel/daemon-process.ts:39:    env: process.env,
scripts/code-intel/perf-check.ts:110:      env: process.env,
scripts/db-status.ts:61:  const dev = process.env["DATABASE_URL"];
scripts/db-status.ts:62:  const test = process.env["TEST_DATABASE_URL"];
scripts/db-status.ts:63:  const e2e = resolveE2eDatabase(process.env["E2E_DATABASE_URL"], test, dev);
scripts/db-status.ts:64:  const redis = process.env["REDIS_URL"];
scripts/db-status.ts:65:  const serverPort = process.env["SERVER_PORT"];
scripts/db-status.ts:66:  const viteDevPort = process.env["VITE_DEV_PORT"];
scripts/db-status.ts:67:  const corsOrigin = process.env["CORS_ORIGIN"];
packages/server/src/config/env.ts:172:export function loadServerEnv(source: EnvSource = process.env): ServerEnv {
```

## Lint Rule

Adopted selector:

```js
{
  selector: "MemberExpression[object.name='process'][property.name='env']",
  message:
    "Avoid reading process.env outside config/env.ts. Use serverEnv from packages/server/src/config/env.ts (or add the key there). For child-process spawn `env:` pass-through and the db-status admin tool, add the file to the allowlist override below.",
}
```

This intentionally bans only `process.env` member access, not broader
`process.*` usage. The existing `process.cwd()` use in the env schema remains
outside the selector.

`codeFiles` is the repository-wide `**/*.{js,cjs,mjs,ts,tsx,mts,cts}` glob,
so package source under `packages/shared/src/**` and
`packages/server/src/**` is covered permanently. The root script family is
still governed by the existing ESLint global ignore/unignore scope; the named
script allowlist documents the sanctioned boundaries in the linted script
subset and the already-allowlisted db-status admin tool.

Test, helper, and e2e setup files are intentionally outside the production
`process.env` ban, matching the inventory exclude. Their later override keeps
the `process.exit(...)` selector active while allowing environment setup reads
and mutations for isolated test processes/databases.

## Verification

- Expected failing TDD probe:
  `bun run test:server packages/server/src/config/env.test.ts` failed before
  implementation because `DATABASE_POOL_MAX` was not parsed or rejected.
- Post-implementation targeted env test:
  `bun run test:server packages/server/src/config/env.test.ts` passed
  (8 tests).
- `bun run lint -- --max-warnings=0` passed.
- `bun run typecheck` passed.
- `bun run test:server packages/server/src/config/env.test.ts` passed
  (8 tests).
- `FORCE_VERIFY=1 bun run test:server packages/server/src/prisma/` passed
  (5 tests). The first unforced command was skipped by the repo's
  unchanged-worktree test cache, so the slice was rerun with
  `FORCE_VERIFY=1`.
