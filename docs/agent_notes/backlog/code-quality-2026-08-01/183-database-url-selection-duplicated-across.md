# 183. Centralize test and E2E database URL precedence across TypeScript and devcontainer provisioning

Status: Not started
Theme: database URL precedence · Area: cross-cutting · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Test and E2E database selection is one operational contract implemented at five
sites across server test support, Playwright setup, root diagnostics, and
devcontainer shell. The copies agree on the main precedence today, but they
carry deliberate differences in failure policy and output shape.

A contributor changing an environment variable or fallback must discover every
copy and preserve those differences manually. The operational `db:status`
command even imports a test-only module for one default constant and warns in a
comment that any drift will make its diagnostics report the wrong database.
The devcontainer repeats the same precedence while producing deduplicated
database names rather than full URLs.

## Evidence

- `packages/server/src/test/test-database-url.ts:5,46-59` owns
  `DEFAULT_TEST_DATABASE_NAME` and selects
  `TEST_DATABASE_URL`, otherwise derives `musi_test` from `DATABASE_URL`, and
  throws an actionable error when neither exists.
- `e2e/global-setup.ts:12-31` independently selects
  `E2E_DATABASE_URL`, then `TEST_DATABASE_URL`, then derives
  `musi_test_e2e` from `DATABASE_URL`, with its own actionable failure message.
- `playwright.config.ts:22-26` is a fifth copy omitted from the original
  inventory. It implements the E2E precedence inline but falls back to `""` so
  configuration evaluation does not throw when no database environment is
  present.
- `scripts/db-status.ts:7` imports
  `DEFAULT_TEST_DATABASE_NAME` from the server test directory.
  `:56-96` reimplements both resolvers and provenance strings, while `:72-76`
  explicitly warns that the diagnostic must mirror the harness or report the
  wrong database.
- `scripts/db-status.ts:252-270` depends on the provenance distinction to print
  selected sources and warn when E2E falls back to `TEST_DATABASE_URL`.
  The command itself is registered at `package.json:113`.
- `.devcontainer/post-create.sh:126-160` repeats the precedence in shell but
  derives database **names** for provisioning, supplies canonical defaults for
  URLs without names, and deduplicates when E2E collapses onto the test
  database.
- `scripts/tests/test-post-create.sh:154-180` pins configured-name provisioning,
  including `CREATE DATABASE custom_test` and
  `CREATE DATABASE custom_e2e`; its `# smoke-subjects:` ownership header is at
  `:1-4`.
- `scripts/worktree-db.sh:1118-1122` is not another resolver: it produces
  explicit `TEST_DATABASE_URL` and `E2E_DATABASE_URL` values in environment
  files for downstream consumers.

## Proposed direction

1. Add a pure, environment-parameterized module at
   `packages/server/src/config/test-database-urls.ts`; this module does not
   exist today. Match the `Record<string, string | undefined>` input style used
   by `packages/server/src/config/env.ts:20-30`, with no Prisma import or other
   side effect.

   Move `DEFAULT_TEST_DATABASE_NAME` into it and provide the two precedence
   operations:

   - base test:
     `TEST_DATABASE_URL`, otherwise `DATABASE_URL` with database name
     `musi_test`;
   - E2E:
     `E2E_DATABASE_URL`, otherwise raw `TEST_DATABASE_URL`, otherwise
     `DATABASE_URL` with database name `musi_test_e2e`.

   Each resolver should return `{ url, source }`, with `url` allowed to be
   undefined. Keep provenance as a closed, stable vocabulary so `db-status`
   can retain its current labels and fallback warning. Resolution chooses a
   value; callers retain ownership of throwing or defaulting.

2. Migrate every TypeScript consumer to that module while preserving its local
   failure policy:

   - `packages/server/src/test/test-database-url.ts` re-exports the shared
     constant/resolver and retains only worker-key, registry, database-name, and
     worktree-slug mechanics;
   - server Vitest setup unwraps the result and keeps its existing actionable
     `TEST_DATABASE_URL`/`DATABASE_URL` error;
   - `e2e/global-setup.ts` deletes `getTestDatabaseUrl`, unwraps the E2E result,
     and keeps its current E2E-specific error;
   - `playwright.config.ts` uses `resolved.url ?? ""`, preserving non-throwing
     config evaluation;
   - `scripts/db-status.ts` deletes `derivedUrl`,
     `resolveTestDatabase`, and `resolveE2eDatabase`, imports from the neutral
     config module rather than `src/test`, and keeps its provenance output and
     warning.

   Replace the now-false mirroring comment at `scripts/db-status.ts:72-76` with
   a pointer to the shared resolver.

3. Create the dependency-free CLI
   `packages/server/scripts/resolve-test-db-names.ts`; it does not exist today.
   It should read `process.env`, use the shared resolvers, extract database
   names, apply the current canonical-name fallback for missing path
   components, deduplicate test/E2E collapse, and print one name per line. It
   must not import Prisma, a server barrel, or application startup code.

   Replace `.devcontainer/post-create.sh`’s `db_name_from_url` and
   `resolve_test_db_names` implementation with one Bun invocation of that CLI.
   Keep provisioning and `pgexec.ts` unchanged. Rewrite the comment at
   `.devcontainer/post-create.sh:126-140` to identify the shared resolver/CLI
   rather than claim a shell mirror.

4. Add focused tests beside the new config module before migrating callers.
   Cover precedence, `{ url, source }`, derivation, no-env behavior, configured
   E2E/test collapse, query-string handling, and the chosen treatment of blank
   environment values. Move the existing base precedence cases from
   `packages/server/src/test/test-database-url.test.ts:23-39`; leave worker-name
   tests with the Vitest-specific module.

   Extend `scripts/tests/test-post-create.sh` to cover both distinct names and
   the deduplicated fallback case. If its subject paths change, regenerate the
   two owned smoke-subject artifacts with the registered
   `bun run test:scripts:subjects` command. Refresh
   `packages/server/src/test/MODULE.md:18-40` so it points contributors to the
   neutral precedence owner rather than presenting `test-database-url.ts` as
   the whole contract.

## Scope / caveats

- Preserve caller-specific behavior. Playwright configuration must remain
  non-throwing; global setup and server test setup must retain their distinct
  actionable errors; `db:status` must retain provenance and the shared-test-DB
  warning.
- Empty strings are a behavior edge that must be decided and pinned explicitly:
  `playwright.config.ts:22-26` currently uses nullish coalescing, while the
  server, E2E setup, and shell use truthiness/non-empty checks. Do not let the
  migration change this accidentally.
- The shell-facing contract is deduplicated database names, not raw URLs.
  Returning URLs from the CLI would not satisfy the provisioning caller.
- Do not merge or widen the destructive DROP allowlists. Their alphabets are
  deliberately separate from parser vocabulary, as documented at
  `packages/server/src/test/test-database-url.ts:26-36` and enforced in
  `packages/server/src/test/prepare-test-db.ts:59-95`.
- Do not change `scripts/worktree-db.sh`’s environment-file production, the
  worker database naming scheme, registry paths, or worktree slug derivation.
- Keep the new config module dependency-free enough to run during devcontainer
  post-create before application services are available.
- No sequencing dependency is prescribed.
