# 149. Give reusable codemod infrastructure a neutral home outside the tRPC schema family

Status: Landed on fix/cq-149
Theme: codemod foundations · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The codemod library has reusable foundations for errors, ts-morph project
construction, import normalization, and preview/write orchestration, but those
foundations live in files named for the tRPC shared-schema codemod and are
re-exported through its domain barrel.

Consequently, unrelated barrel-expansion, structured-logging, and concurrency
codemods learn that generic infrastructure comes from
`trpc-shared-schema.js`. Domain-specific candidate discovery, path policy, and
schema rewriting are exposed through the same surface. This obscures ownership,
encourages further growth of the grab bag, and makes the harness harder for an
outside reader to copy selectively.

Import normalization also has multiple owners within that misleading surface.
Structured-logging and expand-barrel normalize their transformed text while
constructing write plans, after which the shared writer reparses and normalizes
every plan again. Real writes then receive a separate ESLint import-sorting
pass that dry runs skip. Besides repeating full-file parsing, this layering
leaves the relationship between previewed, fallback, and successfully
ESLint-fixed output implicit.

## Evidence

- `scripts/codemods/lib/trpc-shared-schema.ts:1-7` is a seven-module barrel
  combining candidate, identifier, import, path, type, validation, and write
  modules.
- `scripts/codemods/lib/trpc-shared-schema-types.ts:12-30` defines generic import
  and write-plan types beside tRPC schema types; `:47-69` defines
  `CodemodError`, `fail`, and generic ts-morph project construction.
- `scripts/codemods/lib/trpc-shared-schema-imports.ts:10-11`,
  `:125-168`, and `:170-192` provide generic module-source lookup, import-block
  sorting, and named-import insertion inside a tRPC-named file.
- `scripts/codemods/lib/trpc-shared-schema-writes.ts:95-106` contains generic
  unused-import removal, while `:108-162` implements ESLint import fixing and
  preview/write orchestration.
- `scripts/codemods/lib/trpc-shared-schema-identifiers.ts:166-182` exports the
  generic reference-identifier predicates used by the write path.
- `scripts/codemods/expand-barrel/run.ts:6-12` imports `WritePlan`,
  `createProject`, `moduleSource`, `sortImportBlocks`, and
  `writeOrPreviewFiles` through the tRPC barrel.
- `scripts/codemods/structured-logging-fix.ts:7-12` imports generic project,
  failure, and write helpers from the same barrel;
  `scripts/codemods/concurrency-guard/run.ts:1-2` does the same for
  `CodemodError` and `createProject`.
- `scripts/codemods/structured-logging-fix-transforms.ts:324-328` passes the
  transformed text through `sortImportBlocks` while constructing its rewrite
  result.
- `scripts/codemods/expand-barrel/run.ts:26-42` passes every changed source
  through `sortImportBlocks` before handing its plans to
  `writeOrPreviewFiles`.
- `scripts/codemods/lib/trpc-shared-schema-writes.ts:135-161` maps every incoming
  plan through `sortImportBlocks` again, returns after reporting normalized
  byte counts in dry-run mode, and invokes the ESLint import fix only after
  real files have been written.
- `scripts/codemods/lib/trpc-shared-schema-imports.ts:125-167` shows that each
  `sortImportBlocks` call creates a new ts-morph `Project`, reparses the full
  source, calculates replacement ranges, and reconstructs the text.
- Measurement at the pin: the exact command
  `rg -l 'trpc-shared-schema\.js' scripts --glob '*.ts' | wc -l` returns 21
  TypeScript files that directly import `trpc-shared-schema.js`.
- Measurement at the pin: the exact command
  `rg -l 'trpc-shared-schema\.js' scripts/codemods/{concurrency-guard*,expand-barrel*,structured-logging-fix*} --glob '*.ts' | wc -l`
  returns 13 files in the unrelated expand-barrel, structured-logging, and
  concurrency families.
- `scripts/tests/test-test-scripts.sh:447-458` uses two tRPC helper paths as
  examples proving that shared codemod-library changes select all five codemod
  smokes.
- Measurement at the pin: the exact command
  `for file in scripts/tests/test-codemod-*.sh; do rg -q '^# smoke-subjects: scripts/codemods/lib/$' "$file" && printf '%s\n' "$file"; done | wc -l`
  returns five, confirming that every codemod smoke header registers the
  `scripts/codemods/lib/` directory prefix.

## Proposed direction

Create neutral, function-oriented modules under `scripts/codemods/lib/`:

