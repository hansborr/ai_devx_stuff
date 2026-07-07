# 42. Explicit `kind` for improvement findings; drop dead `warning=0`

Status: Done — implemented on lane/lint-msg-ratchet-fix.
Lens: ratchet · Area: consistency · Severity: med · Size: S-M · Confidence: med-high
Theme: json-legibility · Source: Musi lint-messaging review 2026-07-05 (5 Sonnet agents + Fable verification)

## Problem
Improvement findings ("tree is better than baseline; lock it in") are
emitted at `severity: "block"` — a documented, deliberate gating choice
(strict improvement enforcement). But in the raw envelope JSON nothing
structural distinguishes them from regressions; consumers reverse-engineer
intent by matching `reason` strings against the `IMPROVEMENT_REASONS` set.
Relatedly, the run summary always prints `blocking=N warning=N info=N`
even though ratchet findings are only ever block or info — `warning=0` is
permanent dead noise.

## Evidence
- `scripts/lint-ratchet/diagnostics.ts:249-252` — improvement finding,
  severity block.
- `scripts/lint-ratchet/lint-ratchet-report.ts:17-22` —
  `IMPROVEMENT_REASONS` string-matching in the report formatter.
- `scripts/lint-ratchet/default-mode.ts:84-89` — the summary line.

## Proposed direction
(a) Add an explicit discriminator (e.g. `kind: "regression" |
"improvement" | ...`) to ratchet findings, additive and optional in the
harness-diagnostics schema; switch `lint-ratchet-report.ts` to it and keep
`IMPROVEMENT_REASONS` only as a fallback for old artifacts (or delete if
none persist).
(b) Suppress the `warning=` term in the ratchet summary, or print severity
counts only for severities the tool can actually emit.

## Scope / caveats
- Do NOT change the gating semantics — improvements still block; this is
  legibility only.
- Schema lives at `packages/shared/src/schemas/harness-diagnostics.ts` and
  has non-lint consumers (`verify-logs --json`): additive optional field
  only, and check envelope tests (`lint-agent-envelope.test.ts`,
  ratchet fixtures).

## Implementation
Added optional `kind` to harness findings (`regression`, `improvement`,
`info`, `report-only`) and populated it for lint-ratchet diagnostics. The
report formatter trusts `kind` when present and keeps legacy `reason`
matching only for old artifacts. Default ratchet stderr now prints
`blocking=N info=N` without the permanent `warning=0` term.

Focused coverage: `harness-diagnostics.test.ts`,
`lint-ratchet-baseline.test.ts`, `lint-ratchet-output.test.ts`,
`lint-ratchet-report.test.ts`, and the AI-hook summary fixture.
