# 40b - dead-code FP-trap corpus

Status: Parked
Track: P
Size: small-medium
Depends on: none
Blocks: 42b, 47a, 47, 48a, 48

## Goal

Create a committed fixture corpus for dead-code false-positive traps so
prototype reachability and coverage overlays can be calibrated before promotion.

## Background

Task 40 is clone-specific. The brainstorm also called for a committed corpus of
dead-code traps: barrel re-exports, dynamic-import-only usage, test-only usage,
framework entrypoints, and reflection/string-keyed access. These examples are
the safety rail for noisy prototype rows that correlate coverage, static
reachability, sibling implementation naming, or class instantiation evidence.

## Seams to touch

- `scripts/drift-ai/fixtures/dead-code-corpus/` or a similarly named directory
- a small labels file and parser/evaluator helper
- tests under `scripts/drift-ai/`

## What to do

1. Add small TS/TSX fixtures covering:
   - barrel and re-export transitivity;
   - dynamic `import()` only usage;
   - test-only usage;
   - framework entrypoint or registration patterns;
   - reflection/string-keyed access;
   - a few true unused/tombstoned examples for contrast.
2. Include machine-readable labels that distinguish "true trap", "candidate",
   and "known unused" cases. The labels should name the symbol/path and the
   reason the case is risky.
3. Add a tiny parser or test helper that lets later tasks assert that their rows
   preserve trap labels instead of calling the code dead.
4. Keep the corpus framework-light. Use minimal synthetic patterns first, not a
   full app scaffold.

## Testing

- Focused tests that the labels parse and fixture paths/symbol names resolve.
- A regression test showing at least one dynamic-import and one barrel case are
  available to downstream evaluators.

## Out of scope

- Building a portable unused-export engine.
- Running coverage.
- Treating this corpus as sufficient promotion evidence by itself.
