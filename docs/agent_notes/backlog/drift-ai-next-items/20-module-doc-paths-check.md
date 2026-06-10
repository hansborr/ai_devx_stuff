# 20 - module-doc path freshness check

Status: Done
Track: A
Size: small-medium
Depends on: none
Blocks: none

## Goal

Add a report-only drift check that validates backtick file/path references in
`MODULE.md` and `*-MODULE.md` files.

## Background

`harness-freshness` already validates backtick paths in `docs/ai-harness.md`.
The harness review found the same drift class in module docs, but no sensor
covers those files. This task checks path existence only; symbol existence stays
deferred.

## Seams to touch

- `scripts/drift-ai/harness-freshness.ts`
- `scripts/drift-ai/harness-freshness-io.ts`
- `scripts/drift-ai/types.ts`
- `scripts/drift-ai/check-metadata.ts`
- `scripts/drift-ai/check-registry.ts`
- tests beside `harness-freshness` or a new focused check test
- `scripts/drift-ai/README.md`
- `docs/ai-harness.md`

## What to do

1. Extract reusable backtick path parsing/checking helpers from
   `harness-freshness` if needed.
2. Add a new check id, recommended name `module-doc-paths`.
3. Scan:
   - `packages/**/MODULE.md`;
   - `packages/**/*-MODULE.md`;
   - any small area docs chosen during implementation that carry concrete path
     references.
4. Reuse the existing gitignored-path behavior.
5. Ignore fenced code blocks.
6. Emit file, line, stale path, and a direct repair hint.
7. Keep the check report-only and probably opt-in until field data is clean.

## Testing

- Fixtures for valid paths, missing paths, fenced-code ignores, and gitignored
  paths.
- A smoke command such as:
  `bun run drift:ai --scope current --check module-doc-paths --format text`.

## Out of scope

- Checking exported symbols named in prose.
- Rewriting stale docs.
- Making this a gate.

## Implementation notes (Done 2026-06-03)

Shipped as a check id `module-doc-paths` (not a subcommand), opt-in
(`runByDefault: false`), report-only. Files:

- `scripts/drift-ai/backtick-paths.ts` — extracted the fenced-code-aware inline
  token scanner shared with `harness-freshness` (which was refactored to use it;
  its `normalizeBacktickPath` was **not** shared because it rejects `../`, which
  this check needs).
- `scripts/drift-ai/module-doc-paths.ts` — core: qualify → multi-base resolve →
  existence → gitignore guard → finding.
- `scripts/drift-ai/module-doc-paths-io.ts` — `defaultListModuleDocs` (reuses
  `walkSourceFiles` with a `.md` extension set) + `isModuleDocPath`.
- `scripts/drift-ai/module-doc-paths-check{,-config}.ts` — plugin + lightweight
  metadata; wired into both registries (after `suppressions`), `types.ts`,
  `config.ts`.
- Docs: README check-table row + detailed section; `docs/ai-harness.md` row.

**Key design decision — precision over recall.** MODULE.md path conventions are
loose and mixed-base. I measured the live corpus (35 module docs) before coding:
a naive repo-root check (like harness-freshness) would be ~almost all false
positives. The shipped rules — file refs only (multi-segment + known extension,
so `identifier.member` prose and bare filenames are skipped), `@scope` and
directory refs skipped, `.js`→`.ts/.tsx` fallback, resolve across
[moduleDir, parentDir, roots, package-roots, repoRoot] with `./`/`../` anchored to
moduleDir only — yield **2 findings repo-wide, both genuine doc bugs**
(`collections/MODULE.md:18` `../../lib/trpc.js` + `download-json.js` use `../../`
where the homebrew convention is `../../../lib/`). Left unfixed per "rewriting
stale docs is out of scope"; a human can fix those two paths.

**Deliberate scope cuts (candidates for field-data follow-up):** directory
references are not validated (empirically all-noise in this corpus: cross-package
refs, hypothetical future dirs, child-perspective relative paths); single-segment
filename refs are not validated (collide with member-access prose). Config is just
`excludeGlobs` (skips whole docs). If field data wants finer suppression, add a
per-reference allowlist later.
