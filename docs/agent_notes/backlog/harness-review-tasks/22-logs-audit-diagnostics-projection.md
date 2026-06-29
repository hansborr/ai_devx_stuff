# 22 - logs:audit diagnostics projection

Status: Superseded -> drift-ai-next-items 12 (logs:audit diagnostics projection, Done)
Track: Dg (diagnostics)
Size: medium
Depends on: 13, 20
Blocks: 23

## Goal

Let `logs:audit` optionally emit a shared harness diagnostics envelope with
`tool: "logs:audit"`.

## Background

The harness review treated runtime and verification logs as useful evidence only
when they are summarized into bounded, parseable signals. `logs:audit` already
has the domain report; this task makes it consumable by a future `harness:audit`
without parsing text.

## Seams to touch

- `scripts/logs-audit.ts`
- Existing `logs:audit` tests, or a new focused test file beside the script
- `package.json`, only if the final CLI shape needs a script alias
- `docs/ai-harness.md` or a script README, only for the opt-in diagnostics flag
  or environment variable

## What to do

1. Add an opt-in diagnostics output path for `logs:audit`.
2. Project the existing audit report into `HarnessDiagnostics` with summary
   counts and bounded per-control findings.
3. Preserve the existing text behavior and exit semantics.
4. Validate the generated envelope with the shared schema before writing, so a
   bad projection fails near the producer.
5. Document the output path and the intended consumer.
6. Reconfirm `harness.controls.json` has current `logs:audit` controls for
   input, JSONL parse, redaction, request-id, and event-field findings before
   mapping findings to `control` ids.

## Testing

- Add focused tests proving:
  - a clean audit writes a valid envelope;
  - a red audit writes a valid envelope with actionable findings;
  - a red audit still exits according to the existing `logs:audit` contract, and
    the diagnostics sidecar remains valid for a later report-only consumer;
  - missing or unreadable log input reports a clear infrastructure finding or
    documented no-op state, matching existing `logs:audit` behavior;
  - an unwritable diagnostics path fails clearly.

## Out of scope

- Implementing `logs:audit --latest`; see task 53.
- Calling `logs:audit` from `doctor`, Stop hooks, or CI.
- Adding the fusion command.
