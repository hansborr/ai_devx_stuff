// Projects a finished `LogsAuditReport` into the shared `HarnessDiagnostics`
// envelope so the broader Musi harness (the scheduled/fusion lane) can consume
// logs:audit results in the same shape as drift:ai and lint:ratchet without
// parsing human text or logs-audit-specific JSON. logs:audit is a Musi-internal
// script (not the portable drift:ai core), so coupling it to `packages/shared`
// here is fine. The projection runs only behind the opt-in
// `HARNESS_DIAGNOSTICS_OUTPUT` sidecar; native logs:audit stdout/exit semantics
// are untouched.

import {
  buildHarnessDiagnostics,
  type HarnessDiagnostics,
  type HarnessFinding,
} from "../../packages/shared/src/schemas/harness-diagnostics.js";
import {
  HARNESS_DIAGNOSTICS_OUTPUT_ENV,
  harnessDiagnosticsOutputPath,
  writeHarnessDiagnosticsSidecar,
} from "../harness/harness-diagnostics-output.js";
import { errorMessage } from "../lib/error-message.js";
// Type-only imports: erased at runtime, so logs-audit.ts (which imports the
// sidecar writer below) keeps a clean one-directional runtime dependency on this
// module. The back-edge exists only in the type graph.
import type { LogsAuditFinding, LogsAuditFindingCheck, LogsAuditReport } from "../logs-audit.js";

// The harness.controls.json control id each logs:audit finding check attributes
// to. Every logs:audit check already has a dedicated `logs-audit/*` control in
// the manifest, so the projection reuses those ids rather than synthesizing
// per-finding ones. `satisfies Record<...>` keeps this exhaustive over the
// check union at compile time: a new finding check cannot be added without a
// control mapping, and the manifest-membership test then covers it.
const CONTROL_BY_CHECK = {
  input: "logs-audit/input",
  jsonl: "logs-audit/jsonl",
  redaction: "logs-audit/redaction",
  "request-id": "logs-audit/request-id",
  "event-fields": "logs-audit/event-fields",
} as const satisfies Record<LogsAuditFindingCheck, string>;

// logs:audit is report-only by category but a real gate: any finding exits 1.
// Each check repairs by hand (the manifest marks every logs-audit control
// `repairKind: "manual"`), so the projection carries a per-check manual
// instruction rather than a generic one.
const HOW_TO_FIX_BY_CHECK = {
  input:
    "Confirm the selected log file exists and is readable, then re-run logs:audit; logs:audit only reads logs and never creates them.",
  jsonl:
    "Emit one valid JSON object per line; fix or drop the malformed record at the reported line.",
  redaction:
    "Redact the sensitive field before the log record is written; logs:audit reports the leak but does not modify logs.",
  "request-id":
    "Ensure each business-event log carries a request id that matches a request log so request-scoped behavior stays traceable.",
  "event-fields":
    "Add or correct the required/stable event field so log consumers can group behavior without parsing free-form messages.",
} as const satisfies Record<LogsAuditFindingCheck, string>;

/** The harness.controls.json control id a logs:audit finding check maps to. */
export function controlForCheck(check: LogsAuditFindingCheck): string {
  return CONTROL_BY_CHECK[check];
}

/**
 * Every control id this projection can emit. The manifest-membership test
 * asserts each one resolves in harness.controls.json, so the envelope's
 * `control` field is always a real harness control rather than a synthesized id.
 */
export const LOGS_AUDIT_DIAGNOSTIC_CONTROL_IDS: readonly string[] = Object.values(CONTROL_BY_CHECK);

// A logs:audit finding becomes a `block` entry: unlike report-only drift:ai
// (whose findings project to `warn`), logs:audit exits 1 on any finding, so the
// honest harness-severity is blocking — the same severity lint:ratchet uses for
// a real regression. `why` carries the native message verbatim (logs:audit
// never echoes secret values into messages, only field names), and the
// machine-readable `field` sub-locator, when present, is preserved in `reason`.
function logFindingToHarnessFinding(finding: LogsAuditFinding): HarnessFinding {
  const base = {
    control: controlForCheck(finding.check),
    severity: "block",
    path: finding.file,
    why: finding.message,
    howToFix: HOW_TO_FIX_BY_CHECK[finding.check],
    repairKind: "manual",
  } as const;
  const withLine = finding.line === undefined ? base : { ...base, line: finding.line };
  return finding.field === undefined ? withLine : { ...withLine, reason: finding.field };
}

/**
 * Project a `LogsAuditReport` into a `HarnessDiagnostics` envelope tagged
 * `tool: "logs:audit"`. Every audit finding becomes a bounded `block` entry
 * (logs:audit retains no raw record payloads, so each entry is just
 * control/path/line/field/message). A clean report projects to an empty
 * findings list, so absence of findings is the only "clean" signal. The result
 * is summary-consistent by construction (`summarizeHarnessFindings`).
 */
export function projectLogsAuditDiagnostics(report: LogsAuditReport): HarnessDiagnostics {
  const findings = report.findings.map(logFindingToHarnessFinding);
  return buildHarnessDiagnostics("logs:audit", findings);
}

/**
 * Write the diagnostics sidecar when `HARNESS_DIAGNOSTICS_OUTPUT` names a path,
 * leaving native logs:audit stdout untouched. When the env var is unset/empty
 * the projection never runs, so a non-diagnostics run is unaffected. The shared
 * writer validates the envelope and creates parent dirs; a validation or write
 * failure is re-thrown with a descriptive message so the caller can map it to a
 * CLI/tool error (exit 2), never to a finding.
 */
export function writeLogsAuditDiagnosticsSidecar(report: LogsAuditReport): void {
  if (harnessDiagnosticsOutputPath() === undefined) return;
  try {
    writeHarnessDiagnosticsSidecar(projectLogsAuditDiagnostics(report));
  } catch (error) {
    throw new Error(
      `logs:audit could not write the ${HARNESS_DIAGNOSTICS_OUTPUT_ENV} sidecar: ${errorMessage(error)}`,
      { cause: error },
    );
  }
}
