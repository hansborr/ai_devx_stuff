# 45b - complexity metric overlay

Status: Done
Track: P
Size: medium
Depends on: 39, 45a
Blocks: none

## Implementation notes (2026-06-04)

Landed the `branch-points` complexity overlay on the existing `birth-size-delta`
prototype subcommand.

- New metric module `scripts/drift-ai/branch-points.ts`: a deterministic,
  parser-only count of AST decision points (`if`, `for`/`for..in`/`for..of`,
  `while`, `do..while`, `switch` `case` clauses, `catch`, ternary `?:`, and the
  `&&`/`||`/`??` operators) over a `ts.createSourceFile` parse (same parse contract
  as `parsed-source-cache.ts`). Named and versioned (`branch-points` v1). It is
  **explicitly not** ESLint cyclomatic complexity: no `+1` base, no type info, no
  ESLint run, and the metric definition string says so. Branch points are
  attributed to the innermost function scope (plus a `(module top-level)` bucket)
  so per-scope counts sum to the file total. A `BranchPointSourceParser` /
  `BranchPointMeasurer` seam exists for test injection of the failure branch.
- Overlay derivation split into `scripts/drift-ai/birth-size-delta-complexity.ts`
  (keeps `birth-size-delta-analysis.ts` under the 300-line ratchet and makes the
  overlay translation directly testable). The lens runs the metric on both the
  birth and current blob, emits then-vs-now totals/delta, the heaviest contributing
  current-blob functions (top 5), and parse-failure caveats.
- Missing or unparsable blobs degrade to a null overlay + caveat, never a finding.
  Row ranking is unchanged (still driven by 45a size deltas); complexity is overlay
  evidence only.
- Tests: `branch-points.test.ts` (metric units incl. TSX, attribution, sum
  invariant, injected parse failure); overlay + rendering tests added to
  `birth-size-delta-advisory.test.ts` (growth, shrinkage, unchanged, missing blob,
  unparsable blob, rendering with no WARN/FIX language). README documents the
  overlay.

Promotion evidence: still prototype/opt-in. No field calibration yet, so it stays
candidate-framed under the task 39 advisory contract.

## Known limitation / follow-up (low severity)

`ts.createSourceFile` is error-tolerant: on a malformed but readable blob it
returns a best-effort tree (often `total: 0`) instead of throwing, so the
available-but-unparsable degradation path (`ok: false` -> "could not parse"
caveat) is reachable in production essentially only when the parse genuinely
throws (e.g. stack overflow), not for ordinary syntax errors. A blob committed
with merge-conflict markers would therefore report a misleading complexity of 0
with no caveat rather than a parse-failure degradation. This is acceptable for the
prototype (committed source-extension blobs almost always parse, and the dominant
degradation — a missing blob — is fully handled), and the failure branch is
covered through the injected `BranchPointMeasurer` test seam. A future hardening
pass, if this lens is promoted, could inspect TypeScript parse diagnostics to flag
syntactically-broken blobs as degradations instead of silently counting them.

## Goal

Add a deterministic complexity-style metric overlay to the birth/current size
lens after the birth blob plumbing exists.

## Background

`hotspots` deliberately avoids a complexity lens because routine complexity
enforcement belongs to lint-ratchet. The prototype birth lens is different: it
asks whether a file arrived complex and then stayed stale or ownership-concentrated.
That still needs a concrete metric contract. Do not let "complexity" mean an
unspecified parser project or a hidden ESLint run.

## Seams to touch

- task 45a birth/current blob loader
- `scripts/drift-ai/parsed-source-cache.ts` or a local source parser, if reused
- optional simple metric helper under `scripts/drift-ai/`
- prototype advisory output from task 39
- `scripts/drift-ai/README.md`

## What to do

1. Choose and name a deterministic metric before emitting rows. Acceptable first
   slices include a small AST branch-count metric or another parser-backed local
   metric with tests. If it is not ESLint cyclomatic complexity, do not label it
   as ESLint complexity.
2. Run the same metric on the birth blob and current blob from task 45a.
3. Emit metric name/version, per-file totals, top contributing functions or
   blocks when available, then-vs-now delta, parser failures, and caveats.
4. Keep missing or unparsable blobs as degradations, not findings.
5. Preserve the task 45a evidence. Complexity is an overlay that strengthens or
   weakens the row; it is not a standalone abandonment verdict.

## Testing

- Unit tests for the chosen metric on small TS/TSX snippets.
- Overlay tests for birth-current growth, shrinkage, unchanged complexity,
  parser failure, and missing blobs.
- Rendering tests showing the metric name and caveats.

## Out of scope

- Running ESLint over historical blobs unless a later task creates a safe
  temp-source boundary and proves it is worth the cost.
- Type-checker-backed metrics.
- Default-on gates or refactor/deletion verdicts.
