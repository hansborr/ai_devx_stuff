# 20 - Diagnostics schema tool extension

Status: Parked
Track: Dg (diagnostics)
Size: small
Depends on: 13
Blocks: 21, 22, 23

## Goal

Reserve first-class shared diagnostics tool ids for the next harness reports:
`drift:ai`, `logs:audit`, and `harness:audit`.

## Background

`lint:ratchet` already emits the shared harness diagnostics envelope. The review
recommended a common diagnostics spine before adding a scheduled slow lane, so
new producers and consumers do not invent parallel JSON contracts.

This task is only the schema and tests. Producers are split into tasks 21 and
22; the fusion command is task 23.

## Seams to touch

- `packages/shared/src/schemas/harness-diagnostics.ts`
- `packages/shared/src/schemas/harness-diagnostics.test.ts`
- `scripts/test-test-scripts.sh`, only if changed-file selection for the schema
  needs an updated smoke expectation

## What to do

1. Add `drift:ai`, `logs:audit`, and `harness:audit` to
   `harnessDiagnosticToolSchema`.
2. Add focused schema tests proving the new ids parse and an unknown id still
   fails.
3. Keep the envelope version and payload shape unchanged unless a current test
   proves the existing shape cannot represent report-only or skipped checks.
4. Re-run the changed-file selection smoke if the schema test fanout changes.

## Testing

- Run `bun run test -- packages/shared/src/schemas/harness-diagnostics.test.ts`.
- Run `bash scripts/test-test-scripts.sh` if the changed-file smoke expectations
  are touched.

## Out of scope

- Emitting diagnostics from any tool.
- Adding `harness:audit` as a package script.
- Changing existing `lint:ratchet` diagnostics output.
