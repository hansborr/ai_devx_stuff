# 45 — Ratchet summary’s `files` column means debt-bearing files, not scope

Status: Done
Track: T (tooling) · Priority: P3 · Size: XS

> **Confirmed — 2026-07-13 adversarial triage.** The calculation and both output labels were verified. The same word means debt-bearing files in summary output and total scope in the zero-baseline audit.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `scripts/lint-ratchet/lint-ratchet-summary.ts:68` — the count is derived from keys in baseline debt items.
- `scripts/lint-ratchet/lint-ratchet-summary.ts:200` and `scripts/lint-ratchet/lint-ratchet-summary.ts:212` — output labels the value simply `files`.
- `docs/guides/lint-ratchet-reference.md#metrics-and-baseline-items` — guide prose does not define the narrower meaning.
- A zero-baseline rule can show 0 summary files while the audit’s `Files` column reports its full 2,020-file scope.

Failure: Adopters can mistake a healthy zero-debt rule for an unused rule or broken scope glob.

## Do

Rename the summary column to `debt files` or `files with findings`. Optionally point to the zero-baseline audit for total scope; keep the two meanings visibly distinct.

## Verify

```
bun run lint:ratchet:summary && bun run lint:ratchet:zero-baseline
```

## Acceptance

- Summary output labels the count as debt-bearing files.
- Guide text distinguishes baseline entries from evaluated scope.
