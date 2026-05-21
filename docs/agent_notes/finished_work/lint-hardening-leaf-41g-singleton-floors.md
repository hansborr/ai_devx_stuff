# Leaf 41g: Singleton Floors

Date: 2026-05-21

## Summary

Closed the four Leaf 41f broad-shallow blockers:

- `scripts/code-intel.test.ts`
- `scripts/lint-ratchet-baseline.test.ts`
- `scripts/lint-coverage-map-check.ts`
- `scripts/lint-coverage-map-check.test.ts`

All four files are now exact re-includes from the global `scripts/**/*`
ESLint ignore, and the scripts parser override points them at
`tsconfig.scripts.json`.

## Triage

Initial normal-lint inventory after re-include: 32 findings.

- Autofixed: 2 `simple-import-sort/imports` findings.
- Existing ratchet extensions: 6 findings.
  - `ratchet/core-complexity-top-level-scripts`: +1
    (`scripts/lint-coverage-map-check.ts`, max complexity 14)
  - `ratchet/core-no-magic-numbers-top-level-scripts`: +4
    (`scripts/lint-coverage-map-check.ts`)
  - `ratchet/typescript-eslint-restrict-template-expressions-top-level-scripts`:
    +1 (`scripts/code-intel.test.ts`)
- New ratchets: 24 current findings.
  - `ratchet/regexp-no-super-linear-backtracking-script-tests`: 2
  - `ratchet/regexp-no-unused-capturing-group-lint-coverage-map-check`: 3
  - `ratchet/typescript-eslint-explicit-function-return-type-script-tests`: 5
  - `ratchet/typescript-eslint-no-unsafe-assignment-script-tests`: 2
  - `ratchet/typescript-eslint-require-await-script-singletons`: 12
- Unfixable / stopped findings: 0.

No structural blocker appeared and the new baseline increase stayed below the
50-finding stop threshold.

## Ratchet Shape

The script-test bug-class floor uses shared per-rule ratchets over the three
newly linted singleton test files, mirroring the existing codemod and drift-ai
test patterns:

- `ratchet/vitest-expect-expect-script-tests`: 0 findings
- `ratchet/vitest-valid-expect-script-tests`: 0 findings
- `ratchet/typescript-eslint-no-misused-promises-script-tests`: 0 findings
- `ratchet/typescript-eslint-only-throw-error-script-tests`: 0 findings

The source max-lines floor uses a singleton, matching the existing
`local-max-lines-*` singleton pattern:

- `ratchet/local-max-lines-lint-coverage-map-check`: 0 findings

Bounded incidental findings discovered by normal lint were handled with the
closest existing top-level script ratchets where the rule family already
existed, and narrow new ratchets where it did not.

Zero-finding proof: a temporary probe in
`scripts/lint-coverage-map-check.test.ts` produced failures for all four
bug-class ratchets, and a temporary line-count probe in
`scripts/lint-coverage-map-check.ts` produced a
`ratchet/local-max-lines-lint-coverage-map-check` failure. Both probes were
reverted before verification.

## Verdict

Broad-shallow Leaf 41 coverage is complete enough after this leaf. Future work
should pivot to drain work or explicitly named deeper-rule leaves.

Exit path: drain the new explicit-return, unsafe-assignment, require-await,
regexp, complexity, and magic-number ratchets in focused follow-ups, then remove
the exact normal-lint carve-outs for the current findings.
