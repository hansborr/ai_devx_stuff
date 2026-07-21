# Lint Coverage Map

Status: First derived inventory committed 2026-05-20 as the load-bearing Leaf
41 prerequisite. Every tracked maintained code/tooling surface below resolves
to one of: `linted`, `ratcheted`, `proposed`, `pending-leaf`, `excluded`, or
`not-code`. No `unknown` rows remain; new surfaces appearing in future
`git ls-files` runs should be added under the closest section with a resolved
status before any ratchet/floor batch lands. The checker keeps the code,
tooling, fixture-data, metadata/dotfile, web asset, lockfile, binary reference,
and documentation-inventory families represented below in scope; generated,
vendored, build, cache, and dependency directories remain out of scope.

Source of truth: this file has hybrid ownership. The marker-delimited
`scripts/drift-ai/*.ts` table is generated from `git ls-files`, ESLint reach,
and `scripts/lint-ratchet/lint-ratchet-config.ts`; every other row and all
policy prose remain hand-maintained. The generator preserves every byte outside
its one marked span.

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
scripts/lint-ratchet/lint-ratchet-config.ts          # ratchet membership
```

Refresh the generated drift-ai block with
`bun run docs:lint-coverage-map:generate`; use
`bun run docs:lint-coverage-map:generate:check` for a read-only freshness check.
The generator fails closed if any direct-child candidate lacks ESLint reach and
names the missing files. It does not own root drift-ai entrypoints, nested
fixtures, other tables, or surrounding rationale.

Membership rules followed when filling in the table:

1. A file is `linted` iff it survives the global `ignores` list (with the
   ordered `!…` re-includes applied) and matches at least one config block's
   `files` glob.
2. `**/*.config.{js,mjs,ts}` is in the global `ignores`, then maintained
   root/package config files, `scripts/vitest.config.ts`, and
   `eslint-rules/vitest.config.ts` are explicitly re-included for the
   config-file policy.
3. Maintained `scripts/**/*.ts` files are linted by default through
   `tsconfig.scripts.json`. Script fixture/generated snapshot paths stay
   globally ignored: `scripts/codemods/fixtures/**`,
   `scripts/drift-ai/fixtures/**`, `scripts/fixtures/**`,
   `scripts/harness-audit/fixtures/**`, and
   `scripts/logs-audit/fixtures/**`.
4. `eslint-rules/*` is in the global `ignores`; `eslint-rules/*.js` is
   re-included for rule implementations and rule tests, while
   `eslint-rules/vitest.config.ts` is re-included by the config-file policy.
5. `eslint-config/shared-policy.js` is an ESLint config support module and is
   linted by the same dedicated JS config block as root JS config files.
6. A file is `ratcheted` iff it matches at least one ratchet entry's `files`
   glob and is not pruned by that entry's `ignores`.
7. The `local/type-assertion-boundary` ratchet still covers package, e2e, and
   maintained script TypeScript, but it ignores the same script fixture/config
   paths as normal lint. After the 2026-05-21 Leaf 41f audit, rows keep a
   `proposed` marker only when a current broad-shallow floor is still missing;
   deeper normal-lint adoption and drain rules live in the follow-up column.
8. `ratchet/local-no-commented-out-code` covers maintained JS/TS globally with
   the normal fixture/generated exclusions. It is recorded here once rather
   than repeated in every row's `Existing ratchet/floor` cell.

## Maintaining This Map

The drift gate (`scripts/lint-coverage-map-check.ts`) fires for *any* tracked,
in-scope file that matches no row — including a single new `.ts` in an existing
directory. To add a file:

- **Generated boundary:** do not hand-edit text between the drift-ai markers.
  After adding, deleting, or renaming a direct-child `scripts/drift-ai/*.ts`
  file—or changing ESLint/ratchet membership—run
  `bun run docs:lint-coverage-map:generate`. The `:generate:check` command checks
  only generated freshness; `:check` remains the semantic whole-map gate and
  `:audit` adds whole-map ESLint reach.
- **Columns:** `Path / group | Files | Normal lint | Existing ratchet/floor |
  Parser/tool | Proposed rule/tool | Status | Blocker/follow-up`.
- **Base-dir rule:** within one `Path / group` cell the first rooted full path
  (e.g. `` `scripts/foo/bar.ts` ``) sets the base directory; later **bare**
  filenames in the same cell (e.g. `` `baz.ts` ``) resolve against it. So a new
  file in a directory an existing row already covers is usually added by
  appending its bare filename to that row, not by writing a new row.
- **Scaffold:** run `bun run docs:lint-coverage-map:suggest` to
  print ready-to-paste rows (or "append to line N") for every unaccounted file,
  with `Normal lint`/`Status` pre-derived from ESLint reach and ratchet
  membership. The committing gate runs `docs:lint-coverage-map:check --staged`;
  full `verify` runs `docs:lint-coverage-map:audit` (adds the ESLint-reach
  probe). A mapped non-glob path that "matched 0 tracked files" usually just
  needs `git add`.

## Production Package Source

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `packages/shared/src/**/*.ts` (production) | 66 .ts | yes |  (default-cap subset), `ratchet/local-type-assertion-boundary`, `ratchet/max-depth-production`, `ratchet/max-lines-per-function-production`, `ratchet/strict-boolean-expressions-shared` | ESLint `type-aware-ts` (project service) | none — shared-schema strictness plus the `z.any()` restricted-syntax fence cover the meaningful axes today | linted + ratcheted | — |
| `packages/server/src/**/*.ts` (production, non-test) | ~207 .ts | yes (including `local/no-plain-error-in-trpc` on routers/services except the upload-service REST boundary) |  (default-cap subset, with named `warn` overrides for `routers/encounter.ts`, `routers/homebrew.ts`, `routers/srd.ts`, `services/rest-service.ts`), `ratchet/local-type-assertion-boundary`, `ratchet/max-depth-production`, `ratchet/max-lines-per-function-production`, `ratchet/strict-boolean-expressions-server-services` (services slice; encounter-combat is separately owned by `ratchet/strict-boolean-expressions-server-encounter-combat`) | ESLint `type-aware-ts` (project service) | none — strict tier (server-only rules: `local/concurrency-guard`, `local/no-broadcast-in-transaction`, `local/no-outer-client-in-transaction`, `local/socket-registry-broadcasts`, `local/structured-logging`, `local/strict-trpc-input`, `local/no-plain-error-in-trpc`, tRPC schema rules, and shallow permissive-output restricted syntax) is the right family today | linted + ratcheted | `packages/server/src/services/upload-service.ts` remains the documented REST-boundary exception; `routes/MODULE.md` maps its plain Errors to HTTP 400 outside tRPC. |
| `packages/client/src/**/*.{ts,tsx}` (production, non-test) | ~388 .ts+.tsx | yes |  (default-cap subset, with named `warn` overrides for several form/encounter/notes/npc/pages/stores files), `ratchet/local-no-effect-misuse-client`, `ratchet/local-type-assertion-boundary`, `ratchet/max-depth-production`, `ratchet/max-lines-per-function-production`, `ratchet/react-hooks-set-state-in-effect-client`, `ratchet/react-refresh-only-export-components-client` | ESLint `type-aware-ts` (project service) | none — strict tier plus React, jsx-a11y, `@tanstack/query`, hand-built query-key and `import.meta.env` restricted syntax, and `local/socket-listener-cleanup` pairing are the right family today | linted + ratcheted | — |
| `packages/server/prisma/seed.ts`, `seed-template.ts` | 2 .ts | yes (server-scripts parser project) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` parser project | none — strict tier with `no-restricted-syntax` boundary allowlist for `process.exit` | linted + ratcheted | — |
| `packages/server/prisma/schema.prisma` | 1 | no | none | Prisma format | `excluded` — Prisma schema is `prisma format`-managed, not an ESLint surface | excluded | Drift caught by `db:push`/migration workflow; no lint floor planned |
| `packages/server/prisma/migrations/**/*.sql` | 18 .sql | no | none | — | `excluded` — append-only migrations, reviewed individually | excluded | — |
| `packages/server/prisma/migrations/migration_lock.toml` | 1 .toml | no | none | — | `excluded` — Prisma-managed | excluded | — |
| `packages/server/prisma/migrations/.safety-acknowledged` | 1 | no | none | — | `excluded` — sentinel file for `migration-safety-scan.ts` | excluded | — |
| `packages/server/scripts/pgexec.ts` | 1 .ts | yes (server-scripts parser project) | `ratchet/local-type-assertion-boundary` | ESLint `packages/server/tsconfig.scripts.json` parser project | none — strict tier with `no-restricted-syntax` allowlist for `process.exit` | linted + ratcheted | — |

## Package Tests And Test Helpers

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `packages/shared/src/**/*.{test,spec}.{ts,tsx}` plus `test/**/*.ts` | ~51 .ts | yes (test-relaxed tier: `max-lines`, `no-magic-numbers`, `no-non-null-assertion`, `no-unsafe-return`, `no-unnecessary-type-assertion` off; vitest rules and `local/test-file-location` on) | `ratchet/local-type-assertion-boundary`, `ratchet/no-real-time-in-package-tests` | ESLint `type-aware-ts` | none — vitest rule set plus the real-clock ratchet cover bug-class quality | linted + ratcheted | — |
| `packages/server/src/**/*.{test,spec}.{ts,tsx}` plus `test/**/*.ts` and `**/*-test-helper.ts` | ~164 .ts | yes (test-relaxed tier with vitest rules) | `ratchet/local-type-assertion-boundary`, `ratchet/no-real-time-in-package-tests` | ESLint `type-aware-ts` | none | linted + ratcheted | — |
| `packages/client/src/**/*.{test,spec}.{ts,tsx}` plus `test/**/*.{ts,tsx}` and `*.test-helper.*` | ~256 .ts+.tsx (190 .tsx + 66 .ts) | yes (test-relaxed tier with vitest rules, plus `mock-trpc*` `promise-function-async` carve-out) | `ratchet/local-type-assertion-boundary`, `ratchet/no-real-time-in-package-tests` (named `mock-trpc.tsx` / fixtures get higher caps) | ESLint `type-aware-ts` | none | linted + ratcheted | — |

