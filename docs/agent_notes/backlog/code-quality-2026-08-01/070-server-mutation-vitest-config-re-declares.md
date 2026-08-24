# 70. The Stryker-only server Vitest config re-declares the regular server test lifecycle field by field, with no parity guard

Status: Not started
Theme: single-source test config · Area: tests · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`packages/server` has two Vitest projects that must describe the same test
lifecycle: `vitest.config.ts` (the regular DB-backed `server` project) and
`vitest.mutation.config.ts` (the Stryker-only mirror consumed by
`stryker.config.server.mjs`). The mutation config re-declares the DB-URL and
JWT-secret derivation byte for byte and repeats every lifecycle and environment
field — clear-mocks, timeout, node environment, setup/global-setup targets,
worker cap, sequence order, and the three-key `env` block. Nothing asserts the
two stay in agreement. A routine change to setup, workers, or database
semantics in the regular config silently leaves the mutation copy behind, and
the drift only surfaces during an infrequent, hours-long Stryker run — the most
expensive possible place to discover a stale worker cap or setup path. The
mutation config's header carefully justifies why it cannot *spread* the base
project export (typed-lint rejects spreading the Promise-like type), but that
justifies the inline shape, not the absence of a shared plain-options module —
and both files already import shared plain constants across config boundaries,
so the pattern the fix needs is already established.

## Evidence

- `packages/server/vitest.config.ts:6-11` — `testDbUrl` (TEST_DATABASE_URL ??
  DATABASE_URL-with-`/musi_test`-replace ?? `""`) and `testJwtSecret`
  derivations; `packages/server/vitest.mutation.config.ts:25-30` repeats both,
  character for character.
- `packages/server/vitest.config.ts:13-34` vs
  `packages/server/vitest.mutation.config.ts:32-52` — the mutation project
  repeats `name: "server"`, `clearMocks`, `testTimeout`, `environment: "node"`,
  the `[...defaultExclude, "**/worktrees/**", "**/*.slow.test.*"]` exclude
  base, the `src/test/setup.ts` / `src/test/global-setup.ts` hook targets,
  `maxWorkers`, `sequence: { groupOrder: 1 }`, and the
  `DATABASE_URL`/`DATABASE_POOL_MAX`/`JWT_SECRET` env block.
- `packages/server/vitest.mutation.config.ts:21-22` — "Defined inline rather
  than spreading the base config: spreading the base project export trips
  typed-lint's no-misused-spread (its type is Promise-like)" — explains the
  no-spread choice, not the duplicated constants.
- `packages/server/vitest.config.ts:3-4` and
  `packages/server/vitest.mutation.config.ts:6-7` — both configs already import
  `DEFAULT_VITEST_TEST_TIMEOUT_MS` from the root `vitest.config.js` and
  `SERVER_TEST_MAX_WORKERS`/`SERVER_TEST_POOL_MAX` from
  `./src/test/test-database-url.js`: cross-file plain-constant sharing already
  works here for exactly these kinds of values.
- `packages/server/src/test/test-database-url.ts:46-59` —
  `getBaseTestDatabaseUrl` is a third copy of the same URL derivation (used by
  `src/test/global-setup.ts:17` and `src/test/setup.ts:17`), differing only in
  its failure mode: it throws where the configs fall back to `""`.
- `stryker.config.server.mjs:24` — the sole consumer of the mutation config;
  drift is exercised nowhere else.
- No parity guard exists: the only test references to
  `vitest.mutation.config.ts` are path-list entries
  (`scripts/path-policy/path-policy.test.ts:200`,
  `eslint-rules/shared-policy.test.js:83`), not field comparisons.

## Proposed direction

Extract the shared `testDbUrl`/`testJwtSecret` derivation and common server
test fields (timeout, environment, setup/globalSetup names, maxWorkers,
sequence, env block) into a plain module consumed by both
`packages/server/vitest.config.ts` and `vitest.mutation.config.ts`, keeping the
deliberate mutation differences (root, absolute hook paths, services-only
include, no coverage) local and documented.

Mechanics: export a plain options object (or individual constants) — not a
spread of either project export, which is exactly what the `:21-22` comment
rules out. The natural home is beside (or in)
`packages/server/src/test/test-database-url.ts`, which both configs already
import; a module under `src/` is ordinary linted source and needs no new
registration. The mutation config keeps `root: here` (`:33`), the
`resolve(here, ...)` hook paths (`:41-42`), the `src/services/**` include
(`:39`), and the absent coverage block — each already documented at `:9-20` —
composing them with the shared fields. The regular config likewise keeps its
`src/seed/**` exclusion (`:23`) and coverage block (`:35-38`) local.

## Scope / caveats

- **Do not reopen CQ25-221.** The prior pack's
  `docs/agent_notes/backlog/code-quality-2026-07-25/43-stryker-config-duplication.md`
  landed shared *Stryker* config construction (`stryker.shared.mjs` /
  `createStrykerConfig`) and its Status records a do-not-reopen decision on the
  `.mjs` route. That work never touched these two Vitest projects;
  conversely, this leaf must not alter `stryker.shared.mjs`, lane options, or
  `inPlace` semantics.
- **Preserve the `""` fallback semantics.** The configs' derivation falls back
  to an empty string where `getBaseTestDatabaseUrl` throws; silently switching
  the shared extraction to the throwing helper would make config evaluation
  fail in DB-less contexts. Unifying the two failure modes is a separate,
  deliberate decision — the safe extraction keeps the configs' current
  behavior.
- **Keep the mutation differences local, verbatim.** `root`, absolute hook
  paths, the services-only include, and the missing coverage block are
  load-bearing workarounds for Stryker's root resolution and dry-run scoping
  (documented at `vitest.mutation.config.ts:9-20`); the shared module must not
  absorb them.
- **`vitest.unit.config.ts` is out of scope.** The DB-free `server-unit`
  project deliberately blanks the database env and omits the setup lifecycle
  (`packages/server/vitest.unit.config.ts:19-23`); it shares only the root
  constants it already imports.
- If the shared module is instead placed as a new top-level config file (not
  under `src/`), it needs a `eslint-config/config-surface-manifest.json` entry
  like its siblings (`:89`, `:95`, `:101`) — placing it under `src/test/`
  avoids that surface entirely.
- Adjacent, no ordering dependency:
  [066-three-mutation-test-lanes-can-strand-live.md](./066-three-mutation-test-lanes-can-strand-live.md)
  works the Stryker lane runner (package scripts and the `stryker.config.*.mjs`
  lane configs), not these Vitest files; avoid editing the mutation-test
  surface in both leaves concurrently.
