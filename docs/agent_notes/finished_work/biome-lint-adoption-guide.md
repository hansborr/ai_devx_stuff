# Biome Lint Adoption Guide

Date: 2026-05-26

## Landed

Added `docs/guides/biome-lint-adoption.md`, documenting how Biome adopters can
adapt Musi's lint harness without treating Biome as a drop-in ESLint rename.
The guide covers:

- custom lint guidance and the `HarnessDiagnostics` envelope;
- Biome JSON reporter and GritQL plugin adapter constraints;
- post-edit tidy hook ownership for formatter, lint fixes, and import sorting;
- lint-ratchet adapter points for Biome diagnostics;
- verification expectations for latency, diff churn, reporter fixtures, hooks,
  and ratchet behavior.

Also linked the guide from `docs/guides/local-eslint-rules.md` and
`docs/guides/lint-ratchet.md`, and pointed the parked fast edit-loop linter
spike at the new guide.

## Verification

- `bun run verify:changed`