## End-To-End Tests

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `e2e/**/*.ts` (specs, page objects, helpers) | 47 .ts | yes (Playwright recommended + custom Musi rules; selector rules unconditional `error` — the debt-file overrides retired with the lint-followups-2026-06 03a-03g drain) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.e2e.json` parser project | none — Playwright rule set plus the Musi role-first rule are the right family today | linted + ratcheted | Selector ratchets retired 2026-06-12 at zero findings (lint-followups-2026-06 leaf 03g); `playwright/no-raw-locators` is left unconfigured because the local rule is stricter and carries Musi-specific guidance. |

## Linted Scripts (`scripts/**/*.ts` Default Coverage)

Maintained script TypeScript is linted by default through
`tsconfig.scripts.json` and additionally applies
`local/type-assertion-boundary` per a dedicated `rules` block. Fixtures and
generated snapshots stay excluded by targeted ignores.

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/client-test-isolation-classifier.ts`, `client-test-isolation-classifier-source.ts`, `client-test-isolation-classifier-types.ts`, `client-test-isolation-classifier.test.ts`, `client-test-isolation-runner.ts`, `client-test-isolation-runner.test.ts` | 6 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — focused classifier/runner coverage pins the generated client isolation buckets and lane invocation | linted + ratcheted | Supports split client Vitest lanes; unit tests cover comments, strings, `vi.mocked`, aliases, discovery, JSON CLI output, generated lane args, empty-bucket skips, and coverage rejection. |
| `scripts/vitest-worker-count.ts`, `vitest-worker-count.test.ts` | 2 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — focused coverage pins the shared group-0 cap and positive-integer environment override | linted + ratcheted | Keeps client, shared, scripts, and eslint-rules on the identical `maxWorkers` value Vitest requires within one sequence group. |
| `scripts/drift-triage.ts`, `scripts/drift-triage/drift-triage-options.ts`, `drift-triage-inputs.ts`, `drift-triage-packet-io.ts`, `drift-triage-collect.ts`, `drift-triage.test.ts`, `drift-triage-collect.test.ts` | 7 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — report-only CLI with focused parsing, packet output, verdict collection, and failure-path coverage | linted + ratcheted | Compacts drift/advisory JSON into deterministic swarm packets, then validates and collects partial agent verdicts with retry accounting. |
| `scripts/stryker-scripts.ts` | 1 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — Stryker config for the scripts mutation campaign | linted + ratcheted | Run with `bun run test:scripts:mutation`. |
| `scripts/check-local-eslint-rule-starter.ts`, `check-local-eslint-rule-starter.test.ts` | 2 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — extracts and exercises the four-file standalone starter in `docs/guides/local-eslint-rules.md` without network installation | linted + ratcheted | Whole-tree verify/CI guard; intentionally omitted from the changed gate. |
| `scripts/adr-check.ts`, `adr-check-parse.ts`, `adr-check-locators.ts`, `adr-check.test.ts` | 4 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — narrow ADR parser, structural gate locators, reverse-reference scan, and focused fixture coverage | linted + ratcheted | `adr:check` validates accepted architecture decisions against their real enforcing sources without a separate gate registry. |
| `scripts/code-intel.ts` | 1 .ts (top-level facade) | yes | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — normal lint now enforces the type-import rewrite and max-lines floor | linted + ratcheted | Leaf 03f adopted the facade into normal lint and drained the dedicated `ratchet/local-max-lines-code-intel` floor. |
| `scripts/worktree-seed-import-closure.ts`, `worktree-seed-import-closure.test.ts`, `worktree-seed-runtime-loader-exports.ts`, `worktree-seed-runtime-loader-identifiers.ts`, `worktree-seed-runtime-loader-validation.ts`, `worktree-seed-runtime-loaders.ts`, `worktree-seed-runtime-loaders.test.ts` | 7 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | focused Vitest coverage plus the worktree DB fingerprint gate on every seed fingerprint | linted + ratcheted | Recursively rejects repository-local seed runtime imports outside blanket-hashed roots and the explicit helper manifest, including aliased CommonJS and `createRequire` loader forms. |
| `scripts/lint-probe-rule.ts`, `lint-probe-rule.test.ts` | 2 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — focused unit coverage pins argument parsing and ratchet writer reuse; `scripts/tests/test-lint-probe-rule.sh` exercises the package script against real ESLint stdin | linted + ratcheted | Leaf 72 added the single-local-rule probe command for rule-authoring ergonomics. |
| `scripts/lint-message-eval.ts`, `lint-message-eval.test.ts`, `lint-message-eval/evaluator.ts`, `lint-message-eval/reporter.ts`, `lint-message-eval/trace.ts` | 5 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — focused coverage replays treatment/control traces, pins message freshness, and classifies stuck, oscillating, and cascading repairs | linted + ratcheted | Manual/scheduled report lane; see `docs/guides/lint-message-evals.md`. |
| `scripts/backlog-lint.ts`, `backlog-lint-core.ts`, `backlog-lint-format.ts`, `backlog-lint-types.ts`, `backlog-lint-metadata.ts`, `backlog-lint-status.ts`, `backlog-lint-packs.ts`, `backlog-lint-index-table.ts`, `backlog-lint-drift.ts`, `backlog-lint.test.ts`, `backlog-lint-packs.test.ts`, `backlog-lint-drift.test.ts` | 12 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — report-only backlog metadata + pack-index lint with focused parser and stale-note coverage | linted + ratcheted | `bun run backlog:lint` checks `docs/agent_notes/backlog/**/*.md` without becoming a gate. |
| `scripts/audit-dependency-licenses.ts`, `audit-dependency-licenses.test.ts` | 2 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — focused public-release dependency license audit CLI, covered by normal script lint | linted + ratcheted | Audits the production dependency closure for strong copyleft, review-only copyleft, and unknown license metadata before MIT publication. |
| `scripts/code-intel/**/*.ts` | 51 .ts (incl. 15 `.test.ts` suites and `test-fixtures.test-helper.ts`) | yes | `ratchet/local-type-assertion-boundary`; tests also use `ratchet/vitest-expect-expect-script-tests`, `ratchet/vitest-valid-expect-script-tests` | ESLint `tsconfig.scripts.json` | none — strict tier already applies; code-intel suites are now co-located with the modules they cover | linted + ratcheted | Leaf 18 split the former root `scripts/code-intel.test.ts` suite and standardized the family on `.test.ts`. |
| `scripts/code-intel-server.ts` | 1 .ts | yes | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none | linted + ratcheted | — |
| `scripts/cli-option-values.ts` | 1 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — shared CLI option-value guard used by logs:audit and harness:audit | linted + ratcheted | Covered through `scripts/logs-audit/logs-audit.test.ts` and `scripts/harness/harness-audit.test.ts` parser cases. |
| `scripts/drift/**/*.ts` | 2 .ts (`locator-usage.ts`, `locator-usage.test.ts`) | yes | normal `local/max-lines` floor (non-test only), `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none | linted + ratcheted | — |
| `scripts/generate-lint-guidance.ts` | 1 .ts | yes | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none | linted + ratcheted | — |
| `scripts/generate-baseline-conflict-recipes.ts`, `generate-baseline-conflict-recipes.test.ts` | 2 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — focused coverage pins driver-recipe extraction and marker splicing | linted + ratcheted | Projects the per-baseline recovery recipe blocks in `docs/guides/lint-ratchet-merges.md` from `scripts/git/baseline-merge-driver.sh`; freshness gated by `docs:baseline-conflict-recipes:check`. |
| `scripts/lib/lint-rule-docs.ts`, `doc-generator.ts`, `doc-generator.test.ts`, `git.ts`, `git.test.ts`, `cli.ts`, `cli.test.ts`, `max-lines-policy.ts`, `max-lines-policy.test.ts`, `atomic-write.ts`, `codepoint-compare.ts`, `eslint-json.ts`, `process-argv.ts`, `verify-metadata-core.ts`, `verify-metadata-core.test.ts` | 15 .ts | yes | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — `atomic-write.ts`, `codepoint-compare.ts`, and `eslint-json.ts` are the scripts-local indirections over the lint-ratchet kernel's utility-contract entries (atomic replacement writer, deterministic codepoint comparator, ESLint JSON parser; lint-arch leaf 14 is the contract home); `process-argv.ts` is the one shared argv-offset constant CLI entry guards slice with (ready leaf 16); `doc-generator.ts` is the shared `--check`/write scaffold for the harness doc generators (`doc-generator.test.ts` pins its check-mode exit-code contract); `git.ts` is the shared git plumbing substrate (injectable `GitRunner`, name-status/merge-base parsers) first adopted by drift-ai's `git-changed-scope.ts`, with `git.test.ts` pinning the parser contracts; `cli.ts` is the shared CLI substrate (spec-driven `parseCli` with typed schema output + the `--format` contract over `cli-option-values.ts`) adopted by logs:audit/harness:audit/drift:triage/drift:ai/code:intel and the backlog/coverage-map/near-duplicates parsers, with `cli.test.ts` pinning the walk, schema, and format contracts; `max-lines-policy.ts` validates Musi's max-lines policy outside the portable lint-ratchet runtime; `verify-metadata-core.ts` is the run-meta JSON codec behind the `verify-metadata.sh` shims (leaf 05), with `verify-metadata-core.test.ts` pinning its committed characterization corpus | linted + ratcheted | — |
| `scripts/lib/fixtures/verify-metadata-core-corpus.json` | 1 .json | yes | none | ESLint | none — committed characterization corpus (legacy-parity + defect-fix expectations) consumed by `verify-metadata-core.test.ts` | linted | — |
| `scripts/lint-ratchet/lint-ratchet-config.ts` | 1 .ts | yes | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — pure config object | linted + ratcheted | — |
| `scripts/lint-ratchet/registry-builders.ts` | 1 .ts | yes | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — typed registry builders keep ratchet family options centralized | linted + ratcheted | — |
| `scripts/eslint-config-shared-policy.d.ts`, `eslint-config-shared-policy.test.ts` | 1 .d.ts + 1 .ts | yes | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — declaration shim for importing JS ESLint policy data from TypeScript scripts; the colocated test parses the declaration and asserts runtime export parity | linted + ratcheted | — |
| `scripts/logs-audit.ts`, `scripts/logs-audit/logs-audit-*.ts`, and `scripts/logs-audit/logs-audit.test.ts` | 7 .ts | yes (`scripts/**/*.ts` default; fixtures excluded) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — normal lint enforces the full rule surface; production files are under the normal max-300 cap | linted + ratcheted | Leaf 03h adopted the whole non-fixture logs-audit family, drained the unbacked `complexity` off and relaxed CLI/test overrides, and deleted `ratchet/local-max-lines-logs-audit`. |
| `scripts/drift-triage/triage-report.ts`, `triage-report-contracts.ts`, `triage-report-drift-input.ts`, `triage-report-input.ts`, `triage-report-summary.ts`, `triage-report-support.ts`, `triage-report-text.ts`, `triage-report-types.ts`, `triage-report.test.ts`, `triage-report-swarm-prep.test.ts`, `triage-packet-types.ts`, `triage-packet-select.ts`, `triage-packet-group.ts`, `triage-packet-staleness.ts`, `triage-packets.ts`, `triage-packets.test.ts`, `triage-verdict-types.ts`, `triage-verdict-input.ts`, `triage-verdict-collect.ts`, `triage-verdict-collect.test.ts`, `triage-verdict-text.ts` | 21 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — focused reducer, packet, and collector coverage pins exact locations, completeness semantics, filtering, deterministic ownership, strict verdict contracts, recovery, and second-pass selection | linted + ratcheted | Runtime parsing accepts only complete drift/advisory reports; swarm packets are post-merge, and verdict collection rejects ownership/canonical conflicts while reporting missing work. |

## Additional Script Families (Default Linted)

All maintained TypeScript rows below are normal-linted by the default
`scripts/**/*.ts` project mapping, with fixture/generated paths excluded.
Additional broad floors that have landed are listed in each row's
`Existing ratchet/floor` cell. The `Proposed rule/tool` column is now reserved
for still-missing broad-shallow floors; deeper rule adoption and drains are
recorded in `Blocker/follow-up` with a `Why:` rationale.

### Generate-Harness-Controls (Leaf 30)

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/harness/generate-harness-controls.ts`, `generate-harness-controls-validation.ts` | 2 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — normal lint enforces the full rule surface, including `complexity` and the max-300 cap | linted + ratcheted | Leaf 03g adopted the family, drained the unbacked `complexity` off and the relaxed CLI options, and deleted `ratchet/local-max-lines-generate-harness-controls` (both files are under the normal cap). |
| `scripts/harness/control-field-validation.ts` | 1 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — shared field validation is under normal lint with the harness-control validators it supports | linted + ratcheted | Shared by `generate-harness-controls-validation.ts` and `harness-check-validation.ts`. |
| `scripts/harness/harness-paths.ts`, `harness-manifest.ts`, `harness-manifest.test.ts` | 3 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — shared harness path constants and manifest loader under normal lint | linted + ratcheted | Leaf modules: `harness-manifest.ts` owns `HARNESS_MANIFEST_FILENAME` and the shared manifest loader (ratchet-portable); `harness-paths.ts` owns the non-portable hook-wiring and generated output-path constants imported by `harness:check`, the generators, and `path-policy`. |
| `scripts/harness/harness-manifest-schema.ts`, `harness-manifest-schema.test.ts`, `manifest-contract-check.ts`, `manifest-contract-check.test.ts` | 4 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — typed manifest contract and its read-seam tripwire under normal lint | linted + ratcheted | Typed-parser phase 1 (ready-row B22): `harness-manifest-schema.ts` is the whole-manifest Zod contract layered above the ratchet-portable leaf reader (which stays Zod-free); `manifest-contract-check.ts` wires the schema plus the no-direct-read tripwire (frozen `MANIFEST_DIRECT_READERS` population) into `harness:check`. |
| `scripts/harness/generate-verify-steps.ts`, `verify-step-bridge-divergences.ts`, `generate-hook-wiring.ts`, `hook-shims.ts`, `hook-shim-files.ts`, `generate-config-surfaces.ts`, `generate-hook-timeout-constants.ts` | 7 .ts | yes | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — focused generator coverage exercises the generated verify-step and freshness shell, hook wiring JSON, hook timeout shell constants, and config-surface `tsconfig.configs.json` output | linted + ratcheted | — |
| `scripts/harness/generate-restricted-disable-rules.ts` | 1 .ts | yes | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — generated restricted-disable rule-id freshness is part of `harness:check` | linted + ratcheted | Generates `eslint-config/ratchet-restricted-disable-rules.generated.js` from `scripts/lint-ratchet/lint-ratchet-config.ts` so the normal-lint inline-disable fence follows the ratchet registry. |
| `scripts/harness/generated-surfaces.ts`, `generated-surfaces.test.ts` | 2 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — Zod-strict `generatedSurface` facet loader (`loadGeneratedSurfaces`), its projections (`renderFreshnessShell`, `renderClassifierFragment`, `renderFixtureManifest`), and the fixture closure diff (`diffFixtureClosure`) under normal lint with a focused vitest suite | linted + ratcheted | Single source for generated harness surfaces (slices S1–S5 landed): every projection — freshness pre-commit shell, ai-hooks classifier slices, smoke-fixture copy manifest — consumes the loader instead of re-reading `harness.controls.json`; `verify:steps:check` holds byte parity and `harness:check` walks the fixture copy closure. |
| `scripts/harness/verify-step-schema.ts`, `hook-wiring-schema.ts` | 2 .ts | yes | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — shared resolver/schema allow-lists are covered by generator and harness-control validation tests | linted + ratcheted | — |
| `scripts/harness/check-skill-inventory.ts`, `skill-tree-comparison.ts`, `skill-inventory-schema.ts`, `check-skill-inventory.test.ts` | 4 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — manifest-backed skill inventory validation and focused overlay tests cover exact mirrors, permitted harness differences, filesystem-discovered targets, metadata, gitignore opt-ins, and smoke ownership | linted + ratcheted | — |
| `scripts/harness/generate-verify-steps.test.ts`, `generate-hook-wiring.test.ts`, `hook-shims.test.ts`, `hook-shim-files.test.ts`, `generate-config-surfaces.test.ts`, `generate-hook-timeout-constants.test.ts` | 6 .ts | yes | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — focused Vitest coverage exercises generated command arrays, dynamic resolver and freshness metadata, hook wiring output, hook timeout constants, and config-surface tsconfig rendering | linted + ratcheted | — |
| `scripts/harness/control-field-validation.test.ts`, `fixture-closure-check.test.ts`, `harness-check-validation.test.ts` | 3 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — focused Vitest coverage exercises the shared field validation rules, the script-parity message remedy text, and the fixture copy-closure orchestration (fail-closed no-declaration path, regular-file rejection, missing/stale diffs) over temp repos | linted + ratcheted | — |

