# 43 — Bare prose satisfies `no-llm-artifacts` tracking-reference requirement

Status: Done
Track: T (tooling) · Priority: P3 · Size: S

> **Amended — 2026-07-13 adversarial triage.** P2 was deflated to P3 because the diagnostic explicitly discloses that bare roadmap or agent-note words are accepted; this is a visible policy choice, not a hidden enforcement hole.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `eslint-rules/no-llm-artifacts.js:17-19` — bare phrases such as `roadmap` and `agent note` count as tracking references.
- `eslint-rules/no-llm-artifacts.js:60-71` — metadata and diagnostics frame the requirement as a tracking reference and disclose the accepted form.
- `eslint-rules/no-llm-artifacts.test.js:10-25` — fixtures intentionally accept those phrases without an identifier or path.
- `docs/ai-harness.md:251` — public prose states a stronger locatability intent.

Failure: Comments like `TODO: check the roadmap` satisfy the rule even though an outside maintainer cannot resolve them to an issue, owner, or repository path.

## Do

Reconcile policy with the locatability claim. If tightening to issue identifiers, URLs, or repository paths, measure existing debt first and use a ratchet entry if required by suppression policy; otherwise narrow the docs claim.

## Verify

```
bun run test -- eslint-rules/no-llm-artifacts.test.js && bun run lint:ratchet:check
```

## Acceptance

- Accepted references match the documented locatability standard.
- Any newly exposed legacy debt is governed rather than mass-suppressed.
