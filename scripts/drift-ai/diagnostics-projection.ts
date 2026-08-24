// Projects a finished `DriftReport` into the shared `HarnessDiagnostics`
// envelope so the broader Musi harness can consume drift:ai results without
// parsing human text or drift-specific JSON. This is the one seam where
// drift:ai couples to `packages/shared` and Musi `harness.controls.json`
// control ids (shared-context contract 7); it stays out of the portable core
// report path and runs only behind the opt-in `HARNESS_DIAGNOSTICS_OUTPUT`
// sidecar. The portable foreign-repo surface remains `drift:ai --format json`.

import {
  buildHarnessDiagnostics,
  type HarnessDiagnostics,
  type HarnessFinding,
} from "@musi/harness-diagnostics/schema.js";

import {
  harnessDiagnosticsOutputPath,
  writeHarnessDiagnosticsSidecar,
} from "../harness/harness-diagnostics-output.js";
import { errorMessage } from "../lib/error-message.js";
import { DEFAULT_CHECKS } from "./check-metadata.js";
import { DriftAiError } from "./errors.js";
import type { ScopeMode } from "./scope.js";
import type { DriftCheckId, DriftFinding, DriftReport, SkippedDriftCheck } from "./types.js";

// Default drift checks are intentionally grouped under the scope control that ran
// them. Opt-in checks are represented by dedicated `check/drift-ai-*` controls in
// harness.controls.json so slow-drift audit summaries keep per-check counts.
const GROUPED_BY_SCOPE_CHECKS: ReadonlySet<DriftCheckId> = new Set(DEFAULT_CHECKS);

function scopeControl(scopeMode: ScopeMode): string {
  return scopeMode === "current" ? "drift-scope/current" : "drift-scope/changed";
}

function dedicatedCheckControl(check: DriftCheckId): string {
  return `check/drift-ai-${check}`;
}

// The harness.controls.json control id a check's findings attribute to. The
// projection only emits ids this function can return, so the contract test in
// diagnostics-projection.test.ts asserts every one of them resolves in the
// manifest.
export function controlForCheck(check: DriftCheckId, scopeMode: ScopeMode): string {
  return GROUPED_BY_SCOPE_CHECKS.has(check)
    ? scopeControl(scopeMode)
    : dedicatedCheckControl(check);
}

// drift:ai is report-only, so there is no automated repair for a finding. The
// hint, when present, is the check's own repair suggestion; otherwise fall back
// to a check-named manual-review instruction so `howToFix` is always non-empty.
function howToFixForFinding(finding: DriftFinding): string {
  if (finding.hint !== undefined) return finding.hint;
  return `Review this ${finding.check} finding in the drift:ai report and decide whether to act; drift:ai is report-only, so it makes no change on its own.`;
}

// A drift finding becomes a `warn` entry: drift findings are advisory signal,
// not a blocking gate, and the report-only exit contract is preserved upstream.
function driftFindingToHarnessFinding(finding: DriftFinding, scopeMode: ScopeMode): HarnessFinding {
  const base = {
    control: controlForCheck(finding.check, scopeMode),
    severity: "warn",
    why: finding.message,
    howToFix: howToFixForFinding(finding),
    repairKind: "manual",
  } as const;
  // drift's `file` can embed a line range (e.g. "src/a.ts:7-18"); it is carried
  // verbatim so the entry traces back to the native report row.
  return finding.file.length > 0 ? { ...base, path: finding.file } : base;
}

// A skipped check becomes an `info` entry that states the check did not run, so
// a consumer never reads an absent check as a clean pass. The machine-readable
// skip code, when present, is surfaced in `reason` for branching.
function skipToHarnessFinding(skip: SkippedDriftCheck, scopeMode: ScopeMode): HarnessFinding {
  const codeSuffix = skip.code === undefined ? "" : ` [${skip.code}]`;
  const base = {
    control: controlForCheck(skip.check, scopeMode),
    severity: "info",
    why: `drift:ai did not run the ${skip.check} check, so it neither passed nor failed: ${skip.reason}${codeSuffix}`,
    howToFix: `Resolve the skip cause (${skip.code ?? skip.reason}) and re-run drift:ai if you need a ${skip.check} result; an absent check is not a clean check.`,
    repairKind: "manual",
  } as const;
  return skip.code === undefined ? base : { ...base, reason: skip.code };
}

/**
 * Project a `DriftReport` into a `HarnessDiagnostics` envelope tagged
 * `tool: "drift:ai"`. Drift findings become `warn` entries and skipped checks
 * become `info` entries; enabled-but-clean checks emit nothing, so absence of a
 * finding is the only "clean" signal. The result is summary-consistent by
 * construction (`summarizeHarnessFindings`).
 */
export function projectDriftDiagnostics(report: DriftReport): HarnessDiagnostics {
  const findings: HarnessFinding[] = [
    ...report.findings.map((finding) => driftFindingToHarnessFinding(finding, report.scopeMode)),
    ...report.skippedChecks.map((skip) => skipToHarnessFinding(skip, report.scopeMode)),
  ];
  return buildHarnessDiagnostics("drift:ai", findings);
}

/**
 * Write the diagnostics sidecar when `HARNESS_DIAGNOSTICS_OUTPUT` names a path,
 * leaving native drift:ai stdout untouched. When the env var is unset/empty the
 * projection never runs, so a non-diagnostics run is unaffected. The shared
 * writer validates the envelope and creates parent dirs; a validation or write
 * failure surfaces as a `DriftAiError` (a CLI/tool error), never as a finding.
 */
export function writeDriftDiagnosticsSidecar(report: DriftReport): void {
  if (harnessDiagnosticsOutputPath() === undefined) return;
  try {
    writeHarnessDiagnosticsSidecar(projectDriftDiagnostics(report));
  } catch (error) {
    throw new DriftAiError(
      `drift:ai could not write the HARNESS_DIAGNOSTICS_OUTPUT sidecar: ${errorMessage(error)}`,
    );
  }
}
