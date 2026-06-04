# 48 - never-instantiated classes advisory integration

Status: Parked
Track: P
Size: small-medium
Depends on: 39, 40b, 48a
Blocks: none

## Goal

Expose the task-48a class construction evidence inventory through prototype
advisory output.

## Background

Never-instantiated classes are a high-FP dead-code signal. Task 48a isolates the
class inventory, reference counts, and caveat labeling. This task owns the
candidate-framed advisory surface and optional correlation with stronger signals.

## Seams to touch

- class construction evidence helper from task 48a
- prototype advisory output from task 39
- dead-code FP-trap corpus from task 40b
- `scripts/drift-ai/README.md`

## What to do

1. Choose one explicit advisory surface for class construction candidates.
2. Reuse the task-48a evidence helper; do not re-derive AST/reference logic here.
3. Emit candidate rows only with caveats and raw counts. Do not call a class dead
   solely because `new` is absent.
4. Correlate with stronger signals when available: unused-export rows, coverage
   absence, coldspots, or sibling implementation overlay.
5. Calibrate against the dead-code FP-trap corpus before field trials.

## Testing

- Advisory rendering tests proving caveats and counts are visible.
- FP-trap corpus tests proving public API, dynamic-use, framework, and reflection
  contexts stay candidate-framed.

## Out of scope

- Framework-specific host APIs.
- Default-on findings or gates.
- Deletion/refactor verdicts.
- Full type-checker reachability.