- `codemod-errors.ts` owns `CodemodError` and `fail`.
- `codemod-project.ts` owns `createProject`. Keep `getSourceFileAtPath` in the
  tRPC path family because its only consumers at the pin are the tRPC input and
  engine paths.
- `codemod-imports.ts` owns `moduleSource`, `sortImportBlocks`, and
  `ensureNamedImport`. Keep `removeUnusedNamedImport` and the
  `isReferenceIdentifier` / `referencedIdentifiers` predicates in the tRPC
  family until a non-tRPC consumer needs them.
- `codemod-writes.ts` owns `WritePlan`, `writeOrPreviewFiles`, and
  `runEslintImportFix`.

Move `ImportSpecifierInfo` and `WritePlan` alongside the neutral functions
that non-tRPC codemods use. Keep `ImportBinding` and `TargetIdentifiers` in the
tRPC family because no non-tRPC consumer uses them. Keep
`removeUnusedNamedImport` in the domain write module and keep
`runEslintImportFix` private inside the neutral write orchestration; neither
needs a new public export.

Keep schema- and router-specific behavior in the
`trpc-shared-schema-{types,paths,candidates,identifiers,imports,validation,writes}.ts`
family: `SHARED_SCHEMA_PREFIX`, router/shared roots, shared-schema candidates,
schema-name validation, shared export insertion, router reference rewriting,
shared-value import collection, and allowlisted router-import collection.
Those modules should consume the neutral core exactly like other codemods.

Repoint expand-barrel, structured-logging, concurrency-guard, and the tRPC
input/output entrypoints to the focused modules they use. Remove the generic
names from the `trpc-shared-schema.ts` re-export surface rather than retaining
compatibility exports; otherwise the misleading dependency remains available.
The `trpc-shared-engine*` files may receive the minimal import repointing needed
after those exports disappear, but their behavior and structure are not part of
this refactor.

As part of that post-extraction repointing, remove the producer-side
`sortImportBlocks` import and call from structured-logging and expand-barrel.
Those producers should submit their transformed text directly, leaving
`writeOrPreviewFiles` as the sole owner of the custom normalization pass for
each write plan.

Retain the subsequent ESLint fix only as an explicit real-write policy and
document its relationship to the shared normalized plan. Add focused parity
coverage using deliberately unsorted imports: prove that dry-run byte reporting
is based on the same once-normalized text that the real-write path emits before
or without a successful ESLint pass, and characterize a successful ESLint fix
as the only deliberate output divergence. Also cover the existing warning
fallback so an unavailable or failed ESLint pass leaves the custom-normalized
file intact.

Use the four existing codemod Vitest files and the five existing
`scripts/tests/test-codemod-*.sh` smokes as the regression surface. Finish with
a source search proving that no non-tRPC codemod imports from
`lib/trpc-shared-schema*` and that structured-logging and expand-barrel no
longer normalize plans before calling the shared writer.

## Scope / caveats

- Extract only neutral helpers used outside the tRPC family and the internal
  dependencies those helpers require. Do not turn this into a complete
  generic/domain classification of every codemod helper.
- Do not merge the distinct tRPC input/output candidate finders, refactor
  `trpc-shared-engine*`, or rename codemod entrypoints and test files. Apart
  from removing the redundant producer-side custom-normalization calls,
  preserve emitted output unless a separately characterized ESLint difference
  is deliberately accepted.
- Perform the normalization-ownership cleanup inside or after the neutral
  extraction. Do not first edit the pre-extraction tRPC-named helper and its
  callers and then repeat those edits after moving the code.
- Keep the ESLint pass scoped to its current role as a real-write post-pass;
  this leaf does not propose a broader codemod framework or a replacement
  formatting pipeline.
- New core files must stay under `scripts/codemods/lib/`. The directory-prefix
  smoke registration then continues to select all codemod smokes without
  regenerating subject data.
- Because `trpc-shared-schema.ts` and
  `trpc-shared-schema-imports.ts` remain legitimate domain files, the example
  paths at `scripts/tests/test-test-scripts.sh:447-458` need change only if an
  implementation actually removes or renames either file. If changed, update
  the literals and their descriptive assertions together.
- Check the barrel's transitive exports after repointing. Leaving a generic
  helper reachable through `export *` would preserve the architectural problem
  even if direct imports happened to move.
- `eslint-config/shared-policy.js:95-100` registers
  `trpc-shared-schema-codemod.test.ts`; this leaf does not rename that test.
- Prior-pack record CQ25-81 in [CONSTRAINTS.md](../code-quality-2026-07-25/CONSTRAINTS.md) establishes one boundary for this extraction: do not merge the codemod input/output candidate finders; no other prior-pack dependency applies.
