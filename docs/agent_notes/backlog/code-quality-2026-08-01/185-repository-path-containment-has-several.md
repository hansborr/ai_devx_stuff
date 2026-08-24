# 185. Repository path containment is implemented through incompatible local contracts

Status: Not started
Theme: repository path safety · Area: cross-cutting · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Repository tooling repeatedly resolves and relativizes paths, but it has no shared answer for what “inside the repository” means. Local implementations disagree about whether the root itself is accepted, whether `..` is checked as a path segment or a string prefix, and whether lexical containment is enough. The harness projection path additionally rejects symlink traversal and verifies physical containment, while analyzer helpers generally do neither.

These differences are semantic, not stylistic. A broad `startsWith("..")` rejects a legitimate child named `..config`; a separator-only `startsWith("../")` check misses the bare parent result `".."`; and a writer that copies an analyzer's lexical helper loses the existing symlink protections. Contributors adding harness or codemod tooling must rediscover these edge cases and cannot identify the correct contract from a helper's name.

The reusable public pattern should be explicit: lexical containment for read-only analysis, hardened target resolution for anything that writes or deletes.

## Evidence

- `scripts/codemods/concurrency-guard/cli.ts:61-68` — a write-oriented codemod resolves and relativizes its input, rejects any result whose string begins with `..`, and separately enforces the `.ts` policy.
- `scripts/codemods/structured-logging-fix.ts:111-119` and `scripts/codemods/expand-barrel/barrel-context.ts:38-45` — two more writer-side tools independently repeat the same broad-prefix containment shape.
- `scripts/codemods/lib/trpc-shared-schema-paths.ts:14-28` and `:54-62` — this single module contains two separate resolve/relative/escape checks, one for a router path and one for a generated shared-schema target.
- `scripts/code-intel/path-utils.ts:7-14` — analyzer tooling exposes `isInside`, which excludes the root, and `isSameOrInside`, which accepts it; both inherit the broad `startsWith("..")` behavior.
- `scripts/harness/skill-projection-files.ts:30-47` — harness projection first requires a normalized repo-relative POSIX path, then checks lexical containment before resolving a target.
- `scripts/harness/skill-projection-files.ts:50-69` — the same writer path walks every existing component with `lstatSync`, rejects symlinks, preserves early returns for nonexistent targets, and verifies existing targets against real paths.
- `scripts/lib/git.ts:150-164` — Git exclusion handling uses the separator-aware `repoRelative.startsWith(".." + sep)` form but does not reject `repoRelative === ".."`; `path.relative` returns exactly `".."` for the root's parent.
- `scripts/sensor-near-duplicates-baseline-io.ts:32-41` — another read-only consumer handles both the bare `".."` case and the separator-prefixed case explicitly.
- `scripts/worktree-seed-import-closure.ts:55-58`, `scripts/harness/control-field-validation.ts:68-76`, `scripts/harness/registration-generated-checks.ts:39-42`, and `scripts/lib/lint-rule-docs.ts:73-76` — four read-only areas privately implement same-or-inside predicates with broad prefix checks.
- A re-derived production-source search found 24 `startsWith` checks involving `..` under `scripts/`; the examples above include broad-prefix containment, separator-aware containment, and string-shape policy checks that must not all be treated as interchangeable.
- `scripts/harness/skill-artifact-projection.ts:20-21` and `:123-165` — the hardened helpers are imported outside their defining file, so extraction requires either compatibility re-exports or coordinated caller migration.

## Proposed direction

Split the implementation into two reviewable slices.

