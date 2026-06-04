# 47 - sibling implementation naming overlay

Status: Parked
Track: P
Size: small-medium
Depends on: 39, 40b, 47a
Blocks: none

## Goal

Surface the task-47a sibling implementation naming classifier as overlay evidence
on existing advisory rows, not as standalone dead-code findings.

## Background

The brainstorm calls this a real AI/refactor residue pattern with meaningful
false-positive risk. Task 47a isolates the naming classifier and trap-corpus
calibration. This task must choose one concrete first consumer so it does not turn
into a general correlation engine. Good first consumers are an existing advisory
row source with sibling paths already in hand, or a prototype advisory section
whose rows are explicitly candidate-framed.

## Seams to touch

- task-47a sibling naming classifier
- `scripts/drift-ai/near-duplicates*` or advisory row helpers when integrating
- `scripts/drift-ai/knip-unused-exports.ts` only if adding an unused-export detail
- prototype advisory output from task 39
- dead-code FP-trap corpus from task 40b
- `scripts/drift-ai/README.md`

## What to do

1. Pick one first consumer and name it in the implementation note before editing.
   Do not wire every possible source in this task.
2. Reuse the task-47a classifier; do not re-derive token/pattern logic here.
3. Emit overlay context only when another signal already produced a row or when
   the output is clearly a prototype advisory section. Do not create a confident
   "dead implementation" finding.
4. Show the sibling paths, shared tokens, naming pattern, and any supporting
   evidence from unused-export, coldspot, or near-duplicate rows.
5. Calibrate against the dead-code FP-trap corpus so public API, test-only, and
   dynamic usages stay labeled as risky rather than removed.
6. Keep allow-pair/config escape hatches consistent with `ghost-files`.

## Testing

- Overlay tests proving the detector augments rows without creating standalone
  `DriftFinding` warnings.
- FP-trap corpus tests for public API and dynamic-use cases.

## Out of scope

- Deletion advice.
- A standalone default check.
- Semantic proof that one sibling replaces another.
