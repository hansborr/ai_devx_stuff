# 68 — `drift-ai.config.json` reads as committed local state

Status: Done
Track: DOC (docs) · Priority: P3 · Size: XS

> **Amended — 2026-07-13 adversarial triage.** The claim that only the tool README explains the file was corrected: `docs/ai-harness.md` also names it. The root README still does not identify it as intentional Musi policy beside the example template.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `drift-ai.config.json:15-30` — the committed file contains concrete sibling-file allow pairs.
- `drift-ai.config.example.json` — a generic template sits beside the project policy.
- `docs/ai-harness.md:294` and `scripts/drift-ai/README.md` explain the tool, while root `README.md` never names `drift:ai`.
- `harness.controls.json:1-2` demonstrates an in-file `$comment` convention for committed policy JSON.

Failure: A cold reader can mistake the concrete allowlist for accidentally committed personal state rather than intentional repository policy.

## Do

Add a `$comment` identifying the file as Musi policy and pointing adopters to the example, or add an equivalent root-index note. Preserve valid JSON and existing consumers.

## Verify

```
bun run drift:ai -- --help && jq -e 'type == "object"' drift-ai.config.json
```

## Acceptance

- The committed config identifies itself as repository policy.
- The generic example remains the obvious adopter starting point.
