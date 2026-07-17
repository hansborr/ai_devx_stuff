# 48 — The config-surface pattern is visible but not teachable

Status: Done
Track: DOC (docs) · Priority: P3 · Size: S

> **Amended — 2026-07-13 adversarial triage.** The generator citation was corrected to `scripts/harness/generate-config-surfaces.ts`. Existing docs accurately call the pattern project-specific but provide no external adoption path.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `docs/guides/lint-overview.md:46` — the manifest receives only a brief clause.
- `scripts/harness/generate-config-surfaces.ts:53-60` — generated configuration surfaces are derived from the manifest.
- `eslint-config/config-surfaces.js:84-106` — the manifest fans out through runtime collectors and policy consumers.
- `docs/guides/lint-ratchet-adoption.md:352-364` — the guide marks these surfaces non-portable without explaining a replacement or adoption sequence.

Failure: Adopters can copy the manifest without the consumers that provide coverage and freshness, silently losing the property the pattern is meant to demonstrate.

## Do

Add a short adoption section with a consumer diagram, replacement checklist, generated-output boundary, and minimal manifest. Explain which consumers are essential, replaceable, or Musi-only; connect to [harness-explore leaf 19](../harness-explore-2026-07/19-copyability-config-block.md).

## Verify

```
bun run docs:lint-guidance:check && bun run harness:check
```

## Acceptance

- The guide shows the manifest-to-consumer chain and minimum viable subset.
- An adopter can identify every generated output and Musi-specific replacement point.
