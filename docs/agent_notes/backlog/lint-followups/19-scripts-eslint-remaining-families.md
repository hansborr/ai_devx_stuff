# Leaf 19: Remaining Script ESLint Families

Status: Partially adopted (`scripts/lint-rule-docs.ts` covered 2026-05-19);
remaining families parked. Script/codemod ratchet-first/drain leaves 30-40
were drafted 2026-05-20 from the deferred inventories below.
Sources:

- `docs/agent_notes/backlog/lint-hardening/08-scripts-eslint-coverage.md`
- `docs/agent_notes/finished_work/lint-hardening-leaf-19-scripts-lint-rule-docs-adoption.md`

## Resolution Slice 1 (2026-05-19)

`scripts/lint-rule-docs.ts` was added to ESLint coverage. The file had
**0 findings** before adoption, so no code changes landed — only three
narrow additions to `eslint.config.js` (ignore exemption, parser-options
block, `local/type-assertion-boundary` block). The file is the shared
loader behind the PR 1 `meta.docs` contract and pairs naturally with
the already-linted `scripts/generate-lint-guidance.ts`.

## Resolution Slice 3 (2026-05-19)

`scripts/lint-ratchet-config.ts` was added to ESLint coverage. The file
had **0 findings** before adoption (166 lines, under the
`local/max-lines` 300 ceiling), so no code changes landed — only three
narrow `eslint.config.js` additions (ignore exemption, parser-options
block, `local/type-assertion-boundary` block). The file is the central
configuration module for the PR 4 lint ratchet.

## Probe Deferral (2026-05-19) — codemod test files

Probed four `scripts/codemods/*.test.ts` files under the 300-line
ceiling (191–234 lines), all already in `tsconfig.scripts.json`.
Full lint produced 20 errors across the four files in repeating
shapes: `@typescript-eslint/no-confusing-void-expression`,
`@typescript-eslint/only-throw-error`, `vitest/expect-expect`, and
one autofixable `simple-import-sort/imports`. None are mechanical:
the throw-error and expect-expect repairs change test semantics,
the void-expression brace additions need per-site review, and the
autonomous slice doesn't apply autofixes on its own. Folds naturally
into Leaf 11's codemod coverage decision or a future test-quality
leaf. No commits landed; the work branch was deleted. Details:
`finished_work/lint-hardening-leaf-19-scripts-codemod-test-files-deferral.md`.

## Probe Deferral (2026-05-19) — top-level non-tsconfig scripts

Probed three top-level `scripts/*.ts` files under the 300-line
ceiling: `db-status.ts` (102), `harness-emit-envelope.ts` (172),
and `sensor-blob-size.test.ts` (195). All three failed with
"parserOptions.project has been provided… the file was not found in
any of the provided project(s)". A grep confirmed none appear in
`tsconfig.scripts.json` or any other root tsconfig — they're
standalone Bun scripts outside the TypeScript project graph.
Adopting them would require modifying `tsconfig.scripts.json`
first, a project-shape decision the autonomous slice declined. No
commits landed; the work branch was deleted. Details:
`finished_work/lint-hardening-leaf-19-scripts-top-level-non-scripts-tsconfig-deferral.md`.

## Resolution Slice 5 (2026-05-19)

Three `scripts/drift-ai/**` files joined the gate — the only under-
ceiling modules that probed clean once the directory was unignored:

- `errors.ts` (6), `scope.ts` (62), `scope.test.ts` (44)

Config-only adoption with a new `!scripts/drift-ai/` directory
unignore (codex review caught that the earlier probe was misleading
without it). Four more under-ceiling files were carved out due to
real findings exposed once the directory walk worked:
`current-inventory.ts` and `current-inventory.test.ts`
(`simple-import-sort/imports`), `harness-freshness.test.ts`
(`explicit-function-return-type`), and `comments.ts`
(complexity 21, plus `restrict-template-expressions`,
`regexp/no-unused-capturing-group`). The whole-glob adoption stays
deferred because nine more `drift-ai/` files (332–696 lines) exceed
the `local/max-lines` ceiling. Details:
`finished_work/lint-hardening-leaf-19-scripts-drift-ai-small-modules-adoption.md`.

## Resolution Slice 4 (2026-05-19)

Two additional script files joined the gate:

- `scripts/code-intel-server.ts` (4 lines — entrypoint sibling of the
  already-linted `code-intel/**/*.ts` cohort, 0 findings).