### Drift-AI Coverage

The root entrypoint and root integration test stay hand-maintained because they
are siblings of the generated directory scope. Direct-child maintained
TypeScript under `scripts/drift-ai/` is generated from tracked files, proven
ESLint reach, and live ratchet membership. Nested fixtures stay excluded and
hand-maintained below.

The family retains its deliberate CLI reporting policy in
`eslint-config/script-configs.js` (`allowNumber` template interpolation,
`max-params` 6, and `no-magic-numbers` off). Normal lint holds the former
complexity and max-lines floors; the two test-only Vitest ratchets remain
intentional option-pinning floors.

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/drift-ai.ts` | 1 .ts (entrypoint) | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — normal lint enforces the family floors | linted + ratcheted | Deeper follow-up: Leaf 40 normal-lint adoption can still drain `simple-import-sort/imports`. Why: normal lint already enforces the max-lines and complexity floors. |
| `scripts/drift-ai.test.ts` | 1 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary`, `ratchet/vitest-expect-expect-drift-ai-tests`, `ratchet/vitest-valid-expect-drift-ai-tests` | ESLint `tsconfig.scripts.json` | none - bug-class rules now floored | linted + ratcheted | — |
| `scripts/test-support/tmp-repo.test-helper.ts` | 1 .ts (shared scripts tmp-repo scaffold: registerTempRootCleanup + writeRepo/makeTempRepo/writeRepoFile/makeTmpGitRepo) | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none | linted + ratcheted | tsa-32 extracted the per-file tmp-dir/git-repo scaffold; adopted incrementally across scripts test files. |
| `scripts/benchmark-near-duplicates.ts`, `benchmark-near-duplicates-core.ts`, and `benchmark-near-duplicates.test.ts` | 3 .ts (reproducible exact-tier wall/RSS benchmark and statistics) | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — focused benchmark statistics tests plus live fuzzy/exact worker audit | linted + ratcheted | Runs five fresh and five immediate-repeat processes per state, samples recursive process-tree RSS every 25 ms, and reports retain-the-slot timing plus exact bucket/baseline-growth evidence. |

