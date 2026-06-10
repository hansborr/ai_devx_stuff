# 53 - drift report JSON contract fixtures

Status: Done
Track: G
Size: small
Depends on: none
Blocks: none

## Resolution (2026-06-04)

Added `scripts/drift-ai/report-contract.test.ts` plus four golden fixtures under
`scripts/drift-ai/fixtures/`:

- `report-contract.clean.json` — clean changed-scope run; `scope`, `checkTimings`,
  and `totalDurationMs` omitted (the timing-absent / v3-tolerant path).
- `report-contract.clean.with-scope.json` — the clean run rendered with
  `includeScope: true`, byte-pinning the changed-scope `ScopeFile` entry shape
  (`status` plus optional `previousPath` on a renamed entry).
- `report-contract.findings.json` — current-scope run exercising a plain finding,
  a `details`-only finding (number/boolean/string[] values), a `details` +
  `drift-baseline` `provenance` finding (no configPath), a `target-config`
  `provenance` finding (with configPath), skips with and without a machine-readable
  `code`, and the additive v4 timing block. `scope` omitted by default.
- `report-contract.findings.with-scope.json` — same report rendered with
  `includeScope: true`, proving `scope` is appended after `scopeCount`.

The test byte-compares `formatJson` output against each golden file, so any
add/remove/rename/reorder of a key fails until the fixtures are regenerated with
`UPDATE_DRIFT_CONTRACT=1`. A final test pins each fixture's `schemaVersion` to the
live `DRIFT_SCHEMA_VERSION`, so a schema bump must travel with regenerated
fixtures. README "Portable JSON report contract" subsection documents that
`--format json` is the portable surface and `HARNESS_DIAGNOSTICS_OUTPUT` is a
separate Musi-harness sidecar.

No formal JSON Schema generator was added (out of scope); additive optional fields
and documented `schemaVersion` bumps stay allowed.

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
