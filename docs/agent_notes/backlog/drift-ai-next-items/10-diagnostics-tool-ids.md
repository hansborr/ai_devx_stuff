# 10 - Diagnostics tool ids

Status: Done
Track: Dg
Size: small
Depends on: none
Blocks: 11, 12

## Outcome (2026-06-02)

Added `drift:ai`, `logs:audit`, and `harness:audit` to
`harnessDiagnosticToolSchema` (`packages/shared/src/schemas/harness-diagnostics.ts`).
Schema version and payload shape are unchanged — a report-only envelope is an
empty `findings` array with a zeroed summary, which the existing shape already
represents, so no payload change was needed. Added a schema test proving each
new id parses in an envelope. The only code consumer,
`scripts/harness-emit-envelope.ts`, just `safeParse`s `--tool` against the enum,
so the new ids are purely additive (no breaking change on server or client).
`scripts/test-test-scripts.sh` smoke-selection expectations were left unchanged:
task 10 keeps "emitting diagnostics from any tool" out of scope, so no new
envelope-emitting smokes were introduced. `bun run verify:changed` passed.

## Goal

Reserve shared diagnostics tool ids for `drift:ai`, `logs:audit`, and
`harness:audit` without changing the envelope shape.

## Background

`lint:ratchet` already emits the shared `HarnessDiagnostics` envelope. The next
diagnostics tasks need first-class tool ids so producers and the future
`harness:audit` consumer can validate envelopes through the shared schema.

## Seams to touch

- `packages/shared/src/schemas/harness-diagnostics.ts`
- `packages/shared/src/schemas/harness-diagnostics.test.ts`
- `scripts/test-test-scripts.sh`, only if changed-file test selection needs an
  updated expectation.

## What to do

1. Add `drift:ai`, `logs:audit`, and `harness:audit` to
   `harnessDiagnosticToolSchema`.
2. Add schema tests proving each new id parses.
3. Keep the schema version and payload shape unchanged unless tests prove the
   current shape cannot represent report-only diagnostics.
4. Keep existing `lint:ratchet` diagnostics behavior unchanged.

## Testing

- `bun run test -- packages/shared/src/schemas/harness-diagnostics.test.ts`
- `bash scripts/test-test-scripts.sh` only if changed-file smoke expectations are
  touched.

## Out of scope

- Emitting diagnostics from any tool.
- Adding `harness:audit` as a script.
- Changing the finding schema.
