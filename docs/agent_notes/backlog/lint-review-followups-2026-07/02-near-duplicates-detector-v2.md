# 02 — Near-duplicates detector v2: exact-clone tier + block detection

Status: Ready
Track: S (sensors/gates) · Priority: P2 · Size: L

## Evidence (verified 2026-07-15 on feat/lint-adoption-2026-07 pre-land; re-verify before implementing)

- Size floors exclude small exact clones: `minLines = 8` / `minTokens = 45`
  defaults at `scripts/drift-ai/near-duplicates-config-values.ts:4`; the
  byte-identical `unwrapChain` trio in the effect-misuse rules (3 lines /
  18 tokens, similarity 1.000 when force-compared) was filtered out before
  comparison at `scripts/drift-ai/near-duplicates.ts:55` and never reached
  scoring. (The trio itself was drained on the branch; the class of miss
  remains.)
- (Moved out 2026-07-15: the config-vs-gate threshold disagreement is now
  leaf [07](./07-gate-honors-configured-thresholds.md) — it is cheap and
  unconditional, and does not belong behind this leaf's earn-its-slot
  condition.)
- Whole-function granularity misses block duplication: candidates must share
  a sorted multiset of top-level statement hashes
  (`scripts/drift-ai/near-duplicates.ts:154`) before AST-feature Dice
  scoring against a 0.85 threshold (`near-duplicates.ts:238`). The three
  `lint-agent-envelope.ts` finding builders (29/25/21 lines, all eligible)
  were never compared; forced comparisons scored 0.51-0.76. A verbatim
  repeated assembly block inside otherwise-different functions is invisible
  even if introduced today.

Failure: the gate's blind spots are exactly the duplication agents produce
most — small copy-pasted helpers and repeated statement blocks — so the
detection-with-enforcement story has a hole a reviewer will keep finding by
hand.

## Do

Only if the gate keeps earning its verify slot; do NOT lower the global
near-clone floor (noise) or the 0.85 threshold (useless while the
statement-bucket prefilter stands).

1. Exact-clone tier: normalized AST/token equality with a small floor
   (~3 lines / 15 tokens), possibly scoped to `eslint-rules`/`scripts` where
   helper copy-paste concentrates.
2. Block/subtree detection for repeated statement sequences: start with a
   calibrated same-file-capable jscpd pass as a separate advisory sensor —
   only build in-house AST statement-window fingerprints if the advisory
   sensor proves block duplication recurs enough to justify the L-sized
   lift. (Threshold-config honoring split out to leaf 07.)

## Verify

```
bun scripts/sensor-near-duplicates.ts --check-baseline
bun run test:scripts:file -- scripts/sensor-near-duplicates.test.ts
bun run verify:changed
```

## Acceptance

A 3-line byte-identical helper pasted into two eslint-rules files is
detected; a verbatim 8-statement block repeated inside two different
functions is at least advisory-flagged; baseline stays shrink-only
throughout.

Sources: codex gate-miss investigation 2026-07-15 (recs 2-3);
Fable 5 adjudication (detector v2 leaf).
