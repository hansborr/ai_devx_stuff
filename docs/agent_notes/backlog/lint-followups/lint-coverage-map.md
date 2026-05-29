# Lint Coverage Map

Status: First derived inventory committed 2026-05-20 as the load-bearing Leaf
41 prerequisite. Every tracked maintained code/tooling surface below resolves
to one of: `linted`, `ratcheted`, `proposed`, `pending-leaf`, `excluded`, or
`not-code`. No `unknown` rows remain; new surfaces appearing in future
`git ls-files` runs should be added under the closest section with a resolved
status before any ratchet/floor batch lands.

Source of truth: this file is hand-derived from `git ls-files` matched against
`eslint.config.js` (ignore/unignore/parser blocks) and
`scripts/lint-ratchet-config.ts` as of branch
`feature/lint-hardening-review-followup`. The leaf permits a Markdown table
that is re-derivable from those inputs; if/when a generator script is added,
it should produce the same row structure.

## Status Values

- `linted` — file is covered by `bun run lint` under the strict project ESLint
  config.
- `ratcheted` — file is covered by at least one `lint:ratchet` entry. Where
  the only ratchet is `ratchet/local-type-assertion-boundary` and type
  assertions are *not* the meaningful risk for that family, the row also lists
  a `proposed` floor.
- `proposed` — Leaf 41 (or a named child leaf) should add a floor here. The
  `Proposed rule/tool` column names the candidate guard.
- `pending-leaf` — needs a separate tool/sensor infrastructure (ShellCheck,
  actionlint, taplo, etc.) and is split into a named child leaf
  (`41b`, `41c`, …). The current row records the surface; the named child
  leaf owns the implementation.
- `excluded` — intentionally not linted. The `Blocker/follow-up` column
  records the durable rationale.
- `not-code` — generated, vendored, binary, or documentation file that is
  not a lint target.

## Generation Method

```
git ls-files                            # raw inventory
eslint.config.js → ignores + unignores  # normal-lint membership
eslint.config.js → per-files rule blocks # parser profile and rule overlays
scripts/lint-ratchet-config.ts          # ratchet membership
```

Membership rules followed when filling in the table:

1. A file is `linted` iff it survives the global `ignores` list (with the
   ordered `!…` re-includes applied) and matches at least one config block's
   `files` glob.
2. `**/*.config.{js,mjs,ts}` is in the global `ignores`. Root and package
   config files are therefore *not* `linted` even when they live outside
   `scripts/`.
3. `scripts/**/*` is in the global `ignores`. Only the explicit
   `!scripts/…` re-includes in `eslint.config.js` make a script file `linted`.
4. `eslint-rules/*` is in the global `ignores`; `eslint-rules/*.js` is
   re-included for rule implementations and rule tests, while
   `eslint-rules/vitest.config.ts` remains excluded by the config-file ignore.
5. `eslint-config/shared-policy.js` is an ESLint config support module and is
   linted by the same dedicated JS config block as root JS config files.
6. A file is `ratcheted` iff it matches at least one ratchet entry's `files`
   glob and is not pruned by that entry's `ignores`.
7. The `local/type-assertion-boundary` ratchet covers `scripts/**/*.ts`
   (less `scripts/codemods/fixtures/**`), so almost every unlinted script
   has *some* floor today. After the 2026-05-21 Leaf 41f audit, rows keep a
   `proposed` marker only when a current broad-shallow floor is still missing;
   deeper normal-lint adoption and drain rules live in the follow-up column.

## Production Package Source

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `packages/shared/src/**/*.ts` (production) | 66 .ts | yes |  (default-cap subset), `ratchet/local-type-assertion-boundary`, `ratchet/strict-boolean-expressions-shared` | ESLint `type-aware-ts` (project service) | none — already floored across the meaningful axes | linted + ratcheted | — |
| `packages/server/src/**/*.ts` (production, non-test) | ~207 .ts | yes |  (default-cap subset, with named `warn` overrides for `routers/encounter.ts`, `routers/homebrew.ts`, `routers/srd.ts`, `services/rest-service.ts`), `ratchet/local-type-assertion-boundary` | ESLint `type-aware-ts` (project service) | none — strict tier (server-only rules: `local/concurrency-guard`, `local/no-broadcast-in-transaction`, `local/socket-registry-broadcasts`, `local/structured-logging`, `local/strict-trpc-input`, tRPC schema rules) is the right family today | linted + ratcheted | — |
| `packages/client/src/**/*.{ts,tsx}` (production, non-test) | ~386 .ts+.tsx | yes |  (default-cap subset, with named `warn` overrides for several form/encounter/notes/npc/pages/stores files), `ratchet/local-type-assertion-boundary` | ESLint `type-aware-ts` (project service) | none — strict tier plus React, jsx-a11y, and `@tanstack/query` rule set is the right family today | linted + ratcheted | — |
| `packages/server/prisma/seed.ts`, `seed-template.ts` | 2 .ts | yes (server-scripts parser project) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` parser project | none — strict tier with `no-restricted-syntax` boundary allowlist for `process.exit` | linted + ratcheted | — |
| `packages/server/prisma/schema.prisma` | 1 | no | none | Prisma format | `excluded` — Prisma schema is `prisma format`-managed, not an ESLint surface | excluded | Drift caught by `db:push`/migration workflow; no lint floor planned |
| `packages/server/prisma/migrations/**/*.sql` | 18 .sql | no | none | — | `excluded` — append-only migrations, reviewed individually | excluded | — |
| `packages/server/prisma/migrations/migration_lock.toml` | 1 .toml | no | none | — | `excluded` — Prisma-managed | excluded | — |
| `packages/server/prisma/migrations/.safety-acknowledged` | 1 | no | none | — | `excluded` — sentinel file for `migration-safety-scan.ts` | excluded | — |
| `packages/server/scripts/pgexec.ts` | 1 .ts | yes (server-scripts parser project) | `ratchet/local-type-assertion-boundary` | ESLint `packages/server/tsconfig.scripts.json` parser project | none — strict tier with `no-restricted-syntax` allowlist for `process.exit` | linted + ratcheted | — |

## Package Tests And Test Helpers

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `packages/shared/src/**/*.{test,spec}.{ts,tsx}` plus `test/**` | ~51 .ts | yes (test-relaxed tier: `max-lines`, `no-magic-numbers`, `no-non-null-assertion`, `no-unsafe-return`, `no-unnecessary-type-assertion` off; vitest rules and `local/test-file-location` on) | `ratchet/local-type-assertion-boundary` only (max-lines ratchet ignores tests) | ESLint `type-aware-ts` | none — vitest rule set covers bug-class quality | linted + ratcheted | — |
| `packages/server/src/**/*.{test,spec}.{ts,tsx}` plus `test/**` and `**/*-test-helper.ts` | ~164 .ts | yes (test-relaxed tier with vitest rules) | `ratchet/local-type-assertion-boundary` | ESLint `type-aware-ts` | none | linted + ratcheted | — |
| `packages/client/src/**/*.{test,spec}.{ts,tsx}` plus `test/**` and `*.test-helper.*` | ~256 .ts+.tsx (190 .tsx + 66 .ts) | yes (test-relaxed tier with vitest rules, plus `mock-trpc*` `promise-function-async` carve-out) | `ratchet/local-type-assertion-boundary` (named `mock-trpc.tsx` / fixtures get higher caps) | ESLint `type-aware-ts` | none | linted + ratcheted | — |

## End-To-End Tests

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `e2e/**/*.ts` (specs, page objects, helpers) | 44 .ts | yes (Playwright recommended + custom Musi rules: `local/e2e-prefer-role-selectors` with legacy allowlist; `local/test-file-location`) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.e2e.json` parser project | none — Playwright rule set is the right family today | linted + ratcheted | Legacy `local/e2e-prefer-role-selectors` allowlist drains opportunistically (Plan Step 3c) |

