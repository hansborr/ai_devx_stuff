# 19. Recursive readdirSync directory-walk duplicated across four codemod path modules

Status: Done (2026-06-13) — implemented on feat/drift-ai-findings-2026-06
Theme: duplication · Area: tooling · Severity: quality-low · Size: S-M
Source: drift:ai clone-candidates (drift-baseline; 4 of 4 sites re-confirmed) · Confidence: med

## Problem
The recursive `readdirSync(dir, { withFileTypes: true })` -> recurse subdirs -> `statSync().isFile()` gate -> extension filter -> push -> `sort(localeCompare(..., "en"))` walker is hand-rolled four times across production codemod path modules. The bodies are near-identical; they vary only in (a) the directory skip rule, (b) the file-extension filter, and (c) relative-vs-absolute output:

- `concurrency-guard/paths.ts` `discoverFiles` — `.ts` only, `path.relative(root, ...)` output, `isExcludedPath` post-filter.
- `structured-logging-fix.ts` `discoverFiles` — `.ts` only, relative output, then a *second* flat `readdirSync` loop for prisma seed files.
- `expand-barrel/paths.ts` `discoverPackageFiles` — `skippedDirectories = new Set(["dist","generated","node_modules"])`, `.tsx?` minus `.d.ts`, *absolute* `currentPath` output.
- `lib/trpc-shared-schema-paths.ts` `discoverRouterFiles` — `.ts` minus `.test.tsx?`, relative output.

This is an error-prone duplication class: the four copies have already drifted (some skip via a `Set`, some via post-filter; some emit absolute paths, some relative; one guards the root with `existsSync` inline, one guards it at the call site). A future change to the traversal (e.g. symlink handling, a new always-skip dir like `.git`) must be applied in four places or silently diverge. `scripts/codemods/lib/` already exists as the shared home and currently has no fs/walk helper, so there is a clean landing spot.

## Evidence
- `scripts/codemods/concurrency-guard/paths.ts:22-40` — `discoverFiles` inner `visit()`: `readdirSync(withFileTypes)` recursion, `.ts` filter, relative push, locale sort (confirmed).
- `scripts/codemods/structured-logging-fix.ts:146-171` — `discoverFiles` inner `visit()` at 148-161 (walk skeleton), plus a separate flat prisma-seed `readdirSync` loop at 164-169 (confirmed; spec said 146-167, walk skeleton extends to 171).
- `scripts/codemods/expand-barrel/paths.ts:49-71` — `discoverPackageFiles`; inner `visit()` walk at 55-67 differs in skip-`Set` (`dist`/`generated`/`node_modules`) and `.d.ts` exclusion + `.tsx?` filter, emits *absolute* paths (confirmed; spec cited 52-70, the function spans 49-71).
- `scripts/codemods/lib/trpc-shared-schema-paths.ts:31-51` — `discoverRouterFiles`; same skeleton, `.ts` minus `.test.tsx?`, relative output (confirmed; spec said 31-50, function ends at 51).
- `scripts/codemods/lib/` — directory exists, no fs/walk helper present, no `*.test.ts` yet (confirmed via `ls`/`rg`).

## Proposed fix
1. Add `scripts/codemods/lib/walk-ts-files.ts` exporting a parameterized walker, e.g.:
   `export function walkTsFiles(roots: string[], opts: { include: (absPath: string) => boolean; skipDir?: (name: string) => boolean; relativeTo?: string }): string[]` — does the recursive `readdirSync(withFileTypes)` + `statSync().isFile()` gate + `existsSync` root guard + locale sort, returns absolute paths unless `relativeTo` is set (then `path.relative(relativeTo, ...)`).
2. TDD first: add `scripts/codemods/lib/walk-ts-files.test.ts` (no lib test exists yet) covering: recursion into subdirs, `skipDir` pruning, `include` filter, relative-vs-absolute output, missing-root returns `[]`, and stable locale sort. Use a temp dir fixture (`mkdtempSync`/`os.tmpdir()`), matching the existing scripts vitest project conventions.
3. Migrate each call site to delegate to `walkTsFiles`, keeping each module's *post-filter* semantics intact:
   - `concurrency-guard/paths.ts`: `walkTsFiles([join(root, SERVER_SRC_ROOT)], { include: p => p.endsWith(".ts"), relativeTo: root })`, then keep the existing `isExcludedPath` filter on the result.
   - `structured-logging-fix.ts`: replace the recursive `visit` with `walkTsFiles` over both `SERVER_SRC_ROOT` and `SERVER_SCRIPTS_ROOT`; leave the separate flat prisma-seed loop as-is (it is non-recursive and intentionally distinct).
   - `expand-barrel/paths.ts`: `walkTsFiles([packageRoot], { include: p => /\.tsx?$/u.test(p) && !p.endsWith(".d.ts"), skipDir: n => ["dist","generated","node_modules"].includes(n) })` with no `relativeTo` (preserve absolute output).
   - `lib/trpc-shared-schema-paths.ts`: `walkTsFiles([routerRoot], { include: p => p.endsWith(".ts") && !/\.test\.tsx?$/u.test(p), relativeTo: root })`.
4. Run `bun run test:scripts:file -- scripts/codemods/lib/walk-ts-files.test.ts`, then the four existing codemod suites (`concurrency-guard.test.ts`, `structured-logging-fix.test.ts`, `expand-barrel.test.ts`, `trpc-shared-schema-codemod.test.ts`) to confirm behavior is unchanged.

## Verification / caveats
- Behavior-preservation is the whole point: each call site currently differs subtly (skip-as-Set vs post-filter, absolute vs relative output, `existsSync` root guard placement). The helper must support all three axes or a site will regress. Verify the `expand-barrel` absolute-path output and the `structured-logging-fix` second prisma loop are preserved exactly — these are the easiest to break.
- `structured-logging-fix.ts` has the inner recursive `visit` *and* a flat prisma-seed loop in the same function; only the recursive part is the clone. Do not fold the flat loop in.
- Low false-positive risk: this is a genuine clone with an existing shared home, not a coincidental shape. Scope is the four scripts/codemods modules only; do not pull in unrelated fs-walk code elsewhere in the repo.
- The four codemod suites today exercise these walkers only end-to-end; the new direct unit test on `walkTsFiles` is the safety net for the extraction and should land first per the repo TDD norm.
