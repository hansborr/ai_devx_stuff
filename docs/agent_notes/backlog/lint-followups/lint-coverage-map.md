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
5. A file is `ratcheted` iff it matches at least one ratchet entry's `files`
   glob and is not pruned by that entry's `ignores`.
6. The `local/type-assertion-boundary` ratchet covers `scripts/**/*.ts`
   (less `scripts/codemods/fixtures/**`), so almost every unlinted script
   has *some* floor today. Leaf 41 still treats those scripts as needing a
   `proposed` floor when the type-assertion rule is not the meaningful risk
   for that family (max-lines, complexity, import-sort, regexp, vitest,
   typeof-import, etc.).

## Production Package Source

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `packages/shared/src/**/*.ts` (production) | 66 .ts | yes | `ratchet/local-max-lines` (default-cap subset), `ratchet/local-type-assertion-boundary`, `ratchet/strict-boolean-expressions-shared` | ESLint `type-aware-ts` (project service) | none — already floored across the meaningful axes | linted + ratcheted | — |
| `packages/server/src/**/*.ts` (production, non-test) | ~207 .ts | yes | `ratchet/local-max-lines` (default-cap subset, with named `warn` overrides for `routers/encounter.ts`, `routers/homebrew.ts`, `routers/srd.ts`, `services/rest-service.ts`), `ratchet/local-type-assertion-boundary` | ESLint `type-aware-ts` (project service) | none — strict tier (server-only rules: `local/concurrency-guard`, `local/no-broadcast-in-transaction`, `local/socket-registry-broadcasts`, `local/structured-logging`, `local/strict-trpc-input`, tRPC schema rules) is the right family today | linted + ratcheted | — |
| `packages/client/src/**/*.{ts,tsx}` (production, non-test) | ~386 .ts+.tsx | yes | `ratchet/local-max-lines` (default-cap subset, with named `warn` overrides for several form/encounter/notes/npc/pages/stores files), `ratchet/local-type-assertion-boundary` | ESLint `type-aware-ts` (project service) | none — strict tier plus React, jsx-a11y, and `@tanstack/query` rule set is the right family today | linted + ratcheted | — |
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
| `e2e/**/*.ts` (specs, page objects, helpers) | 44 .ts | yes (Playwright recommended + custom Musi rules: `local/e2e-prefer-role-selectors` with legacy allowlist; `local/test-file-location`) | `ratchet/local-max-lines`, `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.e2e.json` parser project | none — Playwright rule set is the right family today | linted + ratcheted | Legacy `local/e2e-prefer-role-selectors` allowlist drains opportunistically (Plan Step 3c) |

## Linted Scripts (Explicit `eslint.config.js` Re-includes)