<!-- BEGIN generated: lint-coverage-map drift-ai -->
| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/drift-ai/*.ts` | 340 .ts | yes | `ratchet/local-no-commented-out-code` (340/340 files); `ratchet/local-no-swallowed-errors-broader-semantics` (340/340 files); `ratchet/local-type-assertion-boundary` (340/340 files); `ratchet/no-direct-git-exec-scripts` (340/340 files); `ratchet/vitest-expect-expect-drift-ai-tests` (102/340 files); `ratchet/vitest-valid-expect-drift-ai-tests` (102/340 files) | ESLint via `tsconfig.scripts.json` | none — derived from tracked files, ESLint reach, and ratchet membership | linted + ratcheted | — |
<!-- END generated: lint-coverage-map drift-ai -->

Fixture and documentation ownership remains hand-maintained:

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/drift-ai/fixtures/jscpd-report.basic.json`, `knip-report.unused-exports.json`, `knip-report.duplicates.json` | 3 .json | no (JSON lint ignores via `scripts/**/*`) | none | — | `excluded` — fixtures (`knip-report.unused-exports.json` and `knip-report.duplicates.json` are captured verbatim from knip 6.14.1 JSON reporter output for the relevant categories) | excluded | — |
| `scripts/drift-ai/fixtures/unused-exports/knip-report.json` | 1 .json | no (JSON lint ignores via `scripts/**/*`) | none | — | `excluded` — synthetic knip `--reporter json` fixture (task 42b) whose `exports` reference the `fixtures/coverage/**` source paths, consumed by `coverage-unused-correlation-command.test.ts`; never live code | excluded | — |
| `scripts/drift-ai/fixtures/report-contract.*.json` | 4 .json (`clean`, `clean.with-scope`, `findings`, `findings.with-scope`) | no (JSON lint ignores via `scripts/**/*`) | none | — | `excluded` — golden portable `--format json` report contract fixtures (drift-ai next-items task 53), byte-compared by `report-contract.test.ts`; never live code | excluded | — |
| `scripts/drift-ai/fixtures/dolos-report/*.csv` | 3 .csv | no | none | — | `excluded` — Dolos clone-report CSV fixtures consumed by drift-ai tests; never live code | excluded | — |
| `scripts/drift-ai/fixtures/clone-corpus/**` | 8 .ts + 1 .json (labeled clone-detection benchmark corpus, drift-ai next-items task 40) | no (targeted `scripts/drift-ai/fixtures/**` ignore, matching `tsconfig.scripts.json` and knip project-graph exclusions) | none | — | `excluded` — synthesized labeled clone/non-clone fixtures plus the machine-readable `labels.json`, consumed by `clone-corpus.test.ts`; never live code | excluded | Engine-agnostic ground truth for comparing clone engines before promotion (tasks 41a/41/41b/41c). |
| `scripts/drift-ai/fixtures/near-duplicate-gate/*.ts` | 3 .ts (two admitted functions plus one synthetic changed-file clone) | no (targeted `scripts/drift-ai/fixtures/**` ignore, matching `tsconfig.scripts.json`) | none | — | `excluded` — executable-looking detector inputs consumed as text by `near-duplicates.test.ts`; never live code | excluded | Pins the changed-file no-new gate and committed-baseline behavior. |
| `scripts/drift-ai/fixtures/near-duplicates-v2/**` | 6 .ts + 1 .json (C3 exact-function, repeated-block, and precision-trap corpus) | no (targeted `scripts/drift-ai/fixtures/**` ignore, matching `tsconfig.scripts.json`) | none | — | `excluded` — executable-looking detector inputs and manifest consumed by focused clone-tier tests; never live code | excluded | Pins the calibrated jscpd eight-statement advisory acceptance and exact-token/tier precision boundaries. |
| `scripts/drift-ai/fixtures/dead-code-corpus/**` | 12 .ts + 1 .tsx + 1 .json (labeled dead-code false-positive trap corpus, drift-ai next-items task 40b) | no (targeted `scripts/drift-ai/fixtures/**` ignore, matching `tsconfig.scripts.json`) | none | — | `excluded` — synthetic barrel, dynamic-import, test-only, framework-entrypoint, reflection/string-keyed, and known-unused fixtures plus machine-readable labels, consumed by `dead-code-corpus.test.ts`; never live code | excluded | Ground truth for calibrating coverage/reachability, sibling naming, and class-construction prototype rows before promotion (tasks 42b, 47a/47, 48a/48). |
| `scripts/drift-ai/fixtures/semgrep/**` | 2 .json + 1 .yml (real Semgrep scan capture, a synthetic metadata-rich variant, and the smoke rule that produced the capture; semgrep plan slices 0 and 2) | no (the drift-ai fixtures dir is re-excluded in `eslint.config.js`; the `.yml` is outside the maintained YAML config surfaces) | none | — | `excluded` — path-sanitized Semgrep 1.165.0 logged-out `--json` capture over `scripts/drift-ai`, the capture-shaped `scan-output.synthetic-rich.json` (rich rule metadata, `errors[]`, `skipped_rules`), and the first-party throwaway rule; consumed by `semgrep-output.test.ts` / `semgrep-runner.test.ts`, never live code | excluded | Reproduction commands live in `docs/agent_notes/backlog/semgrep-drift-ai-implementation-plan.md` (slice 0); the engine venv under `.tools/` is per-checkout and gitignored. |
| `scripts/drift-ai/README.md` | 1 .md | no (`docs:lint-coverage-map` treats Markdown as docs) | none | — | `not-code` — portable tools-checkout contract doc that travels with the tool | not-code | — |
| `scripts/drift-ai/docs/*.md` | 3 .md | no (`docs:lint-coverage-map` treats Markdown as docs) | none | — | `not-code` — focused prototype-lane docs split out of the portable README | not-code | — |

### Codemods (Leaves 35–37)

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/codemods/concurrency-guard.ts` and `scripts/codemods/concurrency-guard/*.ts` | 10 .ts (facade and split helpers) | yes (`scripts/**/*.ts` default; fixtures excluded) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` via the shared script project config | none — normal lint now enforces the codemod source complexity and max-lines floors | linted + ratcheted | Leaf 03i adopted sources; Leaf 03j adopted the codemod tests. |
| `scripts/codemods/structured-logging-fix.ts`, `structured-logging-fix-transforms.ts`, and `structured-logging-fix-ast.ts` | 3 .ts | yes (`scripts/**/*.ts` default; fixtures excluded) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` via the shared script project config | none — normal lint now enforces the codemod source complexity and max-lines floors | linted + ratcheted | Leaf 03i adopted sources; Leaf 03j adopted the codemod tests. |
| `scripts/codemods/expand-barrel.ts` and `scripts/codemods/expand-barrel/*.ts` | 13 .ts (facade and split helpers) | yes (`scripts/**/*.ts` default; fixtures excluded) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` via the shared script project config | none — normal lint now enforces the codemod source complexity and max-lines floors | linted + ratcheted | Leaf 03i adopted sources; Leaf 03j adopted the codemod tests. |
| `scripts/codemods/trpc-shared-input.ts`, `trpc-shared-input-candidates.ts`, `trpc-shared-output.ts`, `trpc-shared-output-candidates.ts` | 4 .ts | yes (`scripts/**/*.ts` default; fixtures excluded) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` via the shared script project config | none — normal lint now enforces the codemod source complexity and max-lines floors | linted + ratcheted | Leaf 03i adopted sources; Leaf 03j adopted the codemod tests. |
| `scripts/codemods/lib/trpc-shared-schema*.ts`, `trpc-shared-engine.ts`, `trpc-shared-engine-args.ts`, `trpc-shared-engine-types.ts` | 11 .ts (shared codemod helper facade and split helpers plus the input/output codemod engine, its CLI arg parser, and its config types) | yes (`scripts/**/*.ts` default; fixtures excluded) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` via the shared script project config | none — normal lint now enforces the codemod source complexity and max-lines floors | linted + ratcheted | Leaf 03i adopted sources; Leaf 03j adopted the codemod tests; drift-ai finding 8 extracted the shared input/output engine. |
| `scripts/codemods/lib/walk-ts-files.ts` and `scripts/codemods/lib/walk-ts-files.test.ts` | 2 .ts (shared recursive .ts directory walker and its unit test) | yes (`scripts/**/*.ts` default; fixtures excluded) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` via the shared script project config | none — normal lint now enforces the codemod source complexity and max-lines floors | linted + ratcheted | drift-ai finding 19 extracted the shared walker from the four codemod path modules. |
| `scripts/codemods/concurrency-guard.test.ts`, `expand-barrel.test.ts`, `structured-logging-fix.test.ts`, `trpc-shared-schema-codemod.test.ts`, and `scripts/codemods/lib/fixture-runner.test-helper.ts` | 5 .ts (test harness + shared fixture-runner helper) | yes (`scripts/**/*.ts` default; fixtures excluded) | `ratchet/local-type-assertion-boundary`; normal ESLint enforces `@typescript-eslint/no-misused-promises`, `@typescript-eslint/only-throw-error`, `vitest/expect-expect`, and `vitest/valid-expect` | ESLint `tsconfig.scripts.json` via the shared script project config | none — bug-class rules now live in normal lint | linted + ratcheted | Leaf 03j adopted codemod tests and deleted the four zero codemod-test ratchets; tsa-31 extracted the shared fixture-runner scaffold. |
| `scripts/codemods/tsconfig.json` | 1 .json | yes (jsonc track) | none | `@eslint/json` | none — parser-project config is linted as JSONC, not TypeScript source | linted | — |
| `scripts/codemods/fixtures/**/*` | ~390 mixed .ts/.json | no | none | — | `excluded` — synthesized before/after test inputs, not live code | excluded | Targeted `scripts/codemods/fixtures/**` ignore keeps these snapshots out of ESLint and ratchets. |

### Top-Level Scripts Outside `tsconfig.scripts.json` (Leaf 38)

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/db-status.ts` | 1 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` (also named in `eslint.config.js` `no-restricted-syntax` allowlist for the `process.env` and `process.exit` carve-outs) | ESLint via `tsconfig.scripts.json` parser override | none — top-level-scripts ratchets drained in lint-review-2026-06 leaf 03a; normal lint pins `restrict-template-expressions` `allowNumber: false` | linted + ratcheted | — |
| `scripts/harness-emit-envelope.ts` | 1 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — top-level-scripts ratchets drained in lint-review-2026-06 leaf 03a; normal lint pins `restrict-template-expressions` `allowNumber: false` | linted + ratcheted | — |
| `scripts/sensor-blob-size.ts` | 1 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — top-level-scripts ratchets drained in lint-review-2026-06 leaf 03a; normal lint pins `restrict-template-expressions` `allowNumber: false` | linted + ratcheted | — |
| `scripts/sensor-blob-size.test.ts` | 1 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — top-level-scripts ratchets drained in lint-review-2026-06 leaf 03a; normal lint pins `restrict-template-expressions` `allowNumber: false` | linted + ratcheted | — |
| `scripts/sensor-context-budget.ts` | 1 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — top-level-scripts ratchets drained in lint-review-2026-06 leaf 03a; normal lint pins `restrict-template-expressions` `allowNumber: false` | linted + ratcheted | — |
| `scripts/sensor-context-budget.test.ts` | 1 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — top-level-scripts ratchets drained in lint-review-2026-06 leaf 03a; normal lint pins `restrict-template-expressions` `allowNumber: false` | linted + ratcheted | — |
| `scripts/mutation-survivors.ts`, `mutation-survivors.test.ts`, `scripts/lib/mutation-survivors-summary.ts` | 3 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — top-level-scripts ratchets drained in lint-review-2026-06 leaf 03a; normal lint pins `restrict-template-expressions` `allowNumber: false` | linted + ratcheted | — |
| `scripts/sensor-knip-unused-exports.ts`, `sensor-knip-unused-exports-core.ts`, `sensor-knip-unused-exports-baseline.ts`, `sensor-knip-unused-exports.test.ts`, `sensor-knip-unused-exports-merge-cli.ts`, and `sensor-knip-unused-exports-merge-cli.test.ts` | 6 .ts (knip unused-export identity floor CLI, identity spec/collector/gate on the baseline framework, runner integration, semantic merge CLI, and focused tests) | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — normal script lint plus the committed identity baseline cover the promoted sensor surface | linted + ratcheted | Leaf 39 promoted only the knip unused-export floor; arch-review leaf 12 slice 1 migrated it to the identity ledger. Raw knip and duplicate/jscpd reports remain advisory. |
| `scripts/sensor-near-duplicates.ts`, `sensor-near-duplicates-core.ts`, `sensor-near-duplicates-cli-options.ts`, `sensor-near-duplicates-cli-options.test.ts`, `sensor-near-duplicates-baseline.ts`, `sensor-near-duplicates-baseline-gate.ts`, `sensor-near-duplicates-baseline-io.ts`, `sensor-near-duplicates-merge-cli.ts`, and `sensor-near-duplicates-merge-cli.test.ts` | 9 .ts (changed-file near-clone gate, reasoned admission CLI plus its parser characterization tests, HEAD-anchored shrink-only pair-identity baseline, semantic merge CLI, and focused merge coverage) | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary`; merge test also uses the script-test Vitest floors | ESLint via `tsconfig.scripts.json` parser override | none — normal script lint plus the fixture-backed gate test and committed identity baseline cover the promoted sensor | linted + ratcheted | Lint-adoption leaf 10 promotes only pairs touching staged files; the whole-repo `drift:ai --check near-duplicates` report remains advisory. |
| `scripts/baseline-merge-cli-table.ts` and `baseline-merge-cli-table.test.ts` | 2 .ts (merge-CLI data table + derivation wrapper, with focused table coverage) | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — the table test pins the derived usage/failure strings byte-for-byte against the pre-collapse wrappers, wrapper-path existence, and lockstep with the `baseline-merge-driver.sh` dispatch registry | linted + ratcheted | Ready-2026-07 leaf 16: one data table + one derivation wrapper behind the four path-stable baseline semantic-merge CLIs; merge bindings stay in the per-CLI wrappers so each merge driver keeps its own runtime import closure. |
| `scripts/lib/baseline/single-group-spec.test.ts` | 1 .ts (adapter test for the moved `single-group-spec` kernel exercised over the three Musi sensor baseline specs; kept in `scripts` because it imports those sensor specs) | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — normal script lint covers it | linted + ratcheted | Source `single-group-spec.ts` moved to `@musi/lint-ratchet/kernel` (leaf 02 S3); this sensor-spec test stays adapter-side. |
| `scripts/max-lines-exceptions.ts`, `max-lines-exceptions-core.ts`, `max-lines-effective-lines.ts`, `max-lines-exceptions.test.ts`, `max-lines-exceptions-merge-cli.ts`, and `max-lines-exceptions-merge-cli.test.ts` | 6 .ts (max-lines per-file cap exceptions baseline on the framework: spec/format/count-aware gate + `--check`/`--update` CLI, effective-line audit through the ESLint rule, semantic merge CLI, and focused tests) | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — normal script lint plus the committed exceptions baseline cover the surface | linted + ratcheted | arch-review leaf 12 slice 2 moved `maxLinesPolicy.exceptions` out of `eslint-config/shared-policy.js` into `eslint-config/max-lines-exceptions.baseline.json`; shared-policy.js reads it fail-loud. |
| `scripts/git/baseline-info-attributes.ts` | 1 .ts (thin CLI wrapper for the .git/info/attributes managed-block renderer; reads/writes files and delegates to the package op) | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — normal script lint covers it | linted + ratcheted | lint-arch-review leaf 04 moved the attributes block-rewriting from the merge-driver lib's awk into TypeScript; leaf 02 S4 moved the pure renderer + its unit test into `@musi/lint-ratchet/git-rail/info-attributes`, leaving this wrapper (and the installed drivers' invoked path) in place. |
| `scripts/data/eslint-disable-broad-allowlist.txt`, `ts-nocheck-allowlist.txt` | 2 .txt | no | none | — | `excluded` — line-based suppression waiver inventories consumed fail-loud by their register scripts | excluded | Changes trigger full suppression-register scans so allowlist shrinkage checks unchanged source files. |
| `scripts/devcontainer-env-example.test.ts` | 1 .ts (guards `.devcontainer/.env.example` JWT_SECRET length against `env.ts` `MIN_JWT_SECRET_LENGTH`) | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — normal lint covers this top-level scripts test; no new ratchet entries needed | linted + ratcheted | Codebase-audit leaf 02; pairs the devcontainer template with the enforced minimum so they cannot silently diverge. |

### Ratchet/Harness Runtime Scripts (lint-review leaves 03d2/03g)

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/lint-ratchet.ts`, `lint-ratchet.entry.test.ts` | 2 .ts (ratchet runner CLI + entry classification test) | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — lint-review leaf 03d2 adopted the runtime under normal lint and retired the zero complexity floor | linted + ratcheted | — |
| `scripts/lint-ratchet/*.ts` | 33 .ts (the Musi adapter runtime, registry, CLI, harness wiring, and the binding/integration adapter tests kept alongside; the portable engine moved to `@musi/lint-ratchet`, and leaf 12 re-homed the engine-owned governance/kernel tests into the package) | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — lint-review leaf 03d2 adopted helper modules under normal lint | linted + ratcheted | — |
| `scripts/lint-ratchet/output.ts` | 1 .ts (diagnostics output helper) | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — lint-review leaf 03d2 adopted the runtime helper under normal lint | linted + ratcheted | — |
| `scripts/harness/harness-diagnostics-output.ts` | 1 .ts (sidecar-only `HARNESS_DIAGNOSTICS_OUTPUT` writer shared by drift:ai/logs:audit) | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none - small sidecar-only writer sibling of `output.ts` | linted + ratcheted | Its `process.env` read is on the process-primitive allowlist: this module IS the `HARNESS_DIAGNOSTICS_OUTPUT` boundary every producer shares. |
| `scripts/lint-ratchet/check-registry.ts` | 1 .ts (registry preflight helper) | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — lint-review leaf 03d2 adopted the helper under normal lint | linted + ratcheted | — |
| `scripts/lint-ratchet/ratchet-manifest-message.ts` | 1 .ts (shared missing-ratchet manifest formatter) | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — runtime complexity and max-lines now belong to normal lint | linted + ratcheted | — |
| `scripts/lint-ratchet/report.ts` | 1 .ts (diagnostics markdown formatter) | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — lint-review leaf 03d2 adopted the helper under normal lint | linted + ratcheted | — |
| `scripts/lint-ratchet/baseline.test.ts` | 1 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary`, `ratchet/vitest-expect-expect-script-tests`, `ratchet/vitest-valid-expect-script-tests` | ESLint via `tsconfig.scripts.json` parser override | none — normal lint plus the remaining vitest option-pinning ratchets are in place | linted + ratcheted | Leaf 03b promoted the explicit-return and regexp backtracking singleton floors into normal ESLint. Leaf 12 split the engine-semantics suites into `tools/lint-ratchet/src/kernel/baseline.test.ts`; this file keeps the Musi-bound suites (envelope rendering, production structure ratchets, committed-baseline round-trips, check-baseline assertions). |
| `scripts/lint-ratchet/check-registry.test.ts` | 1 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — focused Vitest coverage exercises the registry preflight helper | linted + ratcheted | — |
| `scripts/lint-ratchet/output.test.ts` | 1 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — subprocess smoke covers the behavior in `test:scripts` | linted + ratcheted | — |
| `scripts/harness/harness-diagnostics-output.test.ts` | 1 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none - focused Vitest coverage exercises the sidecar writer's unset/empty/valid/invalid/dir-creation/write-failure behavior | linted + ratcheted | — |
| `scripts/lint-ratchet/report.test.ts` | 1 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — focused Vitest coverage exercises the report formatter | linted + ratcheted | — |
| `scripts/lint-agent.ts`, `scripts/lint-agent-envelope.ts`, `scripts/lint-agent-envelope.test.ts`, `scripts/lint-agent-fix-text.ts`, `scripts/lint-agent-guidance.ts` | 5 .ts (machine-readable lint slice from PR 3a, importable envelope projection, focused unit coverage, fix-text projection helper, and checked non-local guidance overlays) | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — normal lint enforces the full rule surface; envelope tests pin parser-error, repair-command, CLI argument, ordering, overlay, and pass-through contracts | linted + ratcheted | Leaf 03g adopted the original runtime files, drained the unbacked `complexity` off and the relaxed CLI options, and deleted `ratchet/local-max-lines-runtime`; production files remain under the normal cap. |
| `scripts/harness-check.ts`, `scripts/harness/harness-check-validation.ts`, `fixture-closure-check.ts`, `harness-gate-parity.ts`, `hook-timeout-constants.ts`, `local-rule-config.ts`, `porting-knob-parity.ts`, `porting-knob-parity.test.ts`, `pre-push-scope-pin.ts`, and `pre-push-scope-pin.test.ts` | 10 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — normal lint enforces the full rule surface, including the max-300 cap | linted + ratcheted | Leaf 03g drained the unbacked `complexity` and stale `regexp/no-unused-capturing-group` offs; `ratchet/local-max-lines-runtime` is deleted. `local-rule-config.ts` keeps the flat-config local-rule registration/enabled-rule discovery out of the harness-check entrypoint; `harness-gate-parity.ts` owns manifest-backed package-script exemptions and CI gate identity/invocation parity; `porting-knob-parity.ts` keeps the Porting This checklist aligned with greppable source markers; `pre-push-scope-pin.ts` pins the `.husky/pre-push` near-duplicates trigger alternation to the scanner's source-extension set. |
| `scripts/lint-coverage-map-check{,-eslint-reach,-findings,-io,-patterns,-row-consistency,-suggest,-types}.ts` | 8 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — leaf 03c split the checker below the normal max-lines cap and retired its singleton rule floors | linted + ratcheted | Keep this helper family covered by normal lint with the CLI entrypoint row; future growth should split by concern instead of restoring per-file suppressions. `-suggest` builds the `--suggest` scaffold rows (A1/A6); `-row-consistency` holds the A4/A5 Normal-lint and ratchet-membership checks. |
| `scripts/lint-coverage-map-check.test.ts`, `lint-coverage-map-check-suggest.test.ts` | 2 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary`, `ratchet/vitest-expect-expect-script-tests`, `ratchet/vitest-valid-expect-script-tests` | ESLint via `tsconfig.scripts.json` parser override | none — normal lint plus bounded-debt ratchets are in place | linted + ratcheted | Leaf 41g closed the broad-shallow blocker. No new current findings were found; future work is normal drain/deeper-rule work, not broad-shallow coverage. |
| `scripts/lint-coverage-map-gen.ts`, `lint-coverage-map-gen-core.ts`, `lint-coverage-map-gen-core.test.ts` | 3 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — focused derivation and marker-splice coverage pins the generated drift-ai row contract | linted + ratcheted | Pure core for the lint coverage-map generator; the generated block and CLI registration land with the harness gate. |
| `scripts/path-policy/path-policy.ts`, `path-policy-smoke-subjects.ts`, `path-policy-smoke-subjects-data.ts`, `path-policy-query*.ts`, `path-policy.test.ts`, `generate-smoke-subjects.ts`, `smoke-subject-headers.ts`, `smoke-subject-headers.test.ts`, `fixture-helper-calls.ts`, `fixture-helper-calls.test.ts`, `fixture-shell-dependencies.ts`, `fixture-shell-dependencies.test.ts`, `fixture-shell-scope.ts` | 15 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | `path-policy-smoke-subjects-data.ts` carries a `maxLinesPolicy.exceptions` cap (generated lookup table); the rest are under normal lint | linted + ratcheted | Lint reference-readiness tasks 14 and 15 added the shared path-policy data model and NUL-safe shell query interface without migrating production callers. Agent-friction F1 split the flat `SCRIPT_SMOKE_SUBJECTS` table into the side-effect-free `*-data.ts` sibling so the fs-backed discovery logic stays under the max-lines floor. Leaf 42 generates smoke-subject data and the all-smokes fixture from smoke-file headers. The fixture closure checker protects literal copied shell dependencies and smoke metadata for every hand-written smoke copy set, following helper-call fixture composition (ready-row B5). |

### Largest Remaining Entrypoints/Tests (Leaf 40)

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/logs-audit/fixtures/business-events-server.jsonl`, `redacted-server.jsonl` | 2 .jsonl | no | none | — | `excluded` — fixture | excluded | — |
| `scripts/harness-audit.ts`, `scripts/harness/harness-audit-report.ts` | 2 .ts (the `harness:audit` diagnostics fusion CLI plus its report assembly/rendering split) | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — normal lint enforces the full rule surface, including the max-300 cap | linted + ratcheted | Leaf 03g adopted the entrypoint and split report building into `harness-audit-report.ts` to satisfy the normal max-lines cap; the CLI re-exports the report surface. |
| `scripts/harness/harness-audit.test.ts` | 1 .ts | yes (`scripts/**/*.ts` default) | `ratchet/local-type-assertion-boundary` | ESLint via `tsconfig.scripts.json` parser override | none — focused Vitest coverage exercises the diagnostics fusion consumer | linted + ratcheted | — |

### Other Script Fixtures (Always Excluded)

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/fixtures/lint-ratchet-report/lint-ratchet-report-clean.json` | 1 .json | no | none | — | `excluded` — fixture diagnostics envelope used by the report smoke | excluded | — |
| `scripts/fixtures/lint-ratchet-report/lint-ratchet-report-regression.json` | 1 .json | no | none | — | `excluded` — fixture diagnostics envelope used by the report smoke | excluded | — |
| `scripts/harness-audit/fixtures/*.json` | 5 .json | no | none | — | `excluded` — `harness:audit` envelope fixtures (real `lint:ratchet`/`logs:audit` shapes plus `drift:ai` projections) consumed by `harness-audit.test.ts` | excluded | — |
| `scripts/fixtures/lint-ratchet/expected-*.config.mjs` | 1 .mjs | no (targeted `scripts/fixtures/**` ignore; also matches `**/*.config.*`) | none | — | `excluded` — expected-generated-config snapshot used by `test-lint-ratchet.sh` | excluded | — |
| `tools/lint-ratchet/src/kernel/fixtures/message-identity-golden.json` | 1 .json | yes (`tools/lint-ratchet/**` reach block) | none | `@eslint/json` structural lint | live message-identity golden corpus imported by the package's `message-identity.test.ts` | linted | Moved with the kernel in leaf 02 S3. |
| `scripts/fixtures/lint-message-eval/2026-07-15-codex-pilot.json` | 1 .json | no (targeted `scripts/fixtures/**` ignore) | none | — | `excluded` — committed treatment/control agent-response trace replayed by `eval:lint-messages` | excluded | See `docs/guides/lint-message-evals.md` for the capture protocol and sampling caveat. |
| `scripts/fixtures/generate-harness-controls/expected.md`, `scripts/fixtures/generate-lint-guidance/expected.md` | 2 .md | no | none | — | `excluded` — expected-output snapshots | excluded | — |
| `scripts/fixtures/generate-verify-steps/manifest.json` | 1 .json | no | none | JSON fixture consumed by Vitest | `excluded` — fixture manifest | excluded | Fixture manifest for `scripts/generate-verify-steps.test.ts`; intentionally outside JSON lint because `scripts/fixtures/**` is ignored. |
| `scripts/fixtures/generate-verify-steps/expected.generated.sh` | 1 .sh | yes (`bun run lint:shell`) | ShellCheck floor | system `shellcheck` | none | linted | Expected generated shell snapshot for `scripts/generate-verify-steps.test.ts`; remains ShellCheck-compatible because `lint-shell.sh` discovers `scripts/**/*.sh`. |
| `scripts/harness-audit/fixtures/malformed-not-json.txt` | 1 .txt | no | none | — | `excluded` — malformed diagnostics fixture used by `harness-audit.test.ts` parser-hardening coverage | excluded | — |
| `scripts/fixtures/test-scripts/all-smoke-tests.txt` | 1 .txt | no | none | — | `excluded` — generated all-smokes fixture consumed by `scripts/tests/test-test-scripts.sh` | excluded | — |
| `scripts/tests/harness-check-fixture-manifest.generated.txt` | 1 .txt | no | none | — | `excluded` — generated fixture copy manifest (rendered from `harness.controls.json` `generatedSurface.fixturePaths` by `bun run verify:steps`) consumed by `scripts/tests/test-harness-check.sh` | excluded | — |

