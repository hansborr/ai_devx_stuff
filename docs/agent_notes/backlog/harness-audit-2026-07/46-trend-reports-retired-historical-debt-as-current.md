# 46 — Trend reports retired historical debt as “current”

Status: Done
Track: T (tooling) · Priority: P2 · Size: S

> **Confirmed — 2026-07-13 adversarial triage.** Live output reproduced a retired ratchet as `current 1 delta +1` even though it is absent from the 14-ratchet registry. The earlier review leaf’s status line is also stale because trend shipped already.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `scripts/lint-ratchet/lint-ratchet-trend.ts:212-233` — `current` is taken from the last historical point with no current-registry check.
- `scripts/lint-ratchet/lint-ratchet-trend.ts:266-288` — output prints the label for active and retired series alike.
- At verification time, `local-max-lines-lint-coverage-map-check` printed `current 1 delta +1` despite retirement after carrying one finding.

Failure: Retired or promoted controls look like active worsening debt, undermining the showcase claim that ratchets drain and graduate.

## Do

Derive active/retired status from the current registry. Rename the retired value to `last`, mark it retired, or append a terminal retirement event so it cannot be read as current debt. Update [harness-review leaf 17](../harness-review-2026-07/17-ratchet-trend-and-debt-attribution.md) as related stale context.

## Verify

```
bun run test:scripts:file -- scripts/lint-ratchet/lint-ratchet-trend.test.ts && bun run lint:ratchet:trend -- --max 5
```

## Acceptance

- Retired series are visibly distinct from current registered debt.
- The known retired max-lines coverage-map series is never labeled current.
