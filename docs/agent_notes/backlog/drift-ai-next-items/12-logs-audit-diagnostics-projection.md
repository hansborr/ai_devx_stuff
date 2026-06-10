# 12 - logs:audit diagnostics projection

Status: Done
Track: Dg
Size: medium
Depends on: 10, 10a
Blocks: 13

## Outcome (2026-06-03)

Landed `scripts/logs-audit-diagnostics.ts`:

- `projectLogsAuditDiagnostics(report)` maps a `LogsAuditReport` to a
  `HarnessDiagnostics` envelope tagged `tool: "logs:audit"`. Every audit finding
  becomes a `block` entry: unlike report-only drift:ai (which projects findings
  to `warn`), logs:audit exits 1 on any finding, so blocking is the honest
  harness severity (the same one `lint:ratchet` uses for a real regression). A
  clean report projects to an empty findings list, so absence is the only
  "clean" signal, and the summary is built with `summarizeHarnessFindings` so the
  envelope is summary-consistent by construction. Findings are sorted by
  (control, path, line, why). `why` carries the native message verbatim
  (logs:audit never echoes secret values into messages, only field names), and
  the machine-readable `field` sub-locator, when present, is preserved in
  `reason`.
- `controlForCheck(check)` resolves each of the five finding checks to its
  existing `logs-audit/*` control id in `harness.controls.json`
  (`input`, `jsonl`, `redaction`, `request-id`, `event-fields`). No new manifest
  ids were needed. `CONTROL_BY_CHECK` is `satisfies Record<LogsAuditFindingCheck,
  string>` so a new finding check cannot be added without a control mapping, and
  `LOGS_AUDIT_DIAGNOSTIC_CONTROL_IDS` drives the manifest-membership test.
- `writeLogsAuditDiagnosticsSidecar(report)` runs only when
  `HARNESS_DIAGNOSTICS_OUTPUT` names a path (projection never runs otherwise),
  reuses the task-10a sidecar writer (schema validation + parent-dir creation +
  sidecar-only write), and re-throws a write/validation failure with a
  descriptive message. `runLogsAudit` catches it and returns exit 2 (a CLI/tool
  error, not a log finding); native stdout and the existing exit-1-on-findings
  semantics are untouched.
- The module imports only `import type` from `logs-audit.ts`, so the runtime
  dependency stays one-directional (`logs-audit.ts` → `logs-audit-diagnostics.ts`)
  with no value-level import cycle.
- `scripts/logs-audit.ts` usage/`--help` text documents the opt-in env var.

Tests: 16 cases added to `scripts/logs-audit.test.ts` (clean/findings/skip-style
projection, control mapping + manifest membership, deterministic ordering,
secret non-leak, field→reason, line/reason omission, sidecar unset/valid/
unwritable, and runLogsAudit integration for clean logs, malformed-log block
findings with exit 1 preserved, unwritable path → exit 2, and no-sidecar when
unset). Coverage-map row for `scripts/logs-audit-*.ts` updated (4 → 5 files).
`bunx tsc -p tsconfig.scripts.json` and the focused vitest run pass.

Portability note: the shared schema only validates control-id syntax, so the
manifest-membership assertion is the contract that every emitted `control`
resolves in `harness.controls.json`. logs:audit is a Musi-internal script (not
the portable drift:ai core), so this `packages/shared` coupling is fine; the
sidecar stays opt-in behind `HARNESS_DIAGNOSTICS_OUTPUT`.

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
