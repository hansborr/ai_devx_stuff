# 12 - logs:audit diagnostics projection

Status: Parked
Track: Dg
Size: medium
Depends on: 10, 10a
Blocks: 13

## Goal

Let `logs:audit` optionally write a shared `HarnessDiagnostics` sidecar envelope
with `tool: "logs:audit"`.

## Background

The scheduled/fusion lane needs deterministic logs evidence in the same envelope
shape as `drift:ai` and `lint:ratchet`. This task projects the existing
`logs:audit` domain report into the shared schema without changing default text
behavior.

## Seams to touch

- diagnostics sidecar writer from task 10a
- `scripts/logs-audit.ts`
- `scripts/logs-audit.test.ts`
- `docs/ai-harness.md` or a script README section for the opt-in sidecar
- `packages/shared/src/schemas/harness-diagnostics.ts` for imports/types only.

## What to do

1. Add an opt-in diagnostics output path using the
   `HARNESS_DIAGNOSTICS_OUTPUT` convention and the task-10a sidecar-only writer.
2. Project existing audit findings into bounded `HarnessFinding` entries.
3. Validate the envelope before writing.
4. Preserve current stdout and exit semantics.
5. If logs are malformed, keep the existing hard failure behavior for explicitly
   selected logs.

## Testing

- Add focused tests for clean logs, logs with findings, malformed logs, and
  sidecar path behavior.
- Validate generated envelopes with `harnessDiagnosticsSchema`.

## Out of scope

- Implementing `logs:audit --latest`; if needed, split or coordinate with the
  existing harness-review task 53.
- Adding `harness:audit`.
- Changing log audit rules.
