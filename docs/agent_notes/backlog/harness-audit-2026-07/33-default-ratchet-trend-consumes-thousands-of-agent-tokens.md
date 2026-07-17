# 33 — Default ratchet trend consumes thousands of agent tokens

Status: Done
Track: T (tooling) · Priority: P3 · Size: S

> **Confirmed — 2026-07-13 adversarial triage.** The verifier re-measured 60 lines and 12,579 characters by default versus 16 lines and 2,876 characters with `--max 5`. This is concrete evidence for a bounded single-tool default.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `scripts/lint-ratchet/lint-ratchet-trend.ts:96-110` — omitting `--max` applies no history cap.
- `scripts/lint-ratchet/lint-ratchet-trend.ts:266-289` — every active and retired series is rendered without truncation or steering.
- The default measurement was about 3.1k tokens; `--max 5` reduced it to a compact recent view.

Failure: The default advisory report consumes thousands of agent tokens when the common need is recent active movement.

## Do

Default to a bounded recent or active-ratchet view, print the omitted count and exact all-history command, and retain an explicit unlimited mode. This extends [harness-review leaf 17](../harness-review-2026-07/17-ratchet-trend-and-debt-attribution.md); its stale status line was corrected while draining leaf 46 after trend’s `3b79af88` shipment was re-verified.

## Verify

```
bun run lint:ratchet:trend && bun run lint:ratchet:trend -- --max 5
```

## Acceptance

- Default output is bounded and clearly identifies omitted history.
- An explicit option still renders the complete historical view.
