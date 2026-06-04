# 53 - drift report JSON contract fixtures

Status: Parked
Track: G
Size: small
Depends on: none
Blocks: none

## Goal

Add focused contract fixtures for the portable `drift:ai --format json` report so
schema-version changes and additive fields are deliberate.

## Background

`DriftReport` has a `schemaVersion`, and the portable foreign-repo contract stays
`--format json` even after task 11 adds a Musi-specific diagnostics sidecar. The
TypeScript types protect producers, but they do not give downstream consumers a
stable fixture or fail when JSON shape changes accidentally.

This task is intentionally smaller than a full public JSON Schema generator. It
adds representative fixtures and tests first; a formal schema can be split later
if a real external consumer needs it.

## Seams to touch

- `scripts/drift-ai/report-format.ts`
- `scripts/drift-ai/types.ts`
- `scripts/drift-ai.test.ts` or focused report-format tests
- fixture files under `scripts/drift-ai/fixtures/` if useful
- `scripts/drift-ai/README.md`

## What to do

1. Add a small representative JSON report fixture covering:
   - clean run;
   - findings with `details` and `provenance`;
   - skipped checks with machine-readable skip codes;
   - omitted `scope` by default and included scope when `--include-scope` is set.
2. Assert the fixture's `schemaVersion` matches `DRIFT_SCHEMA_VERSION`.
3. Add a test that fails loudly if the rendered JSON shape changes without an
   intentional fixture update.
4. Document that `--format json` is the portable report contract and
   `HARNESS_DIAGNOSTICS_OUTPUT` is a Musi-harness sidecar.

## Testing

- Focused report-format or runner tests that render and compare the contract
  fixture.
- Existing drift-ai runner tests if touched.

## Out of scope

- Generating a formal JSON Schema.
- Replacing the diagnostics sidecar tasks.
- Freezing additive optional fields forever; schema-version bumps remain allowed
  when documented.