## Linted Scripts (Explicit `eslint.config.js` Re-includes)

These are the `scripts/**` re-includes that survive the global ignore. They
share `tsconfig.scripts.json` and additionally apply
`local/type-assertion-boundary` per a dedicated `rules` block.

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/code-intel/**/*.ts` | 38 .ts (incl. `overview-query.spec.ts`, `bun-test.d.ts`) | yes | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — strict tier already applies | linted + ratcheted | — |
| `scripts/code-intel-server.ts` | 1 .ts | yes | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none | linted + ratcheted | — |
| `scripts/drift/**/*.ts` | 2 .ts (`locator-usage.ts`, `locator-usage.test.ts`) | yes | normal `local/max-lines` floor (non-test only), `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none | linted + ratcheted | — |
| `scripts/generate-lint-guidance.ts` | 1 .ts | yes | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none | linted + ratcheted | — |
| `scripts/lint-rule-docs.ts` | 1 .ts | yes | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none | linted + ratcheted | — |
| `scripts/lint-ratchet-config.ts` | 1 .ts | yes | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — pure config object | linted + ratcheted | — |
| `scripts/lint-ratchet-registry-builders.ts` | 1 .ts | yes | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — typed registry builders keep ratchet family options centralized | linted + ratcheted | — |
| `scripts/eslint-config-shared-policy.d.ts` | 1 .d.ts | yes | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — declaration shim for importing JS ESLint policy data from TypeScript scripts | linted + ratcheted | — |
| `scripts/logs-audit.test.ts` | 1 .ts | yes (only the test is re-included; entrypoint `scripts/logs-audit.ts` is unlinted — see Leaf 40 row below) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none on the test (vitest rules apply) | linted + ratcheted | Pair with the unlinted `scripts/logs-audit.ts` row |
| `scripts/drift-ai/errors.ts`, `scope.ts`, `scope.test.ts` | 3 .ts | yes (named carve-out in eslint.config.js ignores) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-drift-ai` (production files only) | ESLint `tsconfig.scripts.json` | none — narrow strict-tier files | linted + ratcheted | — |

## Unlinted Scripts (Outside `bun run lint`)

All rows below are covered by `ratchet/local-type-assertion-boundary`
(via `scripts/**/*.ts`) and therefore have a floor against new boundary
violations. Additional broad floors that have landed are listed in each row's
`Existing ratchet/floor` cell. The `Proposed rule/tool` column is now reserved
for still-missing broad-shallow floors; deeper rule adoption and drains are
recorded in `Blocker/follow-up` with a `Why:` rationale.

### Generate-Harness-Controls (Leaf 30)

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/generate-harness-controls.ts`, `generate-harness-controls-validation.ts` | 2 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-generate-harness-controls` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — broad singleton floor is in place | ratcheted | Deeper follow-up: Leaf 30 can still drain/adopt `complexity` and `max-params`. Why: `local/max-lines` plus type-boundary coverage is enough broad-shallow coverage for this singleton. |

### Code-Intel Facade (Leaf 31, Leaf 40 test)

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/code-intel.ts` | 1 .ts (top-level facade) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-code-intel` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — broad facade floor is in place | ratcheted | Deeper follow-up: Leaf 31 still owns the 9 known `@typescript-eslint/consistent-type-imports` rewrite/drain. Why: `local/max-lines` plus type-boundary coverage prevents broad growth while type-import cleanup waits. |
| `scripts/code-intel.test.ts` | 1 .ts | yes (exact re-include from `scripts/**/*`) | `ratchet/local-type-assertion-boundary`, `ratchet/typescript-eslint-explicit-function-return-type-script-tests`, `ratchet/typescript-eslint-no-unsafe-assignment-script-tests`, `ratchet/typescript-eslint-require-await-script-singletons`, `ratchet/typescript-eslint-restrict-template-expressions-top-level-scripts`, `ratchet/vitest-expect-expect-script-tests`, `ratchet/vitest-valid-expect-script-tests` | ESLint via `tsconfig.scripts.json` parser override | none — normal lint plus bounded-debt ratchets are in place | linted + ratcheted | Leaf 41g closed the broad-shallow blocker. Deeper follow-up: Leaf 40 can still split/drain the large test and remove the explicit-return, unsafe-assignment, require-await, and template-expression ratchet debt. |

### Drift-AI (Leaves 32 / 33 / 34, plus Leaf 40 entrypoint)

Per Leaf 41 implementation order item 5, prefer coherent rule-scoped
`drift-ai` ratchets with precise file sets over overlapping sibling ratchets.
The broad drift-ai production floors now cover max-lines and complexity, and
the drift-ai tests have bug-class ratchets. Remaining report/inventory-family
rules below are deeper follow-ups, not broad-shallow blockers.

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/drift-ai.ts` | 1 .ts (entrypoint) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-drift-ai`, `ratchet/core-complexity-drift-ai` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — drift-ai broad production floors are in place | ratcheted | Deeper follow-up: Leaf 40 normal-lint adoption can still drain `simple-import-sort/imports`. Why: max-lines and complexity ratchets already block broad production regressions. |
| `scripts/drift-ai/{chunks,cli-args,git-changed-scope,inventory-by-dir,prepare-run,report-builder,report-format,report-output,runner,types}.ts` | 10 .ts (entrypoint split helpers) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-drift-ai`, `ratchet/core-complexity-drift-ai` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — drift-ai broad production floors are in place | ratcheted | Pair with `scripts/drift-ai.ts`; these helpers keep the entrypoint below the max-lines ceiling while preserving the existing broad floors. |
| `scripts/drift-ai.test.ts` | 1 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/vitest-expect-expect-drift-ai-tests`, `ratchet/vitest-valid-expect-drift-ai-tests` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none - bug-class rules now floored | ratcheted | — |
| `scripts/drift-ai/comments.ts` and `comments.test.ts` | 2 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-drift-ai`, `ratchet/core-complexity-drift-ai` (production file only); test-only: `ratchet/vitest-expect-expect-drift-ai-tests`, `ratchet/vitest-valid-expect-drift-ai-tests` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — drift-ai production/test floors are in place | ratcheted | Deeper follow-up: report-family `simple-import-sort`, `regexp/*`, `@typescript-eslint/only-throw-error`, and `@typescript-eslint/explicit-function-return-type`. Why: production max-lines/complexity plus test bug-class ratchets already cover broad regression. |
| `scripts/drift-ai/harness-freshness.ts`, `harness-freshness-io.ts`, and `harness-freshness.test.ts` | 3 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-drift-ai`, `ratchet/core-complexity-drift-ai` (production file only); test-only: `ratchet/vitest-expect-expect-drift-ai-tests`, `ratchet/vitest-valid-expect-drift-ai-tests` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — drift-ai production/test floors are in place | ratcheted | Deeper follow-up: report-family `simple-import-sort`, `regexp/*`, `@typescript-eslint/only-throw-error`, and `@typescript-eslint/explicit-function-return-type`. Why: production max-lines/complexity plus test bug-class ratchets already cover broad regression. |
| `scripts/drift-ai/suppressions.ts`, `suppressions-parse.ts`, and `suppressions.test.ts` | 3 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-drift-ai`, `ratchet/core-complexity-drift-ai` (production file only); test-only: `ratchet/vitest-expect-expect-drift-ai-tests`, `ratchet/vitest-valid-expect-drift-ai-tests` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — drift-ai production/test floors are in place | ratcheted | Deeper follow-up: report-family `simple-import-sort`, `regexp/*`, `@typescript-eslint/only-throw-error`, and `@typescript-eslint/explicit-function-return-type`. Why: production max-lines/complexity plus test bug-class ratchets already cover broad regression. |
| `scripts/drift-ai/config.ts`, `config-parsing.ts`, and `config-paths.ts` | 3 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-drift-ai`, `ratchet/core-complexity-drift-ai` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — drift-ai broad production floors are in place | ratcheted | Deeper follow-up: Leaf 34 inventory-family `simple-import-sort`, `regexp/*`, `@typescript-eslint/restrict-template-expressions`, and `@typescript-eslint/explicit-function-return-type`. Why: max-lines and complexity ratchets already block broad production regressions. |
| `scripts/drift-ai/current-inventory.ts` and `current-inventory.test.ts` | 2 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-drift-ai`, `ratchet/core-complexity-drift-ai` (production file only); test-only: `ratchet/vitest-expect-expect-drift-ai-tests`, `ratchet/vitest-valid-expect-drift-ai-tests` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — drift-ai production/test floors are in place | ratcheted | Deeper follow-up: inventory-family `simple-import-sort`, `regexp/*`, `@typescript-eslint/restrict-template-expressions`, and `@typescript-eslint/explicit-function-return-type`. Why: production max-lines/complexity plus test bug-class ratchets already cover broad regression. |
| `scripts/drift-ai/duplicates.ts`, `duplicates-runner.ts`, and `duplicates.test.ts` | 3 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-drift-ai`, `ratchet/core-complexity-drift-ai` (production file only); test-only: `ratchet/vitest-expect-expect-drift-ai-tests`, `ratchet/vitest-valid-expect-drift-ai-tests` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — drift-ai production/test floors are in place | ratcheted | Deeper follow-up: inventory-family `simple-import-sort`, `regexp/*`, `@typescript-eslint/restrict-template-expressions`, and `@typescript-eslint/explicit-function-return-type`. Why: production max-lines/complexity plus test bug-class ratchets already cover broad regression. |
| `scripts/drift-ai/ghost-files.ts` and `ghost-files.test.ts` | 2 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-drift-ai`, `ratchet/core-complexity-drift-ai` (production file only); test-only: `ratchet/vitest-expect-expect-drift-ai-tests`, `ratchet/vitest-valid-expect-drift-ai-tests` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — drift-ai production/test floors are in place | ratcheted | Deeper follow-up: inventory-family `simple-import-sort`, `regexp/*`, `@typescript-eslint/restrict-template-expressions`, and `@typescript-eslint/explicit-function-return-type`. Why: production max-lines/complexity plus test bug-class ratchets already cover broad regression. |
| `scripts/drift-ai/ghost-files-*.ts` | 7 .ts (ghost-files split helpers) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-drift-ai`, `ratchet/core-complexity-drift-ai` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — drift-ai broad production floors are in place | ratcheted | Pair with `scripts/drift-ai/ghost-files.ts`; these helpers keep the detector facade below the max-lines ceiling while preserving the existing broad floors. |
| `scripts/drift-ai/fixtures/jscpd-report.basic.json` | 1 .json | no (JSON lint ignores via `scripts/**/*`) | none | — | `excluded` — fixture | excluded | — |

### Codemods (Leaves 35–37)

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/codemods/concurrency-guard.ts` and `scripts/codemods/concurrency-guard/*.ts` | 10 .ts (facade and split helpers) | no (in `tsconfig.scripts.json` via `scripts/codemods/**/*.ts`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-codemods`, `ratchet/core-complexity-codemods` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — codemod broad production floors are in place | ratcheted | Deeper follow-up: Leaf 36 can still add/drain `max-params`. Why: codemod max-lines and complexity ratchets already block broad production regressions; keep this explicit helper row paired with the facade split helpers. |
| `scripts/codemods/structured-logging-fix.ts` and `structured-logging-fix-transforms.ts` | 2 .ts | no (in `tsconfig.scripts.json` via `scripts/codemods/**/*.ts`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-codemods`, `ratchet/core-complexity-codemods` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — codemod broad production floors are in place | ratcheted | Deeper follow-up: Leaf 36 can still add/drain `max-params`. Why: codemod max-lines and complexity ratchets already block broad production regressions. |
| `scripts/codemods/expand-barrel.ts` and `scripts/codemods/expand-barrel/*.ts` | 13 .ts (facade and split helpers) | no (in `tsconfig.scripts.json` via `scripts/codemods/**/*.ts`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-codemods`, `ratchet/core-complexity-codemods` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — codemod broad production floors are in place | ratcheted | Deeper follow-up: Leaf 37 can still add/drain `max-params`. Why: codemod max-lines and complexity ratchets already block broad production regressions; keep this explicit helper row paired with the facade split helpers. |
| `scripts/codemods/trpc-shared-input.ts`, `trpc-shared-input-candidates.ts`, `trpc-shared-output.ts`, `trpc-shared-output-candidates.ts` | 4 .ts | no (in `tsconfig.scripts.json` via `scripts/codemods/**/*.ts`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-codemods`, `ratchet/core-complexity-codemods` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — codemod broad production floors are in place | ratcheted | Deeper follow-up: Leaf 37 can still add/drain `max-params`. Why: codemod max-lines and complexity ratchets already block broad production regressions. |
| `scripts/codemods/lib/trpc-shared-schema*.ts` | 8 .ts (shared codemod helper facade and split helpers) | no (in `tsconfig.scripts.json` via `scripts/codemods/**/*.ts`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-codemods`, `ratchet/core-complexity-codemods` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — codemod broad production floors are in place | ratcheted | Deeper follow-up: Leaf 37 can still add/drain `max-params`. Why: codemod max-lines and complexity ratchets already block broad production regressions; keep this explicit shared helper row paired with the facade split helpers. |
| `scripts/codemods/concurrency-guard.test.ts`, `expand-barrel.test.ts`, `structured-logging-fix.test.ts`, `trpc-shared-schema-codemod.test.ts` | 4 .ts (test harness) | no (in `tsconfig.scripts.json` via `scripts/codemods/**/*.ts`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/typescript-eslint-no-misused-promises-codemod-tests`, `ratchet/typescript-eslint-only-throw-error-codemod-tests`, `ratchet/vitest-expect-expect-codemod-tests`, `ratchet/vitest-valid-expect-codemod-tests` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — bug-class rules now floored; drain in Leaf 35 | ratcheted | Leaf 35 (fix-soon urgency per Leaf 41 §Candidate Work bullet 4) |
| `scripts/codemods/tsconfig.json` | 1 .json | no (global `scripts/**/*` ignore overrides the JSON config block) | none | — | `excluded` — parser project file read by typescript-eslint, not source | excluded | Global `scripts/**/*` ignore intentionally keeps codemod parser-project config out of ESLint reach. |
| `scripts/codemods/fixtures/**/*` | ~390 mixed .ts/.json | no | excluded by `ratchet/local-type-assertion-boundary` ignore (`scripts/codemods/fixtures/**`) and by global `scripts/**/*` ignore | — | `excluded` — synthesized before/after test inputs, not live code | excluded | Leaf 27 tracks harmonizing the broader ratchet/eslint scope |

### Top-Level Scripts Outside `tsconfig.scripts.json` (Leaf 38)

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/db-status.ts` | 1 .ts | no (in `tsconfig.scripts.json` and the scripts parser block, but not in `eslint.config.js` re-includes) | `ratchet/core-complexity-top-level-scripts`, `ratchet/core-no-magic-numbers-top-level-scripts`, `ratchet/core-preserve-caught-error-top-level-scripts`, `ratchet/local-type-assertion-boundary`, `ratchet/typescript-eslint-no-unsafe-argument-top-level-scripts`, `ratchet/typescript-eslint-restrict-template-expressions-top-level-scripts`, `ratchet/typescript-eslint-unbound-method-top-level-scripts` (also named in `eslint.config.js` `no-restricted-syntax` allowlist for the `process.env` and `process.exit` carve-outs even though the file itself is not normal-linted) | parser wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet drain | drain current `restrict-template-expressions` count before normal lint | ratcheted | — |
| `scripts/harness-emit-envelope.ts` | 1 .ts | no (in `tsconfig.scripts.json` and the scripts parser block, but not in `eslint.config.js` re-includes) | `ratchet/core-complexity-top-level-scripts`, `ratchet/core-no-magic-numbers-top-level-scripts`, `ratchet/core-preserve-caught-error-top-level-scripts`, `ratchet/local-type-assertion-boundary`, `ratchet/typescript-eslint-no-unsafe-argument-top-level-scripts`, `ratchet/typescript-eslint-restrict-template-expressions-top-level-scripts`, `ratchet/typescript-eslint-unbound-method-top-level-scripts` | parser wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet drain | drain import-sort, caught-error, no-unsafe, unbound-method, and no-magic findings before normal lint | ratcheted | — |
| `scripts/sensor-blob-size.ts` | 1 .ts | no (in `tsconfig.scripts.json` and the scripts parser block, but not in `eslint.config.js` re-includes) | `ratchet/core-complexity-top-level-scripts`, `ratchet/core-no-magic-numbers-top-level-scripts`, `ratchet/core-preserve-caught-error-top-level-scripts`, `ratchet/local-type-assertion-boundary`, `ratchet/typescript-eslint-no-unsafe-argument-top-level-scripts`, `ratchet/typescript-eslint-restrict-template-expressions-top-level-scripts`, `ratchet/typescript-eslint-unbound-method-top-level-scripts` | parser wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet drain | drain complexity, no-magic, and template-expression findings before normal lint | ratcheted | — |
| `scripts/sensor-blob-size.test.ts` | 1 .ts | no (in `tsconfig.scripts.json` and the scripts parser block, but not in `eslint.config.js` re-includes) | `ratchet/core-complexity-top-level-scripts`, `ratchet/core-preserve-caught-error-top-level-scripts`, `ratchet/local-type-assertion-boundary`, `ratchet/typescript-eslint-no-unsafe-argument-top-level-scripts`, `ratchet/typescript-eslint-restrict-template-expressions-top-level-scripts`, `ratchet/typescript-eslint-unbound-method-top-level-scripts` | parser wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet drain | no current findings; keep paired with `sensor-blob-size.ts` until normal lint adoption | ratcheted | — |

### Ratchet/Harness Runtime Scripts (Leaf 39)

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/lint-ratchet.ts` | 1 .ts (ratchet runner CLI) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/core-complexity-lint-ratchet-runtime`, `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-runtime` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — runtime broad production floors are in place | ratcheted | Deeper follow-up: Leaf 39 strict-tier normal-lint adoption. Why: runtime max-lines and complexity ratchets already block broad runner regressions. |
| `scripts/lint-ratchet-baseline.ts` | 1 .ts (baseline serializer) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/core-complexity-lint-ratchet-runtime`, `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-runtime` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — runtime broad production floors are in place | ratcheted | Deeper follow-up: Leaf 39 strict-tier normal-lint adoption. Why: runtime max-lines and complexity ratchets already block broad runner regressions. |
| `scripts/lint-ratchet/*.ts` | 28 .ts (runner and baseline split helpers, including the debt-log schema parser, writer, and update applicator) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/core-complexity-lint-ratchet-runtime`, `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-runtime` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — runtime broad production floors are in place | ratcheted | Pair with the `scripts/lint-ratchet.ts` and `scripts/lint-ratchet-baseline.ts` facades; these helpers drain `ratchet/local-max-lines-runtime` while preserving the same runtime floors. |
| `scripts/lint-ratchet-baseline-compare.ts` | 1 .ts (baseline comparator helper) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/core-complexity-lint-ratchet-runtime`, `ratchet/local-type-assertion-boundary` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — runtime complexity and type-boundary floors are in place | ratcheted | Split out in Leaf 42c as under-cap helper code; deeper follow-up remains Leaf 39 strict-tier normal-lint adoption. |
| `scripts/lint-ratchet-baseline-parse.ts` | 1 .ts (baseline parser helper) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/core-complexity-lint-ratchet-runtime`, `ratchet/local-type-assertion-boundary` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — runtime complexity and type-boundary floors are in place | ratcheted | Split out in Leaf 42c as under-cap helper code; deeper follow-up remains Leaf 39 strict-tier normal-lint adoption. |
| `scripts/lint-ratchet-metrics.ts` | 1 .ts (ratchet metric parser/comparator helper) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/core-complexity-lint-ratchet-runtime`, `ratchet/local-type-assertion-boundary` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — runtime complexity floor is in place | ratcheted | Deeper follow-up: Leaf 39 strict-tier normal-lint adoption. Why: the complexity ratchet covers the meaningful broad production risk for this small helper; strict-tier adoption is drain work. |
| `scripts/lint-ratchet-output.ts` | 1 .ts (diagnostics output helper) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none - small helper split keeps the runner under its max-lines ratchet | ratcheted | Deeper follow-up: Leaf 39 strict-tier normal-lint adoption. Why: this helper exists to keep the main runtime runner below the existing max-lines floor; normal lint adoption remains broader drain work. |
| `scripts/lint-ratchet-check-registry.ts` | 1 .ts (registry preflight helper) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none - sibling preflight keeps registry-only checks out of the runner | ratcheted | Deeper follow-up: Leaf 39 strict-tier normal-lint adoption can decide whether this helper joins the exact runtime max-lines and complexity ratchets. |
| `scripts/ratchet-manifest-message.ts` | 1 .ts (shared missing-ratchet manifest formatter) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/core-complexity-lint-ratchet-runtime`, `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-runtime` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none - tiny formatter shared by harness and ratchet registry checks | ratcheted | Deeper follow-up: Leaf 39 strict-tier normal-lint adoption can decide whether this helper joins normal lint with the rest of the runtime helpers. |
| `scripts/lint-ratchet-report.ts` | 1 .ts (diagnostics markdown formatter) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none - sibling formatter keeps PR-comment logic out of the runner | ratcheted | Deeper follow-up: Leaf 39 strict-tier normal-lint adoption can decide whether this helper joins the exact runtime max-lines and complexity ratchets. |
| `scripts/lint-ratchet-summary.ts` | 1 .ts (baseline summary helper) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none - small baseline-only helper split keeps the runner under its max-lines ratchet | ratcheted | Deeper follow-up: Leaf 39 strict-tier normal-lint adoption can decide whether this helper joins the exact runtime max-lines and complexity ratchets. |
| `scripts/lint-ratchet-debt-log.ts` | 1 .ts (read-only debt-log markdown renderer) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none - sibling read-only renderer keeps the committed acceptance log out of the runner | ratcheted | Deeper follow-up: Leaf 39 strict-tier normal-lint adoption can decide whether this helper joins the exact runtime max-lines and complexity ratchets. |
| `scripts/lint-ratchet-zero-baseline.ts` | 1 .ts (zero-baseline lifecycle report helper) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none - report-first helper keeps drained-ratchet lifecycle auditing out of the runner | ratcheted | Deeper follow-up: Leaf 39 strict-tier normal-lint adoption can decide whether this helper joins the exact runtime max-lines and complexity ratchets. |
| `scripts/lint-ratchet-baseline.test.ts` | 1 .ts | yes (exact re-include from `scripts/**/*`) | `ratchet/local-type-assertion-boundary`, `ratchet/regexp-no-super-linear-backtracking-script-tests`, `ratchet/typescript-eslint-explicit-function-return-type-script-tests`, `ratchet/vitest-expect-expect-script-tests`, `ratchet/vitest-valid-expect-script-tests` | ESLint via `tsconfig.scripts.json` parser override | none — normal lint plus bounded-debt ratchets are in place | linted + ratcheted | Leaf 41g closed the broad-shallow blocker. Deeper follow-up: Leaf 39 can still split/drain the large test and remove the explicit-return and regexp backtracking ratchet debt. |
| `scripts/lint-ratchet-check-registry.test.ts` | 1 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none - focused Vitest coverage exercises the registry preflight helper | ratcheted | Deeper follow-up: Leaf 39 strict-tier normal-lint adoption can decide whether this script test joins the exact normal-lint/script-test ratchet set. |
| `scripts/lint-ratchet-output.test.ts` | 1 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none - subprocess smoke covers the behavior in `test:scripts` | ratcheted | Deeper follow-up: Leaf 39 strict-tier normal-lint adoption can decide whether this new script test joins the exact normal-lint/script-test ratchet set. |
| `scripts/lint-ratchet-report.test.ts` | 1 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none - focused Vitest coverage exercises the report formatter | ratcheted | Deeper follow-up: Leaf 39 strict-tier normal-lint adoption can decide whether this script test joins the exact normal-lint/script-test ratchet set. |
| `scripts/lint-ratchet-summary.test.ts` | 1 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none - focused Vitest coverage exercises the summary reducer and formatter | ratcheted | Deeper follow-up: Leaf 39 strict-tier normal-lint adoption can decide whether this script test joins the exact normal-lint/script-test ratchet set. |
| `scripts/lint-ratchet-debt-log.test.ts` | 1 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none - focused Vitest coverage exercises the debt-log renderer and reader | ratcheted | Deeper follow-up: Leaf 39 strict-tier normal-lint adoption can decide whether this script test joins the exact normal-lint/script-test ratchet set. |
| `scripts/lint-ratchet-debt-log-schema.test.ts` | 1 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none - focused Vitest coverage exercises the hand-rolled debt-log entry validator | ratcheted | Deeper follow-up: Leaf 39 strict-tier normal-lint adoption can decide whether this script test joins the exact normal-lint/script-test ratchet set. |
| `scripts/lint-ratchet-debt-log-write.test.ts` | 1 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none - focused Vitest coverage exercises the debt-log builder, append guard, and update-apply seam | ratcheted | Deeper follow-up: Leaf 39 strict-tier normal-lint adoption can decide whether this script test joins the exact normal-lint/script-test ratchet set. |
| `scripts/lint-ratchet-zero-baseline.test.ts` | 1 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none - focused Vitest coverage exercises the zero-baseline lifecycle report | ratcheted | Deeper follow-up: Leaf 39 strict-tier normal-lint adoption can decide whether this script test joins the exact normal-lint/script-test ratchet set. |
| `scripts/lint-agent.ts` | 1 .ts (machine-readable lint slice from PR 3a) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-runtime` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — runtime broad production floor is in place | ratcheted | Deeper follow-up: Leaf 39 strict-tier normal-lint adoption. Why: runtime max-lines blocks broad growth; strict-tier adoption is drain work. |
| `scripts/harness-check.ts`, `harness-check-validation.ts`, and `harness-wrapper-slot-*.ts` | 4 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-runtime` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — runtime broad production floor is in place | ratcheted | Deeper follow-up: Leaf 39 strict-tier normal-lint adoption. Why: runtime max-lines blocks broad growth; strict-tier adoption is drain work. |
| `scripts/lint-coverage-map-check-eslint-reach.ts` | 1 .ts | yes (exact re-include from `scripts/**/*`) | none | ESLint via `tsconfig.scripts.json` parser override | none — small helper for the coverage-map ESLint reach gate | linted | Leaf 41j split this helper out to keep the checker source under its existing max-lines ratchet. |
| `scripts/lint-coverage-map-check.ts` | 1 .ts | yes (exact re-include from `scripts/**/*`) | `ratchet/core-complexity-top-level-scripts`, `ratchet/core-no-magic-numbers-top-level-scripts`, `ratchet/local-type-assertion-boundary`, `ratchet/regexp-no-unused-capturing-group-lint-coverage-map-check`, `ratchet/typescript-eslint-require-await-script-singletons` | ESLint via `tsconfig.scripts.json` parser override | none — normal lint plus singleton source and bounded-debt ratchets are in place | linted + ratcheted | Leaf 41g closed the broad-shallow blocker. Deeper follow-up: drain the coverage-map checker complexity, magic-number, and regexp debt before removing the exact normal-lint carve-outs. |
| `scripts/lint-coverage-map-check.test.ts` | 1 .ts | yes (exact re-include from `scripts/**/*`) | `ratchet/local-type-assertion-boundary`, `ratchet/vitest-expect-expect-script-tests`, `ratchet/vitest-valid-expect-script-tests` | ESLint via `tsconfig.scripts.json` parser override | none — normal lint plus bounded-debt ratchets are in place | linted + ratcheted | Leaf 41g closed the broad-shallow blocker. No new current findings were found; future work is normal drain/deeper-rule work, not broad-shallow coverage. |
| `scripts/path-policy.ts`, `path-policy-smoke-subjects.ts`, `path-policy-query*.ts`, `path-policy.test.ts` | 6 .ts | yes (exact re-include from `scripts/**/*`) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — descriptive data model, shell query interface, and validation tests are under normal lint | linted + ratcheted | Lint reference-readiness tasks 14 and 15 added the shared path-policy data model and NUL-safe shell query interface without migrating production callers. |

### Largest Remaining Entrypoints/Tests (Leaf 40)

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/logs-audit.ts` | 1 .ts (entrypoint; only `logs-audit.test.ts` is re-included today) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-logs-audit` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — logs-audit broad entrypoint floor is in place | ratcheted | Deeper follow-up: Leaf 40 strict-tier normal-lint adoption. Why: `local/max-lines` plus type-boundary coverage blocks broad growth while the entrypoint split/drain waits. |
| `scripts/logs-audit-*.ts` | 4 .ts (extracted from `logs-audit.ts` module split) | no (reachable through `logs-audit.ts`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-logs-audit` | parser already wired via the `logs-audit.ts` import graph; blocker is the ESLint re-include / ratchet entry | none — helper files are covered by the existing type-boundary ratchet and the logs-audit max-lines ratchet | ratcheted | Pair with the entrypoint `scripts/logs-audit.ts` row above. |
| `scripts/logs-audit/fixtures/business-events-server.jsonl`, `redacted-server.jsonl` | 2 .jsonl | no | none | — | `excluded` — fixture | excluded | — |

### Other Script Fixtures (Always Excluded)

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/__fixtures__/lint-ratchet-report-clean.json` | 1 .json | no | none | — | `excluded` — fixture diagnostics envelope used by the report smoke | excluded | — |
| `scripts/__fixtures__/lint-ratchet-report-regression.json` | 1 .json | no | none | — | `excluded` — fixture diagnostics envelope used by the report smoke | excluded | — |
| `scripts/test-fixtures/lint-ratchet/expected-*.config.mjs` | 2 .mjs | no (global `scripts/**/*` + `**/*.config.*` ignore) | none | — | `excluded` — expected-generated-config snapshots used by `test-lint-ratchet.sh` | excluded | — |
| `scripts/fixtures/generate-harness-controls/expected.md`, `scripts/fixtures/generate-lint-guidance/expected.md` | 2 .md | no | none | — | `excluded` — expected-output snapshots | excluded | — |

## Local ESLint Rules

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `eslint-rules/{concurrency-guard,e2e-prefer-role-selectors,max-lines,no-async-array-callbacks,no-barrel,no-broadcast-in-transaction,no-explicit-any,no-llm-artifacts,no-swallowed-errors,socket-registry-broadcasts,strict-shared-schemas,strict-trpc-input,structured-logging,test-file-location,trpc-require-output-schema,trpc-shared-input-schema,trpc-shared-output-schema,type-assertion-boundary}.js` (rule implementations) | 18 .js (one per rule registered in `eslint.config.js`) | yes | `ratchet/core-complexity-eslint-rules`, `ratchet/core-no-magic-numbers-eslint-rules`, `ratchet/regexp-no-unused-capturing-group-eslint-rules`, `ratchet/regexp-no-useless-non-capturing-group-eslint-rules` | ESLint recommended JS + explicit `no-unused-vars` + non-type-aware syntactic strict-tier / regexp floor; Phase A.3 adds `simple-import-sort`, `eslint-comments` hygiene, and generic `local/*`; scoped `eslint-plugin-jsdoc` starter floor adds JSDoc syntax/name/type checks without requiring prose or new blocks; ratchets use `minimal-ts` | Domain/path-specific local rules and type-aware `local/no-explicit-any` / `local/no-barrel` remain deferred as non-broad-shallow. Deeper JSDoc floors such as `require-jsdoc`, descriptions, and broad return requirements remain intentionally off to avoid mass rewrites. | linted + ratcheted | Phase A.3 landed the safe subset with zero findings; the JSDoc starter floor also landed green with no ratchet needed. |
| `eslint-rules/*.test.js` (rule tests) | 20 .js | yes | `ratchet/vitest-no-commented-out-tests-eslint-rules-tests`, `ratchet/vitest-no-conditional-expect-eslint-rules-tests` | ESLint recommended JS + explicit `no-unused-vars` + Vitest recommended floor; no project service | none — Phase B landed; known debt is ratcheted | linted + ratcheted | Debt: 1 commented-out-tests + 5 conditional-expect messages |
| `eslint-rules/vitest.config.ts` | 1 .ts | no (`**/*.config.*`) | none | — | `excluded` — vitest config | excluded | — |

## Shell Scripts And Git Hooks

Leaf 41b landed a ShellCheck floor for all maintained shell scripts and hooks.
`bun run lint:shell` checks the full maintained set, and `bun run lint` /
`bun run lint:changed` include the same floor through `scripts/lint-shell.sh`
and `scripts/lint-changed.sh`. ShellCheck resolves through the system
`shellcheck` binary on `PATH` (`apt install shellcheck`; this container reports
`/usr/bin/shellcheck` 0.9.0), enables `--external-sources`, and enforces
`--severity=warning` while preserving shebang-based shell dialect detection.

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/**/*.sh` (top-level verify, test-*, worktree-*, db, doctor, etc.; excludes the ai-hooks row below) | 55 .sh | yes (`bun run lint:shell`) | ShellCheck floor | system `shellcheck` (`apt install shellcheck`, 0.9.0 in this container) | none | linted | Leaf 41b landed; smoke: `scripts/test-lint-shell.sh` |
| `scripts/ai-hooks/*.sh` (agent hook implementations) | 12 .sh | yes (`bun run lint:shell`) | ShellCheck floor | system `shellcheck` (`apt install shellcheck`, 0.9.0 in this container) | none | linted | Leaf 41b landed |
| `.claude/hooks/*.sh` (Claude Code hooks) | 7 .sh | yes (`bun run lint:shell`) | ShellCheck floor | system `shellcheck` (`apt install shellcheck`, 0.9.0 in this container) | none | linted | Leaf 41b landed; changed-gate relevant |
| `.codex/hooks/*.sh` (Codex hooks) | 3 .sh | yes (`bun run lint:shell`) | ShellCheck floor | system `shellcheck` (`apt install shellcheck`, 0.9.0 in this container) | none | linted | Leaf 41b landed; changed-gate relevant |
| `.devcontainer/container-entrypoint.sh`, `init-firewall.sh`, `start-servers.sh` | 3 .sh | yes (`bun run lint:shell`) | ShellCheck floor | system `shellcheck` (`apt install shellcheck`, 0.9.0 in this container) | none | linted | Leaf 41b landed; changed-gate relevant |
| `.husky/{pre-commit,post-checkout,post-merge,commit-msg}` | 4 (extensionless shell, with `#!/bin/bash` or `#!/usr/bin/env bash` shebangs) | yes (`bun run lint:shell`) | ShellCheck floor | system `shellcheck` (`apt install shellcheck`, 0.9.0 in this container) | none | linted | Leaf 41b landed |
| `init-test-db.sql`, `.devcontainer/init-test-db.sql` | 2 .sql | no | none | — | `excluded` — bootstrap SQL, not maintained as live ESLint surface | excluded | — |

## Workflows And Agent/Devcontainer YAML/TOML/JSON

`@eslint/json` already covers tracked JSON (excluding `scripts/**/*`,
`tsconfig*.json` follows the jsonc track), so most JSON manifest hygiene is
already floored. Leaf 41c added `bun run lint:config-sensors` for workflow,
maintained YAML, TOML, and Dockerfile sensors; full `bun run lint` and
`lint:changed` include the same floor.

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `.github/workflows/ci.yml` | 1 .yml | yes (`bun run lint:config-sensors`) | actionlint + yamllint floor | `@tktco/node-actionlint@1.6.0`, system `yamllint` (`apt install yamllint`, >=1.29.0) | none | linted | Leaf 41c landed; changed-gate relevant |
| `.github/pull_request_template.md` | 1 .md | no | none | — | `not-code` — Markdown template | not-code | — |
| `.yamllint.yml` | 1 .yml | yes (`bun run lint:config-sensors`) | yamllint floor | system `yamllint` (`apt install yamllint`, >=1.29.0) | none | linted | Leaf 41c landed; changed-gate relevant |
| `docker-compose.yml`, `.devcontainer/docker-compose.yml` | 2 .yml | yes (`bun run lint:config-sensors`) | yamllint floor | system `yamllint` (`apt install yamllint`, >=1.29.0) | none | linted | Leaf 41c landed; changed-gate relevant |
| `.codex/skills/*/agents/openai.yaml` | 2 .yaml | yes (`bun run lint:config-sensors`) | yamllint floor | system `yamllint` (`apt install yamllint`, >=1.29.0) | none | linted | Leaf 41c landed; changed-gate relevant |
| `.codex/config.toml`, `bunfig.toml` | 2 .toml | yes (`bun run lint:config-sensors`) | taplo fmt-check + lint floor | `@taplo/cli@0.7.0` → Taplo 0.9.0 | none | linted | Leaf 41c landed; changed-gate relevant |
| `.devcontainer/devcontainer.json` | 1 .json (no comments today) | yes (strict JSON track via `**/*.json`) | none | — | if a future edit introduces `//`/`/* */` comments, add `.devcontainer/devcontainer.json` to the jsonc track | linted | — |
| `.devcontainer/Dockerfile` | 1 | yes (`bun run lint:config-sensors`) | hadolint floor | `hadolint@0.4.2` → Hadolint 2.14.0 (`DL3007` ignored for the local refreshed base image tag) | none | linted | Leaf 41c landed; changed-gate relevant; ignored local `docs/refs/5e-database/Dockerfile` is linted when present with reference-only low-value ignores |
| `.devcontainer/.env.example`, `.env.example` | 2 | no | none | — | `excluded` — example env (no secrets); maintained by hand | excluded | — |
| `packages/server/prisma/migrations/migration_lock.toml` | 1 .toml | no | none | — | `excluded` — Prisma-managed | excluded | (also listed in Production Package Source) |

## Root And Package Config Files

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `eslint.config.js` | 1 .js | yes (exact re-include from `**/*.config.*`) | normal ESLint dedicated root JS config block | Espree | JS recommended + `no-unused-vars`; JSDoc deferred because `eslint-plugin-jsdoc` is not a dependency | linted | — |
| `eslint-config/*.js` | 12 .js | yes (ESLint config support modules) | normal ESLint dedicated JS config block | Espree | JS recommended + `no-unused-vars`; composition modules plus shared policy data for ESLint scopes/restrictions | linted | Leaf 23 extraction; Task 25 composition |
| `commitlint.config.js` | 1 .js | yes (exact re-include from `**/*.config.*`) | normal ESLint dedicated root JS config block | Espree | JS recommended + `no-unused-vars`; JSDoc deferred because `eslint-plugin-jsdoc` is not a dependency | linted | — |
| `knip.config.ts`, `playwright.config.ts`, `vitest.config.ts`, `vitest.slow.config.ts` | 4 root .ts | yes (exact re-include from `**/*.config.*`) | normal ESLint TS config block | typescript-eslint project service via `tsconfig.configs.json` default project | strict-tier minus `local/max-lines`; config files are process/env boundaries | linted | — |
| `stryker.config.mjs` | 1 .mjs | yes (exact re-include from `**/*.config.*`) | normal ESLint dedicated root JS config block | Espree | JS recommended + `no-unused-vars`; JSDoc deferred because `eslint-plugin-jsdoc` is not a dependency | linted | — |
| `packages/client/vite.config.ts`, `packages/client/vitest.config.ts`, `packages/server/vitest.config.ts`, `packages/server/prisma.config.ts`, `packages/shared/vitest.config.ts` | 5 .ts | yes (exact re-include from `**/*.config.*`) | normal ESLint TS config block | typescript-eslint project service via `tsconfig.configs.json` default project | strict-tier minus `local/max-lines`; config files are process/env boundaries | linted | — |
| `scripts/vitest.config.ts`, `eslint-rules/vitest.config.ts` | 2 .ts | yes (exact re-include after the `scripts/**/*` / `eslint-rules/*` ignores) | normal ESLint TS config block | typescript-eslint project service via `tsconfig.configs.json` default project | strict-tier minus `local/max-lines`; both are active Vitest project configs (the `scripts` and `eslint-rules` projects per `vitest.config.ts`) | linted | — |
| `tsconfig.json`, `tsconfig.base.json`, `tsconfig.configs.json`, `tsconfig.e2e.json`, `tsconfig.scripts.json` | 5 root .json | yes (jsonc track) | none | — | none — `@eslint/json` covers no-duplicate-keys/etc. | linted | — |
| `packages/{client,server,shared}/tsconfig*.json` (incl. `packages/server/tsconfig.scripts.json`) | 4 .json | yes (jsonc track) | none | — | none | linted | — |
| `package.json` (root) plus `packages/{client,server,shared}/package.json` plus `packages/client/components.json` | 5 .json | yes (`@eslint/json` strict track) | none | — | Leaf 20 ("package-manifest-policy") proposes a report-first manifest sensor — keep parked unless promoted; no Leaf 41-batch floor today beyond the existing JSON rules | linted | Leaf 20 |
| `drift-ai.config.json`, `harness.controls.json`, `lint-ratchet.baseline.json` | 3 .json | yes | none | — | none — `@eslint/json` covers structural correctness | linted | — |
| `.claude/settings.json`, `.codex/hooks.json`, `.playwright/cli.config.json` | 3 .json | yes (`.playwright/cli.config.json` is matched by `**/*.json` since not under any ignore) | none | — | none | linted | — |
| `packages/server/src/seed/data/5e-srd-*.json` | 4 .json (large SRD data) | yes | none | — | none — strict JSON is enough; semantic checks live in seed pipeline | linted | — |

## Markdown And Other Docs

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `docs/**/*` | ~216 (mostly .md, plus the SRD PDF and a few `.bugs`/HTML) | no (`docs/` in global ignores) | none | — | `not-code` for the docs themselves; `doc-length.sh` hook already enforces a length sensor for `docs/agent_notes/` | not-code | `scripts/doc-length-policy.sh` is the existing floor; out of Leaf 41 scope |
| `README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, `MODULE-INDEX.md`, `packages/**/MODULE.md` (and per-feature `*MODULE.md`), `packages/**/README.md` | 1 + 28 client + 8 server + 0 shared MODULE docs + 1 nested package README, plus a handful of repo-root .md | no | none | — | `not-code` — Markdown guidance; module-index sensor already validates per-module structure | not-code | `scripts/generate-module-index.sh` + `module:index:check` is the existing structural sensor |
| `.claude/skills/**/*.md`, `.codex/skills/**/*.md` (skill content) | ~22 .md | no | none | — | `not-code` | not-code | — |
| `.devcontainer/README.md`, `.github/pull_request_template.md` | 2 .md | no | none | — | `not-code` | not-code | — |
| `docs/SRD_CC_v5.2.1.pdf` | 1 .pdf | no | none | — | `not-code` | not-code | — |

## Web Assets, Lockfiles, And Misc Tracked Files

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `packages/client/index.html` | 1 .html | no | none | — | `excluded` — Vite entry HTML; semantic checks happen via Vite/React at build time | excluded | — |
| `packages/client/src/app.css` | 1 .css | no | none | — | `excluded` — Tailwind v4 entry; `prettier --check` covers formatting | excluded | — |
| `bun.lock` | 1 | no | none | — | `not-code` — lockfile | not-code | `bun install --frozen-lockfile` in CI is the integrity check |
| `.gitignore`, `.prettierrc`, `.prettierignore`, `.worktreeinclude`, `.blob-size-allowlist` | 5 | no | none | — | `excluded` — repo metadata, hand-maintained | excluded | — |
| `packages/server/.gitignore` | 1 | no | none | — | `excluded` | excluded | — |

## Cross-Cutting Notes For Leaf 41 Implementation

- **Existing type-assertion coverage caveat.** After Leaf 41g, no tracked row
  keeps `proposed` for a remaining broad-shallow blocker. Former
  type-boundary-only script rows now either have normal lint plus ratchets, or
  treat normal-lint adoption, import-sort, regexp, explicit-return-type,
  `consistent-type-imports`, `max-params`, and similar rules as deeper
  follow-up work.
- **ESLint re-include is usually a drain step, not the remaining floor.** The
  script families above are already covered by `tsconfig.scripts.json`, so a
  type-aware ratchet can run without a parser-project expansion. The
  root/package config block is now normal-linted via `tsconfig.configs.json`.
- **Core ESLint rule support.** Core rules such as `complexity`, `max-params`,
  and `no-nested-ternary` can now use `source: { kind: "core" }` ratchet
  entries. Use that support for future deeper-rule work without treating every
  core-rule candidate as a broad-shallow blocker.
- **Non-ESLint child leaves landed.** Shell/hook ShellCheck (**41b**) and
  workflow/YAML/TOML/Dockerfile sensors (**41c**) now run through local lint and
  changed/pre-commit paths. No `pending-leaf` rows remain in this map.
- **Bug-class urgency.** Codemod and drift-ai test bug-class floors have
  landed. The remaining singleton script-test rows should get the same
  `vitest/expect-expect`, `vitest/valid-expect`,
  `@typescript-eslint/no-misused-promises`, and
  `@typescript-eslint/only-throw-error` floor before broad-shallow coverage is
  considered complete.
- **Refresh seed leaves.** Per Leaf 41 §Candidate Work bullets 6 and 8,
  Leaf 37 should include `scripts/codemods/lib/trpc-shared-schema.ts`.
  Leaf 38 has now included `scripts/sensor-blob-size.ts` plus
  `scripts/sensor-blob-size.test.ts`; both rows above point to the landed
  finished-work note.
