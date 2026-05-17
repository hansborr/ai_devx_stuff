# Leaf 25: Diagnostic And Rule Metadata

Status: Parked
Depends on: at least one new lint-hardening or structural sensor leaf landed

Related: Leaf 23. Do not promote this leaf until Leaf 23 has either been kept,
dropped, or explicitly skipped. If Leaf 23 lands, this leaf should formalise
the metadata fields that generator actually used instead of designing a second
parallel model.

## Problem

If Musi adds more local rules and structural sensors, `docs/ai-harness.md` can
keep growing by hand and future hooks may need to parse prose. Machine-readable
metadata can make diagnostics, repair guidance, and harness documentation easier
to keep fresh.

## Minimum Useful Fields

- rule or sensor id;
- category;
- default severity;
- paired guide or doc;
- sanctioned alternative or repair action;
- whether autofix or codemod support exists;
- current allowlists or migration state;
- optional path, line, reason, and command fields for script findings where a
  safe repair command exists.

## Rollout

Wait until at least one earlier leaf lands. Then design metadata around a real
rule or sensor rather than inventing a schema in advance.

## Verification

- Tests for whichever metadata loader or validator is introduced.
- `bun run test:scripts:changed` if implemented as a script.
- `bun run vitest run --project=eslint-rules` if local ESLint rule metadata is
  included.
- `bun run verify:changed`
