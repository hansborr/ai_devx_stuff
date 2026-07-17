# 07 — Near-duplicates gate honors configured thresholds

Status: Done — `065266c4`
Track: S (sensors/gates) · Priority: P2 · Size: S

Split out of leaf [02](./02-near-duplicates-detector-v2.md) on 2026-07-15:
unlike the rest of detector v2, this closes a live config-vs-gate
disagreement, is cheap, and must not wait on the "gate keeps earning its
verify slot" condition.

## Evidence (verified 2026-07-15 against the live tree)

- `scripts/sensor-near-duplicates-core.ts:119-136` (`collectNearDuplicates`)
  loads `drift-ai.config.json` (roots, ignores, exclude globs) but passes the
  hardcoded `DEFAULT_NEAR_DUPLICATE_MIN_LINES` / `MIN_TOKENS` /
  `SIMILARITY` constants (lines 133-135) to the runner, so threshold tuning
  in `drift-ai.config.json` is silently ignored by the enforcing path —
  config and gate can disagree without any signal.
- The advisory drift-ai path reads the same config; only the gate is pinned
  to the defaults, so the two surfaces can score the same tree differently.

Failure: an operator tunes thresholds in `drift-ai.config.json`, the
advisory sensor obeys, and the gate silently keeps enforcing the old
values — the disagreement surfaces only as inexplicable gate behavior.

## Do

1. Read the threshold values in the gate path from `drift-ai.config.json`
   (falling back to the `near-duplicates-config-values.ts` defaults when the
   config omits them), so gate and advisory sensor share one source of
   truth.
2. Add a `harness:check` assertion (or a test, whichever fits the existing
   harness-check surface better) that the gate's effective thresholds come
   from the config loader, not the constants.

## Verify

```
bun run test:scripts:file -- scripts/sensor-near-duplicates.test.ts
bun run harness:check
bun run verify:changed
```

## Acceptance

Changing a threshold in `drift-ai.config.json` changes gate behavior,
pinned by a test; with no config override the gate behaves exactly as
today; the baseline stays shrink-only throughout.

Sources: codex gate-miss investigation 2026-07-15 (rec 2); split from
leaf 02 during the 2026-07-15 pack review.
