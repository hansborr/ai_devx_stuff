# 41 — The standalone demo advertises a Musi-coupled rule as ready to wire up

Status: Done
Track: T (tooling) · Priority: P2 · Size: M

> **Amended — 2026-07-13 adversarial triage.** Size increased from S to M after verification exposed a byte-parity constraint and pinned diagnostic tokens. The demo copy cannot be edited independently of the production rule.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `examples/lint-ratchet-demo/README.md:121-123` — the bundled rule is advertised as a wire-up-ready example.
- `examples/lint-ratchet-demo/eslint-rules/max-lines.js:118`, `examples/lint-ratchet-demo/eslint-rules/max-lines.js:122`, and `examples/lint-ratchet-demo/eslint-rules/max-lines.js:126` — its guidance points to a Musi guide, baseline, and update command absent from the standalone demo.
- `examples/lint-ratchet-demo/portable-manifest.json:4` — the demo copy is governed by the sync manifest and checked for byte identity with `eslint-rules/max-lines.js`.
- `eslint-rules/message-guidance.test.js` and `docs/guides/local-eslint-rules.md:111-123` pin the production diagnostic’s guidance tokens.

Failure: An adopter wiring the showcased rule receives remediation paths and commands that do not exist in the copied project.

## Do

Respect byte-parity: either replace the demo asset with a demo-local neutral rule and update the manifest, sync check, and README, or change the production rule, guide, test, and demo copy together. Do not create an unsynchronized fork of `max-lines.js`.

## Verify

```
bun run test:scripts:file -- scripts/check-lint-ratchet-demo-sync.test.ts && bun run test -- eslint-rules/message-guidance.test.js
```

## Acceptance

- The advertised standalone rule has only paths and commands available in the demo.
- The chosen asset remains covered by an explicit sync or ownership contract.
