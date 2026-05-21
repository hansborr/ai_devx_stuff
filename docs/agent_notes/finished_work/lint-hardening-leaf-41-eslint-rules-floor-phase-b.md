# Leaf 41 — eslint-rules floor Phase B

Date: 2026-05-20

## Landed

- Removed the global `eslint-rules/*.test.js` re-ignore so the 20 RuleTester
  files now receive the repo's recommended-JS floor.
- Added an `eslint-rules/*.test.js` ESLint block with:
  - `@vitest/eslint-plugin` recommended rules via
    `vitestPlugin.configs.recommended.rules`
  - explicit core `no-unused-vars`, matching the Phase A rule implementation
    floor
  - `vitest/expect-expect` with `assertFunctionNames: ["expect",
    "ruleTester.run"]`
  - `vitest/valid-expect` with `maxArgs: 2`
- Kept rule-test files out of the Phase A.2 implementation-only maintainability
  and regexp block with `ignores: ["eslint-rules/*.test.js"]`.

## Ratchets

- `ratchet/vitest-no-commented-out-tests-eslint-rules-tests`
  - Initial baseline: 1 message in `eslint-rules/test-file-location.test.js`
  - Normal-lint disable: `vitest/no-commented-out-tests` off for
    `eslint-rules/test-file-location.test.js`
- `ratchet/vitest-no-conditional-expect-eslint-rules-tests`
  - Initial baseline: 5 messages in `eslint-rules/message-guidance.test.js`
  - Normal-lint disable: `vitest/no-conditional-expect` off for
    `eslint-rules/message-guidance.test.js`

No `eslint-rules/*.test.js` source files were modified.

## Exit Path

Phase A.3 still audits `local/*`, `eslint-comments`, and
`simple-import-sort`; rule-tester tests now have a vitest-rules floor symmetric
to the Batch 4 codemod-tests floor. Drain the two new Vitest ratchets to zero
when the rule-message harness and test-file-location fixture can be reshaped
without weakening test intent.
