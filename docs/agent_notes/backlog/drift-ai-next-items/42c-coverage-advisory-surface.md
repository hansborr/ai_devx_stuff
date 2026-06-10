# 42c - coverage artifact advisory surface

Status: Done
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

## Implementation notes (2026-06-04)

Implemented `drift:ai coverage-evidence` as a prototype-lane advisory subcommand
over the task-42a coverage artifact parser.

- `scripts/drift-ai/coverage-evidence-advisory.ts` builds and formats the
  advisory envelope (`kind: "advisory"`, `lane: "prototype"`, no top-level
  `findings`) with one section per configured artifact.
- `scripts/drift-ai/coverage-evidence-command.ts` resolves the repo root, loads
  config, reads `coverage.artifacts`, and renders text/JSON without running tests
  or building source inventory.
- Text and JSON preserve artifact path, label, parser format, timestamp, parsed
  function/line hit rows, summaries, parse notes, missing-artifact read failures,
  and per-artifact display truncation via `--top`.
- README and `drift-ai.config.example.json` now document the config shape and
  subcommand.

Verification:

- `bunx vitest run scripts/drift-ai/coverage-evidence-advisory.test.ts scripts/drift-ai/coverage-evidence-command.test.ts scripts/drift-ai/coverage-config.test.ts --config scripts/vitest.config.ts`
- `bunx vitest run scripts/drift-ai.test.ts --config scripts/vitest.config.ts --testNamePattern "example config|config"`
- `bun scripts/drift-ai.ts coverage-evidence --config <fixture process-substitution> --top 2`
- `bun run test:scripts:changed`
- `bun run lint:ratchet`
