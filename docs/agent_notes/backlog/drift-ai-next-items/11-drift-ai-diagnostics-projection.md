# 11 - drift:ai diagnostics projection

Status: Done
Track: Dg
Size: medium
Depends on: 10, 10a
Blocks: 13

## Outcome (2026-06-02)

Landed `scripts/drift-ai/diagnostics-projection.ts`:

- `projectDriftDiagnostics(report)` maps a `DriftReport` to a `HarnessDiagnostics`
  envelope tagged `tool: "drift:ai"`. Drift findings become `warn` entries;
  skipped checks become `info` entries whose `why` states the check did not run
  (so an absent check is never read as a pass) and whose machine `code` is carried
  in `reason`. Enabled-but-clean checks emit nothing, so absence is the only clean
  signal. Findings are sorted (control, path, why) and the summary is built with
  `summarizeHarnessFindings`, so the envelope is summary-consistent by
  construction.
- `controlForCheck(check, scopeMode)` resolves every emitted `control` to an
  existing `harness.controls.json` id: the three external-tool adapters map to
  their `check/drift-ai-*` controls, and every other check maps to the scope
  control (`drift-scope/changed` / `drift-scope/current`). No new manifest ids were
  needed.
- `writeDriftDiagnosticsSidecar(report)` runs only when `HARNESS_DIAGNOSTICS_OUTPUT`
  names a path (projection never runs otherwise), reuses the task-10a sidecar
  writer (schema validation + parent-dir creation + sidecar-only write), and wraps
  any failure in `DriftAiError` so the runner maps it to exit 2 — a CLI/tool error,
  not a finding. Native stdout/`--output`/`--chunk-dir` output is untouched.
- `runner.ts` calls the writer after `writeReportOutputs`, routing a write/validation
  failure through `toExitResult` (exit 2). Report-only exit semantics are preserved.

Tests: `scripts/drift-ai/diagnostics-projection.test.ts` (13 cases: control
mapping + full ALL_CHECKS×scope manifest-membership assertion, clean/findings/
skip/adapter projection, no-hint fallback, deterministic ordering, sidecar
unset/valid/unwritable) plus three runner integration cases in
`scripts/drift-ai.test.ts` (sidecar written with native stdout unchanged, no
sidecar when unset, unwritable path → exit 2). Accounted in the lint coverage map.
`bun run verify:changed` passed.

The portable contract is unchanged: `drift:ai --format json` stays the foreign-repo
surface; this projection is the one seam coupling drift:ai to `packages/shared` and
Musi control ids, behind the opt-in sidecar (shared-context contract 7).

## Goal

Let `drift:ai` optionally write a shared `HarnessDiagnostics` sidecar envelope
while preserving its existing text and JSON report output.

## Background

`drift:ai` already has structured report data: scope mode, enabled checks,
skipped checks, summary counts, findings, and report-only exit semantics. A
diagnostics projection lets the broader harness consume that data without
parsing human text or drift-specific JSON.

Use the existing `HARNESS_DIAGNOSTICS_OUTPUT` convention from lint-ratchet:
native `drift:ai` stdout remains unchanged, and the sidecar is written only when
explicitly requested.

## Seams to touch

- diagnostics sidecar writer from task 10a
- `scripts/drift-ai/runner.ts`
- `scripts/drift-ai/report-output.ts`
- `scripts/drift-ai/report-builder.ts`, only if the projection needs data that
  is not already in `DriftReport`
- `scripts/drift-ai.test.ts`
- `scripts/drift-ai/README.md`
- `packages/shared/src/schemas/harness-diagnostics.ts` for imports/types only.

## What to do

1. Add a projection from `DriftReport` to `HarnessDiagnostics` with
   `tool: "drift:ai"`.
2. Include bounded findings for drift findings, skipped checks, and
   infrastructure/adapter skips. Every emitted `control` id must resolve in
   `harness.controls.json`. The shared schema only validates id syntax; add a
   drift-specific manifest-membership assertion (or extract the doctor JSON check
   pattern) so this contract is tested for `drift:ai`. Reuse existing control ids
   where possible and register any new drift control ids in the manifest rather
   than synthesizing per-finding ids.
3. Preserve report-only semantics: findings and skips do not change exit code.
4. Write the sidecar only when `HARNESS_DIAGNOSTICS_OUTPUT` is set to a non-empty
   path, using the task-10a helper so native `drift:ai` stdout remains unchanged.
5. Validate the envelope with `harnessDiagnosticsSchema` before writing.
6. Treat an invalid diagnostics output path or failed write as a CLI/tool error,
   not as a drift finding.
7. Document the sidecar and how it differs from `--format json`.

## Testing

- Add focused tests proving:
  - clean drift output writes a valid envelope;
  - findings write warning entries and nonzero summary counts;
  - skipped checks are represented without pretending a check passed;
  - every emitted control id resolves in `harness.controls.json`;
  - an unwritable sidecar path fails clearly.
- Run focused drift-ai tests touched by the helper.

## Portability note

This projection is the one seam where `drift:ai` couples to `packages/shared` and
Musi `harness.controls.json` control ids (see shared-context contract 7). Keep it
out of the core report path and behind the opt-in sidecar. The sidecar is
Musi-harness-facing: against a foreign target its Musi control ids do not apply,
so the portable surface there stays `drift:ai --format json`.

## Out of scope

- Replacing `drift:ai --format json`.
- Adding `harness:audit`.
- Running scheduled CI.
