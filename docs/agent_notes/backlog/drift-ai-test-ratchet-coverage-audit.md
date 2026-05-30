# Drift:ai Test Ratchet Coverage Audit

Several drift-ai test files are documented in the lint coverage map near rows
for their production families, but only a selected subset is actually included
in `ratchet/vitest-expect-expect-drift-ai-tests` and
`ratchet/vitest-valid-expect-drift-ai-tests`.

Known examples checked during drift-ai review task 12:

- `scripts/drift-ai/adapter-support.test.ts`
- `scripts/drift-ai/knip-orphan-files.test.ts`
- `scripts/drift-ai/finding-lines.test.ts`
- `scripts/drift-ai/source-walk.test.ts`

Next pass: decide whether to add these files to the drift-ai Vitest ratchet
families, create a separate ratchet family for newer drift-ai adapter/helper
tests, or keep type-boundary-only coverage and make the coverage map explicit
for each row.
