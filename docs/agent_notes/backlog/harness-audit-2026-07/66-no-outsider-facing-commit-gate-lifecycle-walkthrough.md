# 66 — No outsider-facing commit-gate lifecycle walkthrough

Status: Done
Track: DOC (docs) · Priority: P3 · Size: S

> **Confirmed — 2026-07-13 adversarial triage.** The ratchet diagram exists, but no artifact sequences edit through hook, generated slots, envelope, and repair text. This is distinct from runtime gate-mode metadata and ratchet-document splitting.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `docs/guides/lint-overview.md:24-40` — a useful Mermaid diagram exists for ratchet flow only.
- `AGENTS.md:15` and `README.md:99-102` mention verification entry points without an end-to-end lifecycle.
- `scripts/verify/steps.generated.sh` is generated from control data but no visitor page follows a commit through those slots to diagnostics.
- `harness.controls.json` contains real control IDs and repair text suitable for one annotated example.

Failure: Visitors must reverse-engineer Husky, generated slot wiring, diagnostics envelopes, and remediation before they can understand the showcase claim that gates are feedback.

## Do

Add a short lifecycle section to the visitor tour or a focused guide: edit → pre-commit → generated changed slots → diagnostic envelope → human-readable repair. Anchor it to one real control ID. Keep separate from [harness-explore leaf 16](../harness-explore-2026-07/16-record-gate-run-mode.md).

## Verify

```
rg -n "pre-commit|steps.generated|control id|repair|envelope" docs/harness-tour.md docs/guides/verify-gate-lifecycle.md
```

## Acceptance

- One maintained artifact shows the full commit-gate sequence.
- The walkthrough points to generated authority and one real control instead of duplicating the slot table.
