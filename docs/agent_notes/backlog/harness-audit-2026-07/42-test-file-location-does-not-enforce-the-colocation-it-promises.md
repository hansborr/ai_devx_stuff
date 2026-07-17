# 42 — `test-file-location` does not enforce the co-location it promises

Status: Done
Track: T (tooling) · Priority: P2 · Size: S

> **Confirmed — 2026-07-13 adversarial triage.** The rule description itself is honest; the overclaim is in its principle, both diagnostics, and two public docs. Runtime checks only filename shape and test-block presence.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `eslint-rules/test-file-location.js:26` — `meta.docs.description` accurately describes filename and test-block checks.
- `eslint-rules/test-file-location.js:27-28`, `eslint-rules/test-file-location.js:35`, and `eslint-rules/test-file-location.js:37` — the principle and messages promise co-location with covered code.
- `eslint-rules/test-file-location.js:42-77` — implementation checks naming and `describe`/`it`/`test` calls, with no source-to-test location inference.
- `docs/ai-harness.md:261` and `docs/agent_notes/harness-presentation-2026-06/01-research-report.md:81` repeat the stronger claim.

Failure: Adopters can rely on a structural policy the rule cannot enforce; any correctly named test with a test block can pass from an unrelated location.

## Do

Prefer the small honest fix: rename the principle and diagnostics as test-file shape checks and correct public docs. Only promise co-location if a configurable, testable source-to-test policy is first designed.

## Verify

```
bun run test -- eslint-rules/test-file-location.test.js && bun run docs:lint-guidance:check
```

## Acceptance

- Rule metadata, messages, implementation, and public docs describe the same guarantee.
- Tests cover the final claimed filename and test-block semantics.
