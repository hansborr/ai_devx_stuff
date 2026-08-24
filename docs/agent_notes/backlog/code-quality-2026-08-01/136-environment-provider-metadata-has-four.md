# 136. Environment-provider metadata is enumerated independently in four places with nothing enforcing exhaustiveness

Status: Landed on fix/cq-136
Theme: descriptor-table single-sourcing · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The drift-ai `env-branches` advisory understands four environment providers
(`process.env`, `import.meta.env`, `Bun.env`, and define substitution), but no
single place in the code says so. The provider set is hand-enumerated
independently in the matrix type and read-kind union, in the config parser's
key table plus five hand-written conditional assignments, in the advisory's
table-collection helper, and in read-resolution's kind→table fallback mapping —
and a fifth per-provider fact (which read kinds a bundler folds statically)
lives in yet another hand-written set. Nothing derives any of these sites from
another and no exhaustiveness check links them, so adding or renaming a
provider is four-to-five synchronized hand edits across as many files, and a
missed one fails silently rather than at compile time. The shape of that
silent failure is already visible: `readEnvAssumption` maps three read kinds
to their tables and quietly returns `undefined` for the fourth (`"define"`),
which happens to be correct today only because define reads resolve through a
separate code path. A contributor extending this subsystem has to rediscover
the full site list by grep every time.

## Evidence

- `scripts/drift-ai/env-define-types.ts:8-16` — `EnvDefineMatrix` hand-enumerates
  the five optional tables (`env`, `processEnv`, `importMetaEnv`, `bunEnv`,
  `defines`); line 18 separately enumerates `EnvDefineReadKind` as
  `"process.env" | "import.meta.env" | "Bun.env" | "define"`. Neither is derived
  from the other.
- `scripts/drift-ai/env-define-matrix-config.ts:15` — `TABLE_KEYS` const repeats
  the five table names; `:19-25` — `MutableMatrix` repeats them as a type;
  `:33-45` — five hand-written `if (record["…"] !== undefined)` assignments
  repeat them a third time in the same file; the file-header prose at `:2-3`
  enumerates them a fourth time.
- `scripts/drift-ai/env-branches-advisory.ts:257-267` — `matrixTables()`
  hand-lists all five matrix properties to collect configured tables.
- `scripts/drift-ai/env-branches-advisory.ts:94-97` — `STATIC_INLINE_KINDS`
  hand-lists which read kinds a bundler inlines statically (`"define"`,
  `"import.meta.env"`): a fifth per-provider metadata site the others know
  nothing about.
- `scripts/drift-ai/env-define-reads.ts:209-224` — `readEnvAssumption()`
  independently maps three read kinds to their table plus the shared
  `matrix.env` fallback; `"define"` falls through to `return undefined`
  (`:223`) with no comment. Define reads are actually resolved by a separate
  path at `:41-48`, so the fall-through is unreachable-by-convention rather
  than by construction.
- The subsystem next door already uses the registry-table idiom this leaf asks
  for: `scripts/drift-ai/check-registry.ts:23` (`CHECK_PLUGINS`) and
  `scripts/drift-ai/check-metadata.ts:29` (`CHECK_METADATA`) are as-const
  tables that downstream types and lookups derive from.

## Proposed direction

Define one typed provider descriptor table containing config key, read kind,
and fallback policy; derive parsing, enumeration, and lookup from it.

Concretely, in the env-define family:

1. Add an as-const descriptor table with **four** rows, one per provider, each
   carrying `{ configKey, readKind, sharedEnvFallback, staticInline }` —
   `configKey` the matrix table name (`processEnv`, `importMetaEnv`, `bunEnv`,
   `defines`), `readKind` the corresponding `EnvDefineReadKind` member,
   `sharedEnvFallback` whether `matrix.env` backstops a miss (`true` for the
   three env-object kinds, `false` for `"define"`), and `staticInline` whether
   a bundler folds the read statically (currently `"define"` and
   `"import.meta.env"`). No type assertions are needed; `as const` plus derived
   mapped types is the same pattern `CHECK_PLUGINS`/`CHECK_METADATA` already
   use.
2. Keep the `env` matrix table as a special-cased key beside the descriptor
   rows — it is a provider-agnostic shared fallback (see the comment at
   `env-define-types.ts:9-11`), not a fifth provider, and must not become a
   descriptor row.
3. Derive the current hand-written surfaces from the table:
   - `EnvDefineMatrix` and `EnvDefineReadKind`
     (`env-define-types.ts:8-18`) become mapped/derived types (the matrix type
     is the descriptor's config keys plus the special `env` key).
   - `TABLE_KEYS` and the five conditional assignments
     (`env-define-matrix-config.ts:15,33-45`) collapse to the descriptor keys
     plus a loop over them (the `env` key joins the loop; per-key behavior is
     identical).
   - `matrixTables()` (`env-branches-advisory.ts:257-267`) enumerates the
     descriptor rows plus `env`.
   - `readEnvAssumption()` (`env-define-reads.ts:209-224`) becomes a
     descriptor lookup honoring the `sharedEnvFallback` flag, making the
     `"define"` no-fallback case explicit instead of a silent fall-through.
   - `STATIC_INLINE_KINDS` (`env-branches-advisory.ts:94-97`) derives from the
     `staticInline` flag.
4. Update the parser's file-header prose (`env-define-matrix-config.ts:1-8`),
   which hardcodes the five table names, in the same change.

Existing suites pin the current behavior and must stay green throughout —
`scripts/drift-ai/env-define-matrix-config.test.ts`,
`env-define-evaluator.test.ts`, `env-branches-advisory.test.ts`, and
`env-branches-command.test.ts`; run one with
`bun run test:scripts:file -- scripts/drift-ai/env-define-matrix-config.test.ts`.

## Scope / caveats

- **Do not push AST detection into the descriptor.** `envObjectKind`
  (`env-define-reads.ts:141-147`) and the define-identifier matching
  (`:41-48`) are shape-specific matchers; a new provider legitimately needs a
  hand-written matcher. The win is that the descriptor-derived kind union
  makes parsing, enumeration, lookup, and static-inline classification
  exhaustive — a new descriptor row without a matcher should fail typecheck
  or an exhaustiveness switch, not silently no-op.
- **The `env` table is not a provider.** It has no read kind and no matcher;
  modeling it as a descriptor row would force nullable fields through every
  derived surface. Keep it a special-cased sibling key (step 2 above).
- This is an in-family single-sourcing change, not a restructuring of
  `scripts/drift-ai`; no files move and no subdirectories are introduced.
- Distinguish this from over-abstraction concerns about descriptor maps in
  small co-located code: here the duplication spans four-to-five files with
  real cross-file exhaustiveness risk, in a subsystem where registry tables
  are already the house idiom.
- The live 2026-07-25 pack's `44-comment-archaeology.md` is landed, but
  `SERVER-COMMENTS-PLAN.md` permanently dropped its 60-plus bare-coordinate
  sweep, including the stale task-number prefix in
  `env-define-matrix-config.ts`. Step 4 still rewrites that header for provider
  accuracy; remove or qualify the stale prefix incidentally rather than
  treating CQ25-44 as scheduled work.
- `scripts/drift-ai` has no `MODULE.md`, so no module-doc update is required;
  the only prose to correct is the parser header covered in step 4.
