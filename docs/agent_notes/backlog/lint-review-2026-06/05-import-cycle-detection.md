# Import Cycle Detection

Status: Done (2026-06-12, landed in "docs(lint): record import cycle verdict")
Order: 05
Source: Claude review item 3.

## Context

The lint surface enforces package-boundary direction (shared → server →
client), the barrel ban, the `RawTxClient` import restriction, and
extraneous-deps — but nothing catches intra-package circular imports, which
Bun/ESM tolerate silently until a runtime undefined binding. Verified
2026-06-11: no cycle detection anywhere in the lint configs, sensors, or
scripts.

Two candidate mechanisms:

- `import-x/no-cycle` — `eslint-plugin-import-x` 4.16.2 is already a
  dependency, but the rule is known-expensive on large graphs.
- A standalone sensor over the `code:intel` cross-file import graph (Tarjan
  SCC is near-free once the graph exists), matching the house pattern that
  non-ESLint surfaces get their own sensor (`sensor:blob-size`, knip).

## Scope

Evaluate-first; this is a verdict-producing leaf.

- First measure the current state: run either mechanism report-only and count
  existing cycles. If the count is zero, gating is cheap and the decision is
  mostly about runtime cost.
- Measure `import-x/no-cycle` wall-time on `packages/*` (try bounded
  `maxDepth` variants) against a `code:intel`-based sensor prototype.
- Whichever wins: start report-only, calibrate, then decide gate placement
  (verify/pre-commit/CI) following the structural-sensor precedent summarized
  in the watchlist's structural-sensors entry.
- Record the verdict in `evaluation-verdicts.md`, including a rejected
  option's measured cost.

## Definition Of Done

Either intra-package import cycles are detected by a measured, gated (or
deliberately report-only) mechanism, or a verdict documents why detection is
not worth its cost today.

## Verification

- Before/after lint or sensor wall-time measurements
- A deliberate two-file cycle probe is detected (then reverted)
- `bun run verify:changed`

## Notes

- The original 2026-06-11 premise was stale: `scripts/drift-ai/import-cycles*.ts`
  already implements an opt-in `drift:ai --check import-cycles` detector. This
  leaf therefore landed as a measured placement verdict rather than a new
  detector.
- `drift:ai --scope current --check import-cycles --format json` on the
  configured roots reported 21 findings in 967 ms detector time (1.214 s shell
  wall): 2 runtime cycles and 19 type-only cycles.
- The same detector on package source roots reported 9 findings in 775 ms
  detector time (1.029 s shell wall). A deliberate two-file runtime cycle probe
  under `packages/shared/src` was detected as 1 circular-import finding in
  126 ms and then reverted.
- `import-x/no-cycle` was rejected: package-source probes with a temporary ESLint
  config took 41.945 s at `maxDepth: 1`, 42.117 s at `maxDepth: 3`, and
  39.140 s at depth 1 with `import-x`'s resolver plus TS extensions, with no
  findings.
- Decision: keep the `drift:ai` detector report-only and off `verify` until the
  existing runtime cycles are cleaned up or a baseline/gating policy is designed.