These are the `scripts/**` re-includes that survive the global ignore. They
share `tsconfig.scripts.json` and additionally apply
`local/type-assertion-boundary` per a dedicated `rules` block.

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/code-intel/**/*.ts` | 38 .ts (incl. `overview-query.spec.ts`, `bun-test.d.ts`) | yes | `ratchet/local-max-lines`, `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — strict tier already applies | linted + ratcheted | — |
| `scripts/code-intel-server.ts` | 1 .ts | yes | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none | linted + ratcheted | — |
| `scripts/drift/**/*.ts` | 2 .ts (`locator-usage.ts`, `locator-usage.test.ts`) | yes | `ratchet/local-max-lines` (non-test only), `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none | linted + ratcheted | — |
| `scripts/generate-lint-guidance.ts` | 1 .ts | yes | `ratchet/local-max-lines`, `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none | linted + ratcheted | — |
| `scripts/lint-rule-docs.ts` | 1 .ts | yes | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none | linted + ratcheted | — |
| `scripts/lint-ratchet-config.ts` | 1 .ts | yes | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none — pure config object | linted + ratcheted | — |
| `scripts/logs-audit.test.ts` | 1 .ts | yes (only the test is re-included; entrypoint `scripts/logs-audit.ts` is unlinted — see Leaf 40 row below) | `ratchet/local-type-assertion-boundary` | ESLint `tsconfig.scripts.json` | none on the test (vitest rules apply) | linted + ratcheted | Pair with the unlinted `scripts/logs-audit.ts` row |
| `scripts/drift-ai/errors.ts`, `scope.ts`, `scope.test.ts` | 3 .ts | yes (named carve-out in eslint.config.js ignores) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-drift-ai` (production files only) | ESLint `tsconfig.scripts.json` | none — narrow strict-tier files | linted + ratcheted | — |

## Unlinted Scripts (Outside `bun run lint`)

All rows below are covered by `ratchet/local-type-assertion-boundary`
(via `scripts/**/*.ts`) and therefore have a floor against new boundary
violations, but most have *additional* meaningful risks (max-lines,
complexity, import-sort, regexp, vitest test-quality, `consistent-type-imports`,
return-types, etc.) that the type-assertion rule does not cover. The
`Proposed rule/tool` column names the load-bearing guard for that family.
Cross-references to existing per-family follow-up leaves are in the
`Blocker/follow-up` column.

### Generate-Harness-Controls (Leaf 30)

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/generate-harness-controls.ts` | 1 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-generate-harness-controls` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | `complexity`, `max-params` | ratcheted + proposed | Leaf 30; depends on Leaf 41 phase-1 core-rule source support if `complexity`/`max-params` are picked |

### Code-Intel Facade (Leaf 31, Leaf 40 test)

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/code-intel.ts` | 1 .ts (top-level facade) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-code-intel` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | `@typescript-eslint/consistent-type-imports` (script-scoped ratchet that floors the 9 known `typeof import()` errors at current count) | ratcheted + proposed | Leaf 31 (rewrite drain); Leaf 19 slice-4 confirmed non-autofixable |
| `scripts/code-intel.test.ts` | 1 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | `vitest/*` (expect-expect, valid-expect, etc.); `local/max-lines` (test-scoped) | proposed | Leaf 40 |

### Drift-AI (Leaves 32 / 33 / 34, plus Leaf 40 entrypoint)

Per Leaf 41 implementation order item 5, prefer a single coherent
rule-scoped `drift-ai` ratchet with a precise file set over overlapping
sibling ratchets. The rows below capture file membership; the proposed
rules should be split by rule, not by report/inventory family, unless the
counts/diagnostic noise force a split.

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/drift-ai.ts` | 1 .ts (entrypoint) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-drift-ai`, `ratchet/core-complexity-drift-ai` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | `simple-import-sort/imports` | ratcheted + proposed | Leaf 40 |
| `scripts/drift-ai.test.ts` | 1 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/typescript-eslint-no-misused-promises-drift-ai-tests`, `ratchet/typescript-eslint-only-throw-error-drift-ai-tests`, `ratchet/vitest-expect-expect-drift-ai-tests`, `ratchet/vitest-valid-expect-drift-ai-tests` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none - bug-class rules now floored | ratcheted | `finished_work/lint-hardening-leaf-41-drift-ai-test-bug-class-ratchets.md` |
| `scripts/drift-ai/comments.ts` and `comments.test.ts` | 2 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-drift-ai` (production file only); test-only: `ratchet/typescript-eslint-no-misused-promises-drift-ai-tests`, `ratchet/typescript-eslint-only-throw-error-drift-ai-tests`, `ratchet/vitest-expect-expect-drift-ai-tests`, `ratchet/vitest-valid-expect-drift-ai-tests` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | production report-family bucket - `simple-import-sort`, `regexp/*`, `@typescript-eslint/only-throw-error`, `@typescript-eslint/explicit-function-return-type`; test bug-class bucket floored | ratcheted + proposed | `finished_work/lint-hardening-leaf-41-drift-ai-test-bug-class-ratchets.md` |
| `scripts/drift-ai/harness-freshness.ts` and `harness-freshness.test.ts` | 2 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-drift-ai` (production file only); test-only: `ratchet/typescript-eslint-no-misused-promises-drift-ai-tests`, `ratchet/typescript-eslint-only-throw-error-drift-ai-tests`, `ratchet/vitest-expect-expect-drift-ai-tests`, `ratchet/vitest-valid-expect-drift-ai-tests` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | production report-family bucket; test bug-class bucket floored | ratcheted + proposed | `finished_work/lint-hardening-leaf-41-drift-ai-test-bug-class-ratchets.md` |
| `scripts/drift-ai/suppressions.ts` and `suppressions.test.ts` | 2 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-drift-ai` (production file only); test-only: `ratchet/typescript-eslint-no-misused-promises-drift-ai-tests`, `ratchet/typescript-eslint-only-throw-error-drift-ai-tests`, `ratchet/vitest-expect-expect-drift-ai-tests`, `ratchet/vitest-valid-expect-drift-ai-tests` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | production report-family bucket; test bug-class bucket floored | ratcheted + proposed | `finished_work/lint-hardening-leaf-41-drift-ai-test-bug-class-ratchets.md` |
| `scripts/drift-ai/config.ts` | 1 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-drift-ai` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | inventory-family bucket — `simple-import-sort`, `regexp/*`, `@typescript-eslint/restrict-template-expressions`, `@typescript-eslint/explicit-function-return-type` | ratcheted + proposed | Leaf 34 |
| `scripts/drift-ai/current-inventory.ts` and `current-inventory.test.ts` | 2 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-drift-ai` (production file only); test-only: `ratchet/typescript-eslint-no-misused-promises-drift-ai-tests`, `ratchet/typescript-eslint-only-throw-error-drift-ai-tests`, `ratchet/vitest-expect-expect-drift-ai-tests`, `ratchet/vitest-valid-expect-drift-ai-tests` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | production inventory-family bucket; test bug-class bucket floored | ratcheted + proposed | `finished_work/lint-hardening-leaf-41-drift-ai-test-bug-class-ratchets.md` |
| `scripts/drift-ai/duplicates.ts` and `duplicates.test.ts` | 2 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-drift-ai` (production file only); test-only: `ratchet/typescript-eslint-no-misused-promises-drift-ai-tests`, `ratchet/typescript-eslint-only-throw-error-drift-ai-tests`, `ratchet/vitest-expect-expect-drift-ai-tests`, `ratchet/vitest-valid-expect-drift-ai-tests` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | production inventory-family bucket; test bug-class bucket floored | ratcheted + proposed | `finished_work/lint-hardening-leaf-41-drift-ai-test-bug-class-ratchets.md` |
| `scripts/drift-ai/ghost-files.ts` and `ghost-files.test.ts` | 2 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-drift-ai` (production file only); test-only: `ratchet/typescript-eslint-no-misused-promises-drift-ai-tests`, `ratchet/typescript-eslint-only-throw-error-drift-ai-tests`, `ratchet/vitest-expect-expect-drift-ai-tests`, `ratchet/vitest-valid-expect-drift-ai-tests` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | production inventory-family bucket; test bug-class bucket floored | ratcheted + proposed | `finished_work/lint-hardening-leaf-41-drift-ai-test-bug-class-ratchets.md` |
| `scripts/drift-ai/fixtures/jscpd-report.basic.json` | 1 .json | no (JSON lint ignores via `scripts/**/*`) | none | — | `excluded` — fixture | excluded | — |

### Codemods (Leaves 35–37)

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/codemods/concurrency-guard.ts` | 1 .ts | no (in `tsconfig.scripts.json` via `scripts/codemods/**/*.ts`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-codemods`, `ratchet/core-complexity-codemods` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | `max-params` | ratcheted + proposed | Leaf 36 |
| `scripts/codemods/structured-logging-fix.ts` | 1 .ts | no (in `tsconfig.scripts.json` via `scripts/codemods/**/*.ts`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-codemods`, `ratchet/core-complexity-codemods` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | `max-params` | ratcheted + proposed | Leaf 36 |
| `scripts/codemods/expand-barrel.ts` | 1 .ts | no (in `tsconfig.scripts.json` via `scripts/codemods/**/*.ts`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-codemods`, `ratchet/core-complexity-codemods` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | `max-params` | ratcheted + proposed | Leaf 37 |
| `scripts/codemods/trpc-shared-input.ts`, `trpc-shared-output.ts` | 2 .ts | no (in `tsconfig.scripts.json` via `scripts/codemods/**/*.ts`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-codemods`, `ratchet/core-complexity-codemods` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | `max-params` | ratcheted + proposed | Leaf 37 |
| `scripts/codemods/lib/trpc-shared-schema.ts` | 1 .ts (shared codemod helper — known straggler) | no (in `tsconfig.scripts.json` via `scripts/codemods/**/*.ts`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-codemods`, `ratchet/core-complexity-codemods` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | `max-params` | ratcheted + proposed | Leaf 37 (add explicit row in Leaf 37 per Leaf 41 candidate list) |
| `scripts/codemods/concurrency-guard.test.ts`, `expand-barrel.test.ts`, `structured-logging-fix.test.ts`, `trpc-shared-schema-codemod.test.ts` | 4 .ts (test harness) | no (in `tsconfig.scripts.json` via `scripts/codemods/**/*.ts`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/typescript-eslint-no-misused-promises-codemod-tests`, `ratchet/typescript-eslint-only-throw-error-codemod-tests`, `ratchet/vitest-expect-expect-codemod-tests`, `ratchet/vitest-valid-expect-codemod-tests` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | none — bug-class rules now floored; drain in Leaf 35 | ratcheted | Leaf 35 (fix-soon urgency per Leaf 41 §Candidate Work bullet 4) |
| `scripts/codemods/fixtures/**/*` | ~390 mixed .ts/.json | no | excluded by `ratchet/local-type-assertion-boundary` ignore (`scripts/codemods/fixtures/**`) and by global `scripts/**/*` ignore | — | `excluded` — synthesized before/after test inputs, not live code | excluded | Leaf 27 tracks harmonizing the broader ratchet/eslint scope |

### Top-Level Scripts Outside `tsconfig.scripts.json` (Leaf 38)

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/db-status.ts` | 1 .ts | no (in `tsconfig.scripts.json` and the scripts parser block, but not in `eslint.config.js` re-includes) | `ratchet/core-complexity-top-level-scripts`, `ratchet/core-no-magic-numbers-top-level-scripts`, `ratchet/core-preserve-caught-error-top-level-scripts`, `ratchet/local-type-assertion-boundary`, `ratchet/simple-import-sort-imports-top-level-scripts`, `ratchet/typescript-eslint-no-unsafe-argument-top-level-scripts`, `ratchet/typescript-eslint-restrict-template-expressions-top-level-scripts`, `ratchet/typescript-eslint-unbound-method-top-level-scripts` (also named in `eslint.config.js` `no-restricted-syntax` allowlist for the `process.env` and `process.exit` carve-outs even though the file itself is not normal-linted) | parser wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet drain | drain current `restrict-template-expressions` count before normal lint | ratcheted | `finished_work/lint-hardening-leaf-38-top-level-scripts.md` |
| `scripts/harness-emit-envelope.ts` | 1 .ts | no (in `tsconfig.scripts.json` and the scripts parser block, but not in `eslint.config.js` re-includes) | `ratchet/core-complexity-top-level-scripts`, `ratchet/core-no-magic-numbers-top-level-scripts`, `ratchet/core-preserve-caught-error-top-level-scripts`, `ratchet/local-type-assertion-boundary`, `ratchet/simple-import-sort-imports-top-level-scripts`, `ratchet/typescript-eslint-no-unsafe-argument-top-level-scripts`, `ratchet/typescript-eslint-restrict-template-expressions-top-level-scripts`, `ratchet/typescript-eslint-unbound-method-top-level-scripts` | parser wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet drain | drain import-sort, caught-error, no-unsafe, unbound-method, and no-magic findings before normal lint | ratcheted | `finished_work/lint-hardening-leaf-38-top-level-scripts.md` |
| `scripts/sensor-blob-size.ts` | 1 .ts | no (in `tsconfig.scripts.json` and the scripts parser block, but not in `eslint.config.js` re-includes) | `ratchet/core-complexity-top-level-scripts`, `ratchet/core-no-magic-numbers-top-level-scripts`, `ratchet/core-preserve-caught-error-top-level-scripts`, `ratchet/local-type-assertion-boundary`, `ratchet/simple-import-sort-imports-top-level-scripts`, `ratchet/typescript-eslint-no-unsafe-argument-top-level-scripts`, `ratchet/typescript-eslint-restrict-template-expressions-top-level-scripts`, `ratchet/typescript-eslint-unbound-method-top-level-scripts` | parser wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet drain | drain complexity, no-magic, and template-expression findings before normal lint | ratcheted | `finished_work/lint-hardening-leaf-38-top-level-scripts.md` |
| `scripts/sensor-blob-size.test.ts` | 1 .ts | no (in `tsconfig.scripts.json` and the scripts parser block, but not in `eslint.config.js` re-includes) | `ratchet/core-complexity-top-level-scripts`, `ratchet/core-preserve-caught-error-top-level-scripts`, `ratchet/local-type-assertion-boundary`, `ratchet/simple-import-sort-imports-top-level-scripts`, `ratchet/typescript-eslint-no-unsafe-argument-top-level-scripts`, `ratchet/typescript-eslint-restrict-template-expressions-top-level-scripts`, `ratchet/typescript-eslint-unbound-method-top-level-scripts` | parser wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet drain | no current findings; keep paired with `sensor-blob-size.ts` until normal lint adoption | ratcheted | `finished_work/lint-hardening-leaf-38-top-level-scripts.md` |

### Ratchet/Harness Runtime Scripts (Leaf 39)

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/lint-ratchet.ts` | 1 .ts (ratchet runner CLI) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-runtime` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | strict-tier once re-included | ratcheted + proposed | Leaf 39 |
| `scripts/lint-ratchet-baseline.ts` | 1 .ts (baseline serializer) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-runtime` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | strict-tier once re-included | ratcheted + proposed | Leaf 39 |
| `scripts/lint-ratchet-baseline.test.ts` | 1 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | `vitest/*` once re-included; before that: bug-class drain | proposed | Leaf 39 |
| `scripts/lint-agent.ts` | 1 .ts (machine-readable lint slice from PR 3a) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-runtime` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | strict-tier once re-included | ratcheted + proposed | Leaf 39 |
| `scripts/harness-check.ts` | 1 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-runtime` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | strict-tier once re-included | ratcheted + proposed | Leaf 39 |
| `scripts/lint-coverage-map-check.ts` | 1 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | strict-tier once re-included | ratcheted + proposed | Leaf 39 |
| `scripts/lint-coverage-map-check.test.ts` | 1 .ts | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | `vitest/*` once re-included; before that: bug-class drain | proposed | Leaf 39 |

### Largest Remaining Entrypoints/Tests (Leaf 40)

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/logs-audit.ts` | 1 .ts (entrypoint; only `logs-audit.test.ts` is re-included today) | no (in `tsconfig.scripts.json`, but not in `eslint.config.js` re-includes) | `ratchet/local-type-assertion-boundary`, `ratchet/local-max-lines-logs-audit` | parser already wired via `tsconfig.scripts.json`; blocker is the ESLint re-include / ratchet entry | strict-tier once re-included | ratcheted + proposed | Leaf 40 |
| `scripts/logs-audit/fixtures/business-events-server.jsonl`, `redacted-server.jsonl` | 2 .jsonl | no | none | — | `excluded` — fixture | excluded | — |

### Other Script Fixtures (Always Excluded)

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/test-fixtures/lint-ratchet/expected-*.config.mjs` | 2 .mjs | no (global `scripts/**/*` + `**/*.config.*` ignore) | none | — | `excluded` — expected-generated-config snapshots used by `test-lint-ratchet.sh` | excluded | — |
| `scripts/fixtures/generate-harness-controls/expected.md`, `scripts/fixtures/generate-lint-guidance/expected.md` | 2 .md | no | none | — | `excluded` — expected-output snapshots | excluded | — |

## Local ESLint Rules

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `eslint-rules/{concurrency-guard,e2e-prefer-role-selectors,max-lines,no-async-array-callbacks,no-barrel,no-broadcast-in-transaction,no-explicit-any,no-llm-artifacts,no-swallowed-errors,socket-registry-broadcasts,strict-shared-schemas,strict-trpc-input,structured-logging,test-file-location,trpc-require-output-schema,trpc-shared-input-schema,trpc-shared-output-schema,type-assertion-boundary}.js` (rule implementations) | 18 .js (one per rule registered in `eslint.config.js`) | yes | `ratchet/core-complexity-eslint-rules`, `ratchet/core-no-magic-numbers-eslint-rules`, `ratchet/regexp-no-unused-capturing-group-eslint-rules`, `ratchet/regexp-no-useless-non-capturing-group-eslint-rules` | ESLint recommended JS + explicit `no-unused-vars` + non-type-aware syntactic strict-tier / regexp floor; ratchets use `minimal-ts`; JSDoc rules deferred because `eslint-plugin-jsdoc` is not installed | JSDoc plugin follow-up; Phase A.3 audits `local/*`, `eslint-comments`, and `simple-import-sort` for rule implementations | linted + ratcheted | Phase A.3 (`local/*`, `eslint-comments`, `simple-import-sort` audit) deferred; see `NEXT.md` |
| `eslint-rules/*.test.js` (rule tests) | 20 .js | yes | `ratchet/vitest-no-commented-out-tests-eslint-rules-tests`, `ratchet/vitest-no-conditional-expect-eslint-rules-tests` | ESLint recommended JS + explicit `no-unused-vars` + Vitest recommended floor; no project service | none — Phase B landed; known debt is ratcheted | linted + ratcheted | Finished: `docs/agent_notes/finished_work/lint-hardening-leaf-41-eslint-rules-floor-phase-b.md`; debt: 1 commented-out-tests + 5 conditional-expect messages |
| `eslint-rules/vitest.config.ts` | 1 .ts | no (`**/*.config.*`) | none | — | `excluded` — vitest config | excluded | — |

## Shell Scripts And Git Hooks

All maintained shell — repo scripts plus agent/devcontainer hooks — currently
has no lint floor. Proposed: ShellCheck baseline with a committed counts file
(matched-file proof per Leaf 41 §Implementation Order item 6) treated as a
local sensor with the ratchet contract (no new findings, no higher per-file
counts). Folding the sensor into `lint:ratchet` is a later runner extension.

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scripts/**/*.sh` (top-level verify, test-*, worktree-*, db, doctor, etc.) | ~50 .sh | no | none | — | ShellCheck baseline | pending-leaf | **child Leaf 41b** — shell/hook ShellCheck floor |
| `scripts/ai-hooks/*.sh` (agent hook implementations) | 12 .sh | no | none | — | ShellCheck baseline | pending-leaf | **child Leaf 41b** |
| `.claude/hooks/*.sh` (Claude Code hooks) | 7 .sh | no | none | — | ShellCheck baseline | pending-leaf | **child Leaf 41b** |
| `.codex/hooks/*.sh` (Codex hooks) | 3 .sh | no | none | — | ShellCheck baseline | pending-leaf | **child Leaf 41b** |
| `.devcontainer/container-entrypoint.sh`, `init-firewall.sh`, `start-servers.sh` | 3 .sh | no | none | — | ShellCheck baseline | pending-leaf | **child Leaf 41b** |
| `.husky/{pre-commit,post-checkout,post-merge,commit-msg}` | 4 (extensionless shell, with `#!/bin/bash` or `#!/usr/bin/env bash` shebangs) | no | none | — | ShellCheck baseline | pending-leaf | **child Leaf 41b** |
| `init-test-db.sql`, `.devcontainer/init-test-db.sql` | 2 .sql | no | none | — | `excluded` — bootstrap SQL, not maintained as live ESLint surface | excluded | — |

## Workflows And Agent/Devcontainer YAML/TOML/JSON

`@eslint/json` already covers tracked JSON (excluding `scripts/**/*`,
`tsconfig*.json` follows the jsonc track), so most JSON manifest hygiene is
already floored. YAML and TOML have no floor today.

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `.github/workflows/ci.yml` | 1 .yml | no | none | — | actionlint baseline | pending-leaf | **child Leaf 41c** — workflow/YAML floor |
| `.github/pull_request_template.md` | 1 .md | no | none | — | `not-code` — Markdown template | not-code | — |
| `docker-compose.yml`, `.devcontainer/docker-compose.yml` | 2 .yml | no | none | — | yamllint or `jsonschema --schema docker-compose` baseline | pending-leaf | **child Leaf 41c** |
| `.codex/skills/*/agents/openai.yaml` | 2 .yaml | no | none | — | yamllint baseline (skill agent manifest schema is small and stable) | pending-leaf | **child Leaf 41c** |
| `.codex/config.toml`, `bunfig.toml` | 2 .toml | no | none | — | taplo lint/format baseline | pending-leaf | **child Leaf 41c** |
| `.devcontainer/devcontainer.json` | 1 .json (no comments today) | yes (strict JSON track via `**/*.json`) | none | — | if a future edit introduces `//`/`/* */` comments, add `.devcontainer/devcontainer.json` to the jsonc track | linted | — |
| `.devcontainer/Dockerfile` | 1 | no | none | — | hadolint baseline | pending-leaf | **child Leaf 41c** |
| `.devcontainer/.env.example`, `.env.example` | 2 | no | none | — | `excluded` — example env (no secrets); maintained by hand | excluded | — |
| `packages/server/prisma/migrations/migration_lock.toml` | 1 .toml | no | none | — | `excluded` — Prisma-managed | excluded | (also listed in Production Package Source) |

## Root And Package Config Files

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `eslint.config.js` | 1 .js | no (`**/*.config.*`) | none | — | bring `eslint.config.js` under a dedicated `files: ["eslint.config.js"]` rules block with `recommended` JS + JSDoc + `no-unused-vars` — small in-cycle change | proposed | Leaf 41 |
| `commitlint.config.js` | 1 .js | no (`**/*.config.*`) | none | — | same as above (small JS rule block); low diagnostic volume | proposed | Leaf 41 |
| `knip.config.ts`, `playwright.config.ts`, `vitest.config.ts`, `vitest.slow.config.ts` | 4 root .ts | no (`**/*.config.*`) | none | — | dedicated `files: ["*.config.{ts,mts,cts}"]` block with strict-tier minus `local/max-lines` — needs a parser-project decision (config files live outside package tsconfigs today) | proposed | Leaf 41 (parser decision blocker; otherwise small) |
| `stryker.config.mjs` | 1 .mjs | no (`**/*.config.*`) | none | — | same as above | proposed | Leaf 41 |
| `packages/client/vite.config.ts`, `packages/client/vitest.config.ts`, `packages/server/vitest.config.ts`, `packages/server/prisma.config.ts`, `packages/shared/vitest.config.ts` | 5 .ts | no (`**/*.config.*`) | none | — | same as above; parser-project decision is per-package | proposed | Leaf 41 |
| `scripts/vitest.config.ts`, `eslint-rules/vitest.config.ts` | 2 .ts | no (`**/*.config.*`) | none | — | same family as other config files; both are active Vitest project configs (the `scripts` and `eslint-rules` projects per `vitest.config.ts`) | proposed | Leaf 41 |
| `tsconfig.{json,base,e2e,scripts}.json` | 4 root .json | yes (jsonc track) | none | — | none — `@eslint/json` covers no-duplicate-keys/etc. | linted | — |
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

- **Existing type-assertion coverage caveat.** Per Leaf 41 §Implementation
  Order item 1, the script families above that show
  `ratchet/local-type-assertion-boundary` as their only floor still count as
  needing a proposed floor whenever the type-assertion rule is not the
  meaningful risk for the family. Each `proposed` row in this map names a
  different load-bearing rule for that reason.
- **ESLint re-include is the usual blocker, not the parser project.** Most
  of the script families above (codemods, drift-ai, ratchet/harness runtime,
  `logs-audit.ts`, `code-intel*`, `generate-harness-controls.ts`,
  `lint-agent.ts`, and the Leaf 38 top-level scripts) are already covered by
  `tsconfig.scripts.json`, so a `type-aware-ts` ratchet can run against them
  as soon as the ratchet entry lands. The root/package `*.config.{ts,mts,cts}`
  files in the Root And Package Config Files section still need a parser
  decision because no tsconfig currently includes them. For script rows, the
  first implementation slice is now usually the ratchet entry plus (where
  useful) the `eslint.config.js` re-include.
- **Core ESLint rule support.** Core rules such as `complexity`,
  `max-params`, and `no-nested-ternary` can now use
  `source: { kind: "core" }` ratchet entries. Batch 6 is the first live use;
  future batches can add targeted core ratchets without a runner extension
  phase.
- **Non-ESLint child leaves to split out.** The shell/hook ShellCheck floor
  (**41b**), the workflow/YAML/TOML/Dockerfile floor (**41c**, covering
  actionlint + yamllint/taplo/hadolint as needed), and any future generator
  for the coverage map itself should be tracked as named child leaves under
  Leaf 41 once the in-cycle ESLint batches start. The local ESLint rule
  surface (**41g** if it grows beyond one in-cycle ESLint coverage batch)
  is the most likely "promote to its own child leaf" candidate among the
  remaining ESLint surfaces.
- **Bug-class urgency.** Per Leaf 41 §Candidate Work bullet 4, the codemod
  test-harness family (Leaf 35) and the drift-ai test families should
  baseline at current counts but treat the bug-class rules
  (`vitest/expect-expect`, `vitest/valid-expect`,
  `@typescript-eslint/only-throw-error`, ambiguous truthiness) as fix-soon
  drains, not open-ended buckets.
- **Refresh seed leaves.** Per Leaf 41 §Candidate Work bullets 6 and 8,
  Leaf 37 should include `scripts/codemods/lib/trpc-shared-schema.ts`.
  Leaf 38 has now included `scripts/sensor-blob-size.ts` plus
  `scripts/sensor-blob-size.test.ts`; both rows above point to the landed
  finished-work note.
