# Lint message eval run

- Run: `2026-07-15-codex-pilot`
- Recorded: 2026-07-15T20:37:49Z
- Evaluated commit: `ce9d060a16d6d3be00572897f0e221153cecd943`
- Agent/sample caveat: Codex GPT-5 pilot; both arms produced in one session and not statistically independent

| Fixture | Frozen source | Target rule | Control iterations | Treatment iterations | Control patterns | Treatment patterns |
| --- | --- | --- | ---: | ---: | --- | --- |
| area-template-line-cells | packages/shared/src/map/area-template.ts:207 | max-depth | 1 | 1 | none | none |
| background-equipment-options | packages/server/src/seed/seed-srd-backgrounds.ts:95 | max-depth | 1 | 1 | none | none |

Resolved arms: control 2/2, treatment 2/2.
Average iterations among resolved arms: control 1, treatment 1, treatment-minus-control 0.

This is a small directional pilot, not a causal benchmark. Re-run with independent sessions and more samples before drawing a message-quality conclusion.