## Local ESLint Rules

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `eslint-rules/{all-local-rules,ast-helpers,bad-comparison-sequence,bad-min-max-func,binding-resolution,concurrency-guard,e2e-prefer-role-selectors,effect-misuse-execution,effect-misuse-trpc-provenance,eslint-config-resolution-timeout,max-lines,missing-throw,no-arbitrary-tailwind-value,no-async-array-callbacks,no-barrel,no-broadcast-in-transaction,no-commented-out-code,no-effect-misuse,no-explicit-any,no-incorrect-sort,no-llm-artifacts,no-outer-client-in-transaction,no-plain-error-in-trpc,no-redundant-central-mock,no-swallowed-errors,no-swallowed-errors-paths,no-unbounded-promise-all,rule-tester,shared-schema-prefix,socket-listener-cleanup,socket-registry-broadcasts,strict-shared-schemas,strict-trpc-input,structured-logging,test-file-location,trpc-require-output-schema,trpc-shared-input-schema,trpc-shared-output-schema,trpc-shared-schema-import-collector,type-assertion-boundary,uninvoked-array-callback}.js` (rule implementations + shared helpers) | 41 .js (31 rules registered in `eslint.config.js` + the `ast-helpers` utilities shared across local rules + the `binding-resolution` helper shared by binding-aware local rules + the no-swallowed-errors path-analysis helper + the effect-misuse execution and tRPC-provenance helpers + the shared-schema prefix and import-collector helpers used by the twin tRPC schema rules and codemods + the `eslint-config-resolution-timeout` shared hang-guard timeout for the real-ESLint config-resolution test suites + the `all-local-rules` shared rule-list module consumed by the meta-contract and registry-completeness suites + the `rule-tester` shared RuleTester factory adopted by the rule test files) | yes | none | ESLint recommended JS + explicit `no-unused-vars` + non-type-aware syntactic strict-tier / regexp floor; Phase A.3 adds `simple-import-sort`, `eslint-comments` hygiene, and generic `local/*`; scoped `eslint-plugin-jsdoc` starter floor adds JSDoc syntax/name/type checks without requiring prose or new blocks. | Domain/path-specific local rules and type-aware `local/no-explicit-any` / `local/no-barrel` remain deferred as non-broad-shallow. Deeper JSDoc floors such as `require-jsdoc`, descriptions, and broad return requirements remain intentionally off to avoid mass rewrites. | linted | Leaf 03k promoted the zero complexity, no-magic-numbers, and regexp ratchet floors into normal ESLint and deleted the ratchets. |
| `eslint-rules/*.test.js` (rule tests) | 44 .js | yes | none | ESLint recommended JS + explicit `no-unused-vars` + Vitest recommended floor; no project service | none — Phase B landed and Leaf 03k promoted the remaining zero RuleTester floors into normal ESLint | linted | Leaf 03k deleted the no-commented-out-tests and no-conditional-expect ratchets after removing stale per-file suppressions. |

