# 13. Truth-up stale harness-review leaf 72 status line

Status: Done — harness-review leaf 72 status was corrected to the shipped 3f8cf2ab behavior.
Lens: docs · Area: truthfulness · Severity: low · Size: XS · Confidence: high
Theme: stale-status · Source: Musi lint-messaging review 2026-07-05 (5 Sonnet agents + Fable verification)

## Problem
`docs/agent_notes/backlog/harness-review-2026-07/72-envelope-structured-skipped-findings.md`
still opens with "Status: Proposed … NOT implemented" and describes skipped
non-local lint findings as dropped from the envelope — but the feature
shipped (commit `3f8cf2ab`, 2026-07-02): `buildSkippedNonLocalFinding` now
emits structured `lint/skipped-non-local` findings, and the pack's own
00-index row 72 already says Done. Only the leaf body was never updated. A
future agent trusting the leaf would re-derive shipped work or "fix" the
current behavior back.

## Evidence
- Leaf body Status line vs. `harness-review-2026-07/00-index.md` row 72
  (Done).
- `scripts/lint-agent-envelope.ts:150-170` — the implemented behavior.
- Commit `3f8cf2ab` — "fix(harness): structure skipped lint findings".

## Proposed direction
One-line edit: set the leaf's Status to
`Done — implemented in 3f8cf2ab (2026-07-02); envelope emits structured
lint/skipped-non-local findings.` Optionally strike the now-wrong "dropped
entirely" sentence in its Problem section.

## Scope / caveats
- Docs-only. This pack's promotion rule 5 exists because of this leaf:
  when a leaf lands, update the leaf body's Status line, not just the
  index row.
