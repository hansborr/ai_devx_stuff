# 65 — No 15-minute visitor tour or copy ladder

Status: Done
Track: DOC (docs) · Priority: P2 · Size: M

> **Amended — 2026-07-13 adversarial triage.** E7’s missing-tour finding stands; E12 was narrowed because the adoption guide already has two tiers. The merged leaf must reconcile existing enumerations and link the copy-boundary map rather than re-enumerating it.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `docs/ai-harness.md:1-4` — the main entry is an inventory and gap map, not a timed walkthrough.
- `docs/ai-harness.md:126-135` — Minimal starter is a file list rather than an open-run-fail-fix tour.
- `docs/guides/lint-ratchet-adoption.md:3-5` — two adoption tiers already exist and must be absorbed rather than duplicated.
- `examples/lint-ratchet-demo/README.md:1-28` — the smallest runnable ratchet unit exists.
- No `docs/harness-tour.md` sequences the ratchet, controls generation/check, and shared-body/thin-shim adapter surfaces.

Failure: Visitors have strong individual assets but no short sequence answering what to open, run, observe, and copy at increasing levels of commitment.

## Do

Add a 15-minute tour: controls and generated proof, runnable ratchet demo, then shared hook bodies and thin adapters. Fold in a copy ladder that reconciles the existing tiers. Link to the Portable Core/copy-boundary map in `docs/ai-harness.md`; do not repeat its file-by-file boundary or add a fourth independent tier list.

## Verify

```
rg -n "minute|copy|Portable Core|lint-ratchet-demo|harness:check|ai-hooks" docs/harness-tour.md README.md
```

## Acceptance

- A visitor can complete one bounded open-run-observe path in about 15 minutes.
- The tour links one authoritative copy-boundary map and reconciles existing adoption tiers.
