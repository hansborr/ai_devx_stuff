# 42c - coverage artifact advisory surface

Status: Parked
Track: P
Size: small-medium
Depends on: 39, 42a
Blocks: 42b

## Goal

Expose parsed coverage artifacts from task 42a as standalone prototype advisory
evidence, without running tests and without correlating to static reachability.

## Background

Task 42a owns artifact parsing and labels. This task is the user-facing slice:
show what a supplied coverage artifact says, while keeping the output clearly
advisory. A reader should see artifact provenance and hit counts, not a dead-code
verdict.

## Seams to touch

- coverage parser output from task 42a
- prototype advisory output from task 39
- `scripts/drift-ai/runner.ts` or the chosen prototype subcommand seam
- `scripts/drift-ai/subcommand-args.ts`, only if the chosen CLI surface needs it
- `scripts/drift-ai/README.md`

## What to do

1. Choose the smallest CLI surface that lets an operator request coverage
   artifact evidence explicitly.
2. Render coverage rows through the prototype advisory contract from task 39:
   `kind: "advisory"`, no top-level `findings`, and no `WARN`/`FIX` text.
3. Show artifact path, configured label, parser format, timestamp if available,
   file/range or function, hit count, and parse/degradation notes.
4. Preserve per-artifact distinctions. Do not silently union unit/e2e/prod
   coverage into one bitmap.
5. Disclose parse failures and missing artifacts as partial evidence, not as
   coverage findings.

## Testing

- Advisory rendering tests for clean, populated, missing-artifact, parse-failure,
  and multi-artifact runs.
- CLI smoke with fixture artifacts.

## Out of scope

- Running tests or coverage commands.
- Correlating coverage with `unused-exports`; use task 42b.
- Treating uncovered code as dead.
- Coverage gates or score thresholds.
