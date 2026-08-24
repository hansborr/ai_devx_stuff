# 168. Generator tests bury scenario deltas beneath 105 repeated control envelopes

Status: Landed on fix/cq-168
Theme: scenario fixture deltas · Area: harness · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The hook-wiring and verify-step generator suites repeatedly reconstruct complete
control objects even when a scenario changes only one wiring field or slot
vector. Contributors must compare near-identical arrays to discover the
behavior under test, and changes to the canonical fixture envelope fan out
across dozens of literals.

Both suites already have wrappers that add documentation fields and parse
fixtures through the real manifest contract, but neither wrapper provides the
typed, valid baseline objects from which most scenarios differ.

## Evidence

- `scripts/harness/generate-hook-wiring.test.ts:14-45` defines a
  `Record<string, unknown>` fixture wrapper that supplies common documentation
  fields, while each scenario still constructs its own control and
  `hookWiring` shell.
- `scripts/harness/generate-verify-steps.test.ts:12-45` has the corresponding
  parse-and-default wrapper, but no baseline map for the four verify consumers.
- `scripts/harness/generate-verify-steps.test.ts:222-365` contains six adjacent
  policy cases that repeatedly enumerate `verify`, `verify-changed`,
  `verify-parallel`, and `pre-commit` while changing only selected slot vectors.
- Measured at the pin, the two suites contain 105 inline control `id:`
  properties: 24 in `generate-hook-wiring.test.ts` and 81 in
  `generate-verify-steps.test.ts`.
- `scripts/harness/generate-verify-steps.test.ts:200-218` and
  `scripts/harness/generate-hook-wiring.test.ts:920-945` intentionally construct
  duplicate IDs; these malformed fixtures need their raw shape to remain
  obvious.

## Proposed direction

Add typed file-local scenario builders to each generator suite — a baseline
four-consumer manifest builder with per-consumer slot overrides for
`generate-verify-steps.test.ts`, and a valid hook-control builder with wiring
overrides for `generate-hook-wiring.test.ts` — and rewrite the repetitive
scenarios onto them, keeping raw inline objects for malformed-input and
duplicate-control-id cases.

The builders should return fixtures accepted by the existing parsing wrappers,
make the scenario-specific override visible at the call site, and remain local
to their respective test files rather than creating a shared test abstraction
for two different manifest contracts.

## Scope / caveats

This is test-fixture refactoring only; do not change either production
generator, `harness-manifest-schema.ts`, generated output, or diagnostic text.
Keep malformed shapes and duplicate-ID cases inline instead of making the
builders capable of producing invalid fixtures.

The separate failure-and-recovery contract for these generators remains in
[066-three-mutation-test-lanes-can-strand-live.md](./066-three-mutation-test-lanes-can-strand-live.md);
neither leaf depends on the other, but concurrent edits to the same suites
should be avoided.

The 2026-07-25 typed-fixture proposal
[40-test-payload-factories.md](../code-quality-2026-07-25/40-test-payload-factories.md)
covers client, shared, server, and lint-ratchet fixtures, not these harness
generator scenarios.
