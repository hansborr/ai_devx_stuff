# 11 - Module-doc path accuracy sensor

Status: Parked
Track: Dg (diagnostics)
Size: small-medium
Depends on: 10
Blocks: 23, 24

## Goal

Generalize the existing backtick path-existence check from `docs/ai-harness.md`
to all `*MODULE.md` files and selected area docs, as a report-only drift check.

## Background

`harness-freshness` already knows how to parse inline backtick path references
and report stale paths. The review found that `MODULE.md` body content has no
equivalent freshness check, which let the stale `index.ts` facade claim survive.

This is path-existence only. Symbol-existence checks are intentionally deferred.

## Seams to touch

- `scripts/drift-ai/harness-freshness.ts`
- `scripts/drift-ai/harness-freshness-io.ts`
- `scripts/drift-ai/check-registry.ts`
- `scripts/drift-ai/harness-freshness.test.ts`
- `scripts/drift-ai/README.md`
- `docs/ai-harness.md`

## What to do

1. Extract reusable backtick path parsing/checking helpers if needed.
2. Add a new report-only check, for example `module-doc-paths`, that scans:
   - `packages/**/MODULE.md`
   - `packages/**/*-MODULE.md`
   - small area docs named in the task implementation, if they carry concrete
     file paths.
3. Reuse the existing ignore behavior for gitignored paths.
4. Emit findings with file, line, stale path, and a direct fix hint.
5. Add the check to the drift registry in report-only form.

## Testing

- Add focused fixtures proving:
  - a valid backtick file path passes;
  - a missing backtick file path in a `MODULE.md` is reported;
  - fenced code blocks are ignored;
  - gitignored paths stay ignored.
- Run the focused `harness-freshness` / drift test files.
- Run `bun run drift:ai --scope current --check module-doc-paths --format text`
  or the exact final check name.

## Out of scope

- Checking exported symbols mentioned in prose.
- Rewriting stale docs found by the new sensor.
- Making this a gate.
