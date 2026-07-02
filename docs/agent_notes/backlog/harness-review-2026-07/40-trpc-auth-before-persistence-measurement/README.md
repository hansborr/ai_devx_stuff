# Leaf 40 Measurement Artifact

This directory archives the conservative AST prototype used for leaf 40's
2026-07-02 rejection decision. It is intentionally not part of the local ESLint
plugin, lint configs, lint ratchets, or harness manifest.

Reproduce the RuleTester fixture:

```sh
node docs/agent_notes/backlog/harness-review-2026-07/40-trpc-auth-before-persistence-measurement/trpc-auth-before-persistence-rule.test.mjs
```

Reproduce the router measurement:

```sh
node docs/agent_notes/backlog/harness-review-2026-07/40-trpc-auth-before-persistence-measurement/measure.mjs
```

Expected output on the measured HEAD:

- 29 non-test router files measured.
- Seed six auth helpers only: 91 findings, 0 true positives, 91 false positives.
- Seed helpers plus sanctioned router boundaries: 67 findings, 0 true positives,
  67 false positives.
- Sanctioned boundaries plus explicit current-inventory allowlist: 0 findings.

The third pass is deliberately a measurement control, not a rule design: it
suppresses the already-classified false-positive procedures and therefore proves
that a zero-noise posture would encode the current router inventory.
