# 27. worktreeTestDatabaseSlug DB-naming parser duplicated verbatim across two server test-db modules

Status: Done (2026-06-13) — implemented on feat/drift-ai-findings-2026-06
Theme: duplication · Area: tooling · Severity: quality-low · Size: XS

## Problem
The worktree test-database naming convention — prefix `musi_wt_`, suffix `_test`, slug charset `/^[a-z0-9_]+$/` — is hard-coded twice, byte-for-byte, in the private helper `worktreeTestDatabaseSlug`:

```ts
function worktreeTestDatabaseSlug(databaseName: string): string | null {
  const prefix = "musi_wt_";
  const suffix = "_test";
  if (!databaseName.startsWith(prefix) || !databaseName.endsWith(suffix)) return null;
  const slug = databaseName.slice(prefix.length, -suffix.length);
  if (!/^[a-z0-9_]+$/.test(slug)) return null;
  return slug;
}
```

This appears identically in `test-database-url.ts:94-101` and `worker-test-database.ts:296-303`. Both modules also consume the parsed slug to *produce* a DB name with the same `musi_wt_` literal re-embedded (`test-database-url.ts:90`, `worker-test-database.ts:284`). The two parsers are inherently coupled to each other and to the producers: changing the scheme in one copy (e.g. widening the slug charset, or renaming the prefix) without the other silently breaks worktree-DB resolution — worker DBs would be derived under one convention and matched/cleaned under another, with no compile error. That is exactly the kind of split-brain a single source of truth prevents. Clears the bar as a low-risk dedup that removes ~8 duplicated lines and consolidates a shared naming contract.

Note: `worker-test-database.ts` already imports from `test-database-url.ts` (line 5: `databaseNameFromUrl`, `workerDatabaseRegistryPath`), so the extraction adds a named import on an existing edge — zero new module-dependency.

## Evidence
- `packages/server/src/test/test-database-url.ts:94-101` — canonical `worktreeTestDatabaseSlug` (parser). Producer at line 90 builds `musi_wt_${worktreeSlug}_w${workerKey}`.
- `packages/server/src/test/worker-test-database.ts:296-303` — byte-for-byte identical copy of `worktreeTestDatabaseSlug`. Producer at line 284 builds `musi_wt_${slug}_w`; used via `worktreeWorkerPrefix` at line 282.
- `packages/server/src/test/worker-test-database.ts:5` — pre-existing import edge from `./test-database-url.js`.
- `packages/server/src/test/prepare-test-db.ts:25-27` — adjacent (not identical): the same convention re-expressed as a regex string `musi_wt_${WORKTREE_SLUG_PATTERN}...` with `WORKTREE_SLUG_PATTERN = "[a-z0-9_]{1,49}"`. Third re-embedding of the `musi_wt_` literal + slug charset.

## Proposed fix
1. In `test-database-url.ts`, hoist the two literals to module constants near the existing ones (e.g. `const WORKTREE_DB_PREFIX = "musi_wt_";` / `const WORKTREE_DB_SUFFIX = "_test";`) and rewrite `worktreeTestDatabaseSlug` to use them. Use those constants in the producer at line 90 too (`musi_wt_${...}` → `${WORKTREE_DB_PREFIX}${...}`).
2. `export` `worktreeTestDatabaseSlug` (and, if useful for prepare-test-db, the prefix constant) from `test-database-url.ts`.
3. In `worker-test-database.ts`: delete the local `worktreeTestDatabaseSlug` (lines 296-303), add `worktreeTestDatabaseSlug` to the existing import on line 5, and rewrite the producer at line 284 to reuse the exported prefix constant.
4. (Optional, separate scope) consider deriving `prepare-test-db.ts`'s `WORKTREE_TEST_DB_PATTERN` prefix from the shared constant so the regex cleanup matcher cannot drift from the parser. Leave the slug-length cap (`{1,49}`) where it is — it encodes the Postgres 63-byte identifier limit and is regex-only.
5. TDD: `test-database-url.test.ts` already exercises `musi_wt_feature_branch_abc123_test` round-trips (lines 72-75, 98-107). Add an assertion that the now-exported `worktreeTestDatabaseSlug` returns the slug for a valid name and `null` for a non-worktree name; the existing worker-DB-matching tests cover the `worker-test-database.ts` consumer path. No behavior change expected — tests should pass unmodified after the refactor.

## Verification / caveats
- False-positive risk: low. The two functions are literally identical (same constants, same regex, same slice logic), confirmed by re-reading both. This is genuine dedup, not coincidental similarity.
- Scope boundary: test-only internal helper, not part of the product runtime; blast radius is the server vitest harness. `worktreeTestDatabaseSlug` is currently un-exported in both files (`code:intel`/rg show no cross-file references beyond the two local definitions), so exporting it is the only API surface change.
- Implementer should double-check: after exporting, run `bun run --filter @musi/server test -- test-database-url.test.ts` and the worker-DB tests, plus the prepare-test-db cleanup path, to confirm worker-DB derivation and the `_test`/`_w<key>` matchers still agree. Keep the producer literals and parser constants pointing at the *same* constant — the whole point is one definition.
- A config-suppression is not appropriate here: this is a real (if small) maintainability fix, not a tolerated near-duplicate.