1. **Slice A — introduce the shared contracts and migrate writers.**

   Create `scripts/lib/repo-path.ts` with focused tests beside it, matching the existing `scripts/lib/git.ts` / `git.test.ts` and `records.ts` / `records.test.ts` organization.

   The lexical core should be:

   ```ts
   repoRelativeIfInside(root, target): string | null
   ```

   It resolves and relativizes the target and rejects escapes with the separator-boundary-correct condition:

   ```ts
   rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)
   ```

   Build two thin, deliberately named predicates on that core: `isStrictlyInsideRepo`, which excludes the root, and `isSameRepoOrInside`, which accepts it. Do not replace that distinction with a boolean flag; call-site intent must remain greppable.

   The hardened writer primitive should be named along the lines of:

   ```ts
   resolveRepoWriteTarget(repoRoot, path, context): string
   ```

   Lift the normalized repo-relative validation, lexical check, per-component symlink walk, and realpath containment from `scripts/harness/skill-projection-files.ts:30-69`. Preserve the existing `existsSync` early returns and behavior exactly. Keep `assertRepoRelativePath` and `assertInsideRepo` available through compatibility re-exports or migrate their dependents in `skill-artifact-projection.ts` in the same slice.

   JSDoc must explain the reusable choice plainly: analyzers and other read-only consumers use lexical containment; anything that may write or delete uses hardened target resolution.

   Migrate the writer/codemod family in this slice: `concurrency-guard/cli.ts`, `structured-logging-fix.ts`, `expand-barrel/barrel-context.ts`, the applicable target checks in `expand-barrel/paths.ts`, and both containment copies in `codemods/lib/trpc-shared-schema-paths.ts`. Keep tool-specific rules such as `.ts` extensions, router-directory restrictions, test-file exclusions, and package-export policy at their call sites.

   Tests must pin root acceptance, the bare parent `".."`, acceptance of an in-repository child literally named `..config`, absolute escapes, normalized-path rejection, symlink components, and physical escapes. Retain the existing no-mutation projection coverage in `scripts/harness/skill-artifact-projection.test.ts:344-380`.

2. **Slice B — migrate read-only analyzers.**

   Replace the local resolve/relative containment shapes in `code-intel/path-utils.ts`, `lib/git.ts`, `backlog-lint.ts`, `sensor-near-duplicates-baseline-io.ts`, `worktree-seed-import-closure.ts`, `harness/control-field-validation.ts`, `harness/registration-generated-checks.ts`, `lib/lint-rule-docs.ts`, `path-policy/fixture-copy-expressions.ts`, `drift-ai/source-walk.ts`, and `drift-ai/import-cycles-graph.ts`.

   Preserve each caller's deliberate policy around the shared result: code-intel's `samePath` and slash normalization, Git pathspec formatting, display-path fallback behavior, path-policy normalization, and analyzer-specific “external” classifications remain local.

   Add or adjust caller tests where the new separator-correct behavior changes an edge case. In particular, `gitExclusionPathspecs` should reject the root's parent, while broad-prefix callers should stop rejecting the valid `..config` child.

## Scope / caveats

- Do not migrate validators that only inspect untrusted configuration text before resolution, including `drift-ai/config-paths.ts`, `harness-freshness.ts`, `module-doc-paths.ts`, and `dead-code-corpus-labels.ts`, unless inspection finds a genuine resolve-then-relativize operation. Their string-shape policies are not automatically containment checks.
- Path handling under `packages/*` and `eslint-config` is out of scope.
- Do not change path-policy vocabulary internals. The 2026-07-25 pack already unified that directory's smoke-file and normalization vocabulary through [31-harness-shared-helpers.md](../code-quality-2026-07-25/31-harness-shared-helpers.md) slice H14 and [49-path-policy-fixture-analyzer.md](../code-quality-2026-07-25/49-path-policy-fixture-analyzer.md); this leaf adds a cross-tree containment contract and must not reopen those rulings.
- The behavior change from broad prefix matching to separator-correct matching is intentional. Every migrated family needs an edge-case test so it is visible in review.
- Preserve the hardened helper's symlink and physical-containment behavior during extraction; simplifying it to the lexical primitive would be a security regression for writers.
- Coordinate slice B softly with [152-path-policy-query-core-closed-over-musis.md](./152-path-policy-query-core-closed-over-musis.md) and [109-musi-repository-policy-embedded-throughout.md](./109-musi-repository-policy-embedded-throughout.md). There is no hard ordering, but if either lands first, re-run the caller inventory because path-policy or code-intel call sites may have moved.
