# Leaf 25: Diagnostic And Rule Metadata

Status: Adopted (subset) in commit `acee0f7f` on 2026-05-17. The ESLint-rule half of this leaf is
landed: every `local/*` rule now carries `description`, `principle`,
`category`, `pairedGuide`, `repairKind`, and `repairCommand` (iff
codemod), validated by both the generator and a vitest contract test.
The remaining "sensors and script findings carry the same metadata"
half is deferred (PR 2 has landed).

Related: Leaf 23 (the spike that introduced `meta.docs.principle` and
the generator) was the foundation; PR 1 generalised it.

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
