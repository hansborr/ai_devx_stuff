# drift:ai knip subprocess timeout

Completed drift-ai review task 25.

`defaultKnipRunner` now passes a 10-minute timeout to the knip subprocess, uses
`SIGKILL` as the timeout kill signal, and returns `reason: "timeout"` when Node
reports `ETIMEDOUT` timeout evidence. Both
knip-backed checks (`orphan-files` and `unused-exports`) treat that as an
expected absence skip with `code: "tool-timeout"` rather than a diagnostic
finding.

The shared knip run memo now includes `timeoutMs` in its key, preserving the
single-spawn behavior while avoiding reuse across different execution budgets.

Validation:

- `bun run test -- scripts/drift-ai/knip-runner.test.ts scripts/drift-ai/knip-orphan-files.test.ts scripts/drift-ai/knip-unused-exports.test.ts`
- `FORCE_VERIFY=1 bun run test -- scripts/drift-ai`
- `bun run lint:ratchet`