## Shell Scripts And Git Hooks

Leaf 41b landed a ShellCheck floor for all maintained shell scripts and hooks.
`bun run lint:shell` checks the full maintained set, and `bun run lint` /
`bun run lint:changed` include the same floor through `scripts/lint-shell.sh`
and `scripts/lint-changed.sh`. ShellCheck resolves through the system
`shellcheck` binary on `PATH` (install with your system package manager:
`dnf`/`apt`/`brew`; this container reports `/usr/bin/shellcheck` 0.9.0), enables
`--external-sources`, and enforces `--severity=info` (so pattern-safety checks
like SC2295 gate) with reviewed-noise info codes excluded
(SC1091/SC2015/SC2016/SC2030/SC2031/SC2317; see `scripts/lint-shell.sh`) while
preserving shebang-based shell dialect detection.

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/**/*.sh` (top-level verify, smoke tests, worktree-*, db, doctor, land, shared shell libs, etc.; excludes the ai-hooks row below) | 59 .sh | yes (`bun run lint:shell`) | ShellCheck floor | system `shellcheck` (install via `dnf`/`apt`/`brew`; 0.9.0 in this container) | none | linted | Leaf 41b landed; smoke: `scripts/tests/test-lint-shell.sh`; `scripts/lib/gate-env.sh` owns local/CI gate heap defaults. |
| `scripts/ai-hooks/*.sh` (agent hook implementations) | 12 .sh | yes (`bun run lint:shell`) | ShellCheck floor | system `shellcheck` (install via `dnf`/`apt`/`brew`; 0.9.0 in this container) | none | linted | Leaf 41b landed |
| `scripts/ai-hooks/README.md` | 1 .md | no | none | n/a | `excluded` — implementation reference, not executable code | excluded | Paired with `docs/ai-harness.md`; the doc-length advisory does not cover this file (not in the policy's file list). |
| `.claude/hooks/*.sh` (Claude Code hooks) | 7 .sh | yes (`bun run lint:shell`) | ShellCheck floor | system `shellcheck` (install via `dnf`/`apt`/`brew`; 0.9.0 in this container) | none | linted | Leaf 41b landed; changed-gate relevant |
| `.claude/skills/**/*.sh` (skill helper scripts, e.g. the agent-cli dispatch wrapper) | 1 .sh | yes (`bun run lint:shell`) | ShellCheck floor | system `shellcheck` (install via `dnf`/`apt`/`brew`; 0.9.0 in this container) | none | linted | changed-gate relevant |
| `.codex/hooks/*.sh` (Codex hooks) | 3 .sh | yes (`bun run lint:shell`) | ShellCheck floor | system `shellcheck` (install via `dnf`/`apt`/`brew`; 0.9.0 in this container) | none | linted | Leaf 41b landed; changed-gate relevant |
| `.copilot/hooks/*.sh` (Copilot hooks) | 9 .sh | yes (`bun run lint:shell`) | ShellCheck floor | system `shellcheck` (install via `dnf`/`apt`/`brew`; 0.9.0 in this container) | none | linted | changed-gate relevant |
| `.devcontainer/container-entrypoint.sh`, `start-servers.sh`, `post-create.sh` | 3 .sh | yes (`bun run lint:shell`) | ShellCheck floor | system `shellcheck` (install via `dnf`/`apt`/`brew`; 0.9.0 in this container) | none | linted | Leaf 41b landed; changed-gate relevant |
| `.husky/{pre-commit,pre-push,post-commit,post-checkout,post-merge,commit-msg}` | 6 (extensionless shell, with `#!/bin/bash` or `#!/usr/bin/env bash` shebangs) | yes (`bun run lint:shell`) | ShellCheck floor | system `shellcheck` (install via `dnf`/`apt`/`brew`; 0.9.0 in this container) | none | linted | Leaf 41b landed; `pre-push` adds the fast-commit full-verify backstop from harness-review leaf 57, with `post-commit` recording fast-commit provenance after Git creates the commit SHA. |
| `init-test-db.sql`, `.devcontainer/init-test-db.sql` | 2 .sql | no | none | — | `excluded` — bootstrap SQL, not maintained as live ESLint surface | excluded | — |

## Workflows And Agent/Devcontainer YAML/TOML/JSON

`@eslint/json` already covers tracked JSON (excluding targeted script fixtures;
`tsconfig*.json` follows the jsonc track), so most JSON manifest hygiene is
already floored. Leaf 41c added `bun run lint:config-sensors` for workflow,
maintained YAML, TOML, and Dockerfile sensors; full `bun run lint` and
`lint:changed` include the same floor.

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `.github/workflows/*.yml` | 3 .yml | yes (`bun run lint:config-sensors`) | actionlint + yamllint floor | `@tktco/node-actionlint@1.6.0`, system `yamllint` (`apt install yamllint`, >=1.29.0) | none | linted | Leaf 41c landed; changed-gate relevant |
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
| `eslint-config/*.js` | 16 .js | yes (ESLint config support modules) | normal ESLint dedicated JS config block | Espree | JS recommended + `no-unused-vars`; composition modules plus shared policy data for ESLint scopes/restrictions and config-surface manifest loading | linted | Leaf 23 extraction; Task 25 composition; Leaf 41 added `config-surfaces.js` as the config-surface manifest loader. |
| `commitlint.config.js` | 1 .js | yes (exact re-include from `**/*.config.*`) | normal ESLint dedicated root JS config block | Espree | JS recommended + `no-unused-vars`; JSDoc deferred because `eslint-plugin-jsdoc` is not a dependency | linted | — |
| `knip.config.ts`, `playwright.config.ts`, `vitest.config.ts`, `vitest.slow.config.ts` | 4 root .ts | yes (exact re-include from `**/*.config.*`) | normal ESLint TS config block | typescript-eslint project service via `tsconfig.configs.json` default project | strict-tier minus `local/max-lines`; config files are process/env boundaries | linted | — |
| `stryker.config.mjs`, `stryker.config.server.mjs` | 2 .mjs | yes (exact re-include from `**/*.config.*`) | normal ESLint dedicated root JS config block | Espree | JS recommended + `no-unused-vars`; JSDoc deferred because `eslint-plugin-jsdoc` is not a dependency | linted | — |
| `packages/client/vite.config.ts`, `packages/client/vitest.config.ts`, `packages/server/vitest.config.ts`, `packages/server/vitest.mutation.config.ts`, `packages/server/vitest.unit.config.ts`, `packages/server/prisma.config.ts`, `packages/shared/vitest.config.ts` | 7 .ts | yes (exact re-include from `**/*.config.*`) | normal ESLint TS config block | typescript-eslint project service via `tsconfig.configs.json` default project | strict-tier minus `local/max-lines`; config files are process/env boundaries | linted | `vitest.mutation.config.ts` is the Stryker-only server scope project (`stryker.config.server.mjs`), in the typed-lint config set and `tsconfig.configs.json` like its siblings |
| `scripts/vitest.config.ts`, `eslint-rules/vitest.config.ts` | 2 .ts | yes (exact config-file re-includes; `scripts/vitest.config.ts` stays out of the runtime-script project) | normal ESLint TS config block | typescript-eslint project service via `tsconfig.configs.json` default project | strict-tier minus `local/max-lines`; both are active Vitest project configs (the `scripts` and `eslint-rules` projects per `vitest.config.ts`) | linted | — |
| `tsconfig.json`, `tsconfig.base.json`, `tsconfig.configs.json`, `tsconfig.e2e.json`, `tsconfig.eslint-js.json`, `tsconfig.scripts.json` | 6 root .json | yes (jsonc track) | none | — | none — `@eslint/json` covers no-duplicate-keys/etc.; `tsconfig.configs.json` is generated from `eslint-config/config-surface-manifest.json` by `bun run harness:config-surfaces`; `tsconfig.eslint-js.json` is the checkJs gate over `eslint-config/*.js` run by `scripts/typecheck.sh` | linted | — |
| `packages/{client,server,shared}/tsconfig*.json` (incl. `packages/server/tsconfig.scripts.json`) | 4 .json | yes (jsonc track) | none | — | none | linted | — |
| `package.json` (root) plus `packages/{client,server,shared}/package.json` plus `packages/client/components.json` | 5 .json | yes (`@eslint/json` strict track) | none | — | Leaf 20 ("package-manifest-policy") proposes a report-first manifest sensor — keep parked unless promoted; no Leaf 41-batch floor today beyond the existing JSON rules | linted | Leaf 20 |
| `drift-ai.config.json`, `drift-ai.config.example.json`, `semgrep-rules.example.json`, `harness.controls.json`, `eslint-config/config-surface-manifest.json`, `lint-ratchet.baseline.json`, `sensor-knip-unused-exports.baseline.json`, `sensor-near-duplicates.baseline.json`, `eslint-config/max-lines-exceptions.baseline.json` | 9 .json | yes | none | — | none — `@eslint/json` covers structural correctness; `config-surface-manifest.json` single-sources root/package config registration for shared ESLint policy, `tsconfig.configs.json`, and coverage-map status checking; generated baselines hold ratcheted debt/cap identities | linted | — |
| `.claude/settings.json`, `.codex/hooks.json`, `.github/hooks/copilot.json`, `.playwright/cli.config.json`, `.cursor/cli.json` | 5 .json | yes (`.playwright/cli.config.json` and `.cursor/cli.json` are matched by `**/*.json` since not under any ignore) | none | — | none | linted | — |
| `packages/server/src/seed/data/5e-srd-*.json` plus `PROVENANCE.json` | 5 .json (large Markdown-derived SRD data + its provenance manifest) | yes | none | — | none — strict JSON is enough; semantic checks live in seed pipeline, and the `PROVENANCE.json` checksums are enforced by `seed-derived-provenance.test.ts` | linted | — |
| `packages/server/src/seed/data/reference/5e-SRD-*.json` plus `PROVENANCE.json` | 16 .json (vendored verbatim SRD 5.2.1 reference data + provenance manifest) | yes | none | — | none — vendored byte-for-byte from pinned upstream (prettier-ignored for checksum integrity); structural JSON validity is enough | linted | — |

## Portable Tooling (`tools/lint-ratchet`)

Leaf 02 (lint-arch-review-2026-07) moves the lint-ratchet engine into the
portable `@musi/lint-ratchet` workspace package: the kernel (baseline
codec/collect/compare/update, the metric family, rule-source, and the disposition
schema + lifecycle-diff) and the pure git-rail merge machinery in S3, then the
governance extensions (debt-log, zero-baseline audit, trend/summary, propose,
edit-check, retire, coverage, and debt-accounting) plus the git-rail
`info-attributes` renderer in S4 — all threaded through an injected
engine-context/binding seam so the package carries no `@musi/*`/repo-relative
imports. The `ratchet/local-type-assertion-boundary` ratchet covers
`tools/**/*.ts` at its zero floor. The demo joins the workspace as a consumer in
S5.

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `tools/lint-ratchet/src/**/*.ts` | 110 .ts (`kernel/` 71: baseline codec/collect/compare/update, metric family, rule-source, disposition + lifecycle-diff; `git-rail/` 6: `merge-cli` + `merge-driver-presence` + `info-attributes` and their co-located tests; `governance/` 33: debt-log + schema, zero-baseline audit, trend, summary, propose, edit-check, retire, ratchet-coverage, baseline-debt-accounting, baseline-update-apply, and the shared `WorseBaselineError` in `errors.ts`; co-located unit tests included — leaf 12 re-homed the engine-owned governance/kernel tests from `scripts/`, leaving only binding/integration adapter tests there) | yes (`tools/lint-ratchet/**` reach block) | `ratchet/local-type-assertion-boundary` (zero floor, extended to `tools/**/*.ts` in S3) | ESLint `tools/lint-ratchet/tsconfig.json` parser project | none — engine-zone `local/max-lines` cap (500) carried from `scripts/lint-ratchet/**` | linted + ratcheted | Portable engine surface; zero `@musi/*`/repo-relative imports, proven by the package boundary test. |
| `tools/lint-ratchet/test/**/*.ts` | 10 .ts (engine-context + package-structure suites, the non-Musi fixture-context acceptance test, the resolver-aware boundary checker + its unit test, and the `test/support/` fixture helpers ported in leaf 12) | yes (`tools/lint-ratchet/**` reach block) | `ratchet/local-type-assertion-boundary` | ESLint `tools/lint-ratchet/tsconfig.json` parser project | none — package-owned Vitest project (`lint-ratchet`) with the fail-closed boundary, exports-resolution, and non-Musi fixture-context acceptance assertions | linted + ratcheted | — |
| `tools/lint-ratchet/vitest.config.ts`, `tools/stryker-lint-ratchet.ts` | 2 .ts | yes (config surfaces; `vitest.config.ts` exact re-include from `**/*.config.*`, both manifest re-includes) | none | typescript-eslint project service via `tsconfig.configs.json` default project | strict-tier minus `local/max-lines`; the package Vitest project config and its dedicated Stryker mutation config | linted | Registered in `eslint-config/config-surface-manifest.json` (`root-package-ts`); Stryker runs via `bun run test:lint-ratchet:mutation`. |
| `tools/lint-ratchet/package.json`, `tools/lint-ratchet/tsconfig.json` | 2 .json | yes (json/jsonc track) | none | — | none — `@eslint/json` covers structural correctness; the package manifest and its composite tsconfig | linted | Package declares its own dependencies (source-only, no build); referenced from the root `tsconfig.json` build graph. |
| `tools/lint-ratchet/README.md` | 1 .md | no (`*.md` not auto-formatted; not linted) | none | — | `not-code` — package adoption/copyability doc | not-code | — |

## Markdown And Other Docs

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `docs/**/*` | ~216 (mostly .md, plus the SRD PDF and a few `.bugs`/HTML) | no (`docs/` in global ignores) | none | — | `not-code` for the docs themselves; a narrow doc-length **advisory** (never a commit blocker) covers only specific files — `AGENTS.md`, `CLAUDE.md`, `DECISIONS.md`, `decisions-*.md`, `agent_notes/README.md`, `finished_work/README.md`, `in_progress/*.md` — not `docs/agent_notes/` broadly | not-code | `scripts/doc-length-policy.sh` is the source of truth (advisory-only, file-specific); out of Leaf 41 scope |
| `docs/agent_notes/backlog/harness-review-2026-07/40-trpc-auth-before-persistence-measurement/*.mjs` | 3 .mjs | no (`docs/` in global ignores) | none | Node + ESLint Node API, invoked manually only | `excluded` — leaf 40 archival measurement artifact; intentionally not imported by the local ESLint plugin, lint configs, ratchets, or harness manifest | excluded | Reproduction commands live in the adjacent README. Keep this unwired unless leaf 40 is reopened with a new rule design. |
| `README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, `DESIGN.md`, `MODULE-INDEX.md`, `packages/**/MODULE.md` (and per-feature `*MODULE.md`), `packages/**/README.md` | root guidance docs + 28 client + 8 server + 0 shared MODULE docs + 1 nested package README | no | none | — | `not-code` — Markdown guidance; module-index sensor already validates per-module structure | not-code | `scripts/generate-module-index.sh` + `module:index:check` is the existing structural sensor |
| `NOTICE.md` | 1 .md | no | none | — | `not-code` — root source license, SRD attribution, and third-party notice for public distribution | not-code | — |
| `.claude/skills/**/*.md`, `.codex/skills/**/*.md` (skill content) | ~22 .md | no | none | — | `not-code` | not-code | — |
| `.claude/output-styles/cadence.md` | 1 .md | no | none | — | `not-code` — custom Claude Code output style for concise progress tone; workflow policy lives in `AGENTS.md` | not-code | — |
| `.devcontainer/README.md`, `.github/pull_request_template.md` | 2 .md | no | none | — | `not-code` | not-code | — |
| `scripts/README.md` | 1 .md | no | none | — | `not-code` — scripts layout contract | not-code | — |
| `LICENSE` | 1 | no | none | — | `not-code` — root source license text | not-code | — |
| `packages/server/src/seed/data/reference/NOTICE.md` | 1 .md | no | none | — | `not-code` — CC-BY-4.0 attribution for the vendored SRD reference data | not-code | — |
| `packages/server/src/seed/data/NOTICE.md` | 1 .md | no | none | — | `not-code` — CC-BY-4.0 attribution + modification notice for the Markdown-derived SRD seed data | not-code | — |
| `docs/SRD_CC_v5.2.1.pdf` | 1 .pdf | no | none | — | `not-code` | not-code | — |

## Web Assets, Lockfiles, And Misc Tracked Files

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `packages/client/index.html` | 1 .html | no | none | — | `excluded` — Vite entry HTML; semantic checks happen via Vite/React at build time | excluded | — |
| `packages/client/src/app.css` | 1 .css | no | none | — | `excluded` — Tailwind v4 entry; `prettier --check` covers formatting | excluded | — |
| `bun.lock` | 1 | no | none | — | `not-code` — lockfile | not-code | `bun install --frozen-lockfile` in CI is the integrity check |
| `lint-ratchet.debt-log.jsonl` | 1 .jsonl | no | none | — | `not-code` — append-only ratchet debt history consumed by the debt-log renderer | not-code | — |
| `.gitattributes`, `.gitignore`, `.prettierrc`, `.prettierignore`, `.worktreeinclude`, `.blob-size-allowlist` | 6 | no | none | — | `excluded` — repo metadata, hand-maintained | excluded | — |
| `packages/server/.gitignore` | 1 | no | none | — | `excluded` | excluded | — |
| `examples/lint-ratchet-demo/**` | — | no | none | own ratchet gate | `excluded` — workspace consumer of `@musi/lint-ratchet` with its own `eslint.config.js`, `tsconfig`, `package.json`, and `lint:ratchet` gate; the main repo does not lint it (ignored in `eslint-config/base-configs.js`), its own CI smoke does | excluded | Copyability proof for the public reference; exercised by `examples/lint-ratchet-demo/smoke.sh` via `.github/workflows/lint-ratchet-demo.yml` |

## Cross-Cutting Notes For Leaf 41 Implementation

- **Existing type-assertion coverage caveat.** After Leaf 41g, no tracked row
  keeps `proposed` for a remaining broad-shallow blocker. Former
  type-boundary-only script rows now either have normal lint plus ratchets, or
  treat normal-lint adoption, import-sort, regexp, explicit-return-type,
  `consistent-type-imports`, `max-params`, and similar rules as deeper
  follow-up work.
- **Script lint adoption is now default.** The script families above are
  covered by `tsconfig.scripts.json` through the default `scripts/**/*.ts`
  ESLint project mapping, with targeted fixture/config exclusions. The
  root/package config block is normal-linted via `tsconfig.configs.json`.
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
