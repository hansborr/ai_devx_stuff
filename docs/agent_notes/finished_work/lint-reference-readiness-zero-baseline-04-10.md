# Lint Reference Readiness 04-10: Zero-Baseline Dispositions

Completed on 2026-05-25.

Added `zeroBaselineDisposition` metadata for the remaining 29 zero-baseline
ratchets covered by backlog tasks 04 through 10:

- max-lines script-family rows
- `local/type-assertion-boundary`
- shared `strict-boolean-expressions`
- top-level TypeScript script rows
- codemod test rows
- script/drift test rows
- custom-rule test and regex rows

No row was retired: `bun run lint:ratchet:zero-baseline` reported 0 exact
`normal-error` equivalents. After the metadata update, the audit reports 36
documented lifecycle rows and 0 rows needing action.

Verification:

- `bun run lint:ratchet:zero-baseline`
- `bun run lint:ratchet:update`
- `bun run lint:ratchet:check-baseline`
- `bun run lint:ratchet:check-registry`