- `scripts/logs-audit.test.ts` (273 lines — script-side test, 0 findings).

Both adoptions are config-only (ignore exemption, parser-options block,
`local/type-assertion-boundary` block). `scripts/code-intel.ts` was
probed alongside the pair but carved out: it produced 9
`@typescript-eslint/consistent-type-imports` errors on `typeof import()`
annotations that need a structural rewrite to top-level
`import type` declarations. Verdict: defer until a leaf with explicit
budget picks the rewrite. Details:
`finished_work/lint-hardening-leaf-19-scripts-code-intel-server-and-logs-audit-test-adoption.md`.

## Slice 2 Deferral (2026-05-19)

`scripts/generate-harness-controls.ts` was probed as the next sibling.
Two findings surfaced: `resolveNonLintControl` cyclomatic complexity 13
vs the 10 ceiling, and 384 effective lines vs the 300 `local/max-lines`
ceiling. Either repair path (structural split or a targeted warn-only
override above the current line count) is a local debt decision the
autonomous slice declined to make on its own. Verdict: defer until a
leaf with explicit budget picks the repair. Details:
`finished_work/lint-hardening-leaf-19-scripts-generate-harness-controls-deferral.md`.

Remaining script families (codemods, drift-ai, logs-audit, top-level
utilities, `scripts/harness-check.ts`, `scripts/lint-agent.ts`,
`scripts/lint-ratchet*.ts`) stay parked until a promoted leaf adds
current-count ratchet coverage, records a concrete ratchet blocker, or splits
the inventory into tractable single-file or feature-family slices.

Concrete ratchet-first/drain leaves drafted from those deferrals:

- `30-generate-harness-controls-lint-adoption.md`
- `31-code-intel-facade-lint-adoption.md`
- `32-drift-ai-under-ceiling-lint-adoption.md`
- `33-drift-ai-report-family-lint-adoption.md`
- `34-drift-ai-inventory-family-lint-adoption.md`
- `35-codemod-test-harness-lint-adoption.md`
- `36-codemod-concurrency-and-logging-lint-adoption.md`
- `37-codemod-barrel-and-trpc-lint-adoption.md`
- `38-top-level-script-project-lint-adoption.md`
- `39-ratchet-runtime-script-lint-adoption.md`
- `40-logs-audit-and-drift-entrypoint-lint-adoption.md`

## Re-probe (2026-05-20) — code-intel.ts typeof-import rewrite stays deferred

The autonomous slice probed the slice 4 deferral again after the loop
sentinel asked it to reconsider. Confirmed: the 9 `typeof import()`
annotations are not autofixable (only the lone `simple-import-sort/
exports` finding has an autofix). The remaining 9 errors require a
manual rewrite of every module type alias (lines 21–29) to a top-level
`import type * as X from "./y.js"` declaration. That is a structural
source rewrite, not the three-narrow-config-additions adoption pattern
the autonomous slice uses. Verdict unchanged: defer until a leaf with
explicit human budget picks the rewrite. No commits landed; the
`feature/lint-hardening-leaf-19-code-intel-typeof-import-rewrite`
branch was deleted.

## Problem

ESLint now covers package code, code-intel scripts, and drift scripts. Other
TypeScript script families covered by `tsconfig.scripts.json` remain outside
the lint gate unless they live in an already re-included path.

## Scope

Continue script coverage one family at a time after the codemod surface is
handled or explicitly left as its own exception.

Candidate families:

- doctor and diagnostic emitters;
- verify wrappers and log tools;
- migration and Prisma safety tools;
- top-level TypeScript utilities;
- sensor scripts not already covered by package or drift config.

## Candidate Work

- Inventory `tsconfig.scripts.json` inputs against `eslint.config.js` ignored
  paths.
- Pick one family and add a config block pointing at
  `./tsconfig.scripts.json`, using the existing code-intel/drift shape.
- Decide whether CLI stdout scripts may keep `console.log` as their interface
  or should use a shared script logger.
- Add current-count ratchet coverage before cleanup, then drain the family to
  zero warnings/errors before enabling normal ESLint coverage.
- Record any family-level exception in the verdict register.

## Exit Criteria

- One additional script family is covered by `bun run lint`, or a reasoned
  deferral is recorded with the current finding inventory.

## Verification

- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- `bun run test:scripts:changed`
- Focused shell smoke for the script family touched
- `bun run verify:changed`
