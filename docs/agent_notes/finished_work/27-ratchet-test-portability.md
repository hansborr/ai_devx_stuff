# Ratchet Test Portability

Documented the ratchet test-copy boundary in
`docs/guides/lint-ratchet.md`.

- Portable: `scripts/lint-ratchet-baseline.test.ts`,
  `scripts/lint-ratchet-summary.test.ts`, and
  `scripts/lint-ratchet-output.test.ts`.
- Mixed: `scripts/lint-ratchet-check-registry.test.ts`; only
  `accepts the Musi registry fixture` is Musi-specific.
- Verification passed: `bun run test:scripts:changed` and
  `bun run verify:changed`.
