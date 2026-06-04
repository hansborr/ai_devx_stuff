# 20 - module-doc path freshness check

Status: Parked
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
