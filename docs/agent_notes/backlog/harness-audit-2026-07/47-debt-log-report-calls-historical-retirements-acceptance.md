# 47 — The debt-log report calls historical retirements “Acceptance”

Status: Done
Track: T (tooling) · Priority: P3 · Size: XS

Related: [agent-friction N1](../agent-friction-2026-06/00-report.md#tier-3--valuable-more-effort-or-lower-frequency), which fixed the forward retirement workflow but left legacy rendering unchanged.

> **Confirmed — 2026-07-13 adversarial triage.** The renderer and append-only history were checked: entries 1–12 contain no regressions and mostly record orphan removal or promotion; only entry 13 is a true debt acceptance.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `scripts/lint-ratchet/lint-ratchet-debt-log.ts:142-153` — legacy records render beneath an `Acceptance` heading.
- `lint-ratchet.debt-log.jsonl:1-12` — the first twelve entries have zero regressions and represent removals or promotions.
- `lint-ratchet.debt-log.jsonl:13` — the thirteenth entry is the first actual acceptance.

Failure: The public report appears to show twelve debt acceptances when most entries demonstrate successful retirement, reversing the visible trajectory.

## Do

Render zero-regression legacy records with only removals as `Legacy retirement/removal`, and report acceptance and retirement totals separately. Preserve append-only history. This extends the future-workflow fix recorded under `../agent-friction-2026-06/` rather than rewriting old data.

## Verify

```
bun run test:scripts:file -- scripts/lint-ratchet/lint-ratchet-debt-log.test.ts && bun run lint:ratchet:debt-log
```

## Acceptance

- Legacy removals are not labeled acceptances.
- The report distinguishes historical retirement count from actual accepted debt count.
