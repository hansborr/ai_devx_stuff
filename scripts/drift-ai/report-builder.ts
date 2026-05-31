import type { CheckRunInput } from "./check-plugin.js";
import { checkPluginFor } from "./check-registry.js";
import { clearKnipRunCache } from "./knip-runner.js";
import type { DetectorScope } from "./scope.js";
import {
  type CliOptions,
  DRIFT_SCHEMA_VERSION,
  type DriftCheckId,
  type DriftFinding,
  type DriftReport,
  type DriftReportSummary,
  type SkippedDriftCheck,
} from "./types.js";

export type { CheckRunContext, CheckRunInput } from "./check-plugin.js";
export type CheckContext = CheckRunInput;

export function buildReport(
  options: CliOptions,
  resolvedRef: string | null,
  detectorScope: DetectorScope,
  input: CheckRunInput,
): DriftReport {
  // Bound the cross-check knip memo to this report build. The two whole-project
  // knip checks still share one spawn inside the loop below, but repeated direct
  // buildReport callers never inherit stale JSON from a prior build.
  clearKnipRunCache();
  const reportInput: CheckRunInput = {
    ...input,
    env: { ...input.env, reportCache: new Map<string, unknown>() },
  };
  const enabled: DriftCheckId[] = [];
  const skipped: SkippedDriftCheck[] = [];
  const findings: DriftFinding[] = [];

  for (const check of options.checks) {
    const plugin = checkPluginFor(check);
    if (plugin === undefined) {
      skipped.push({ check, reason: "check is not implemented" });
      continue;
    }
    const outcome = plugin.runWithSelectedConfig(reportInput);
    if (outcome.status === "skipped") {
      skipped.push({
        check,
        reason: outcome.reason,
        ...(outcome.code === undefined ? {} : { code: outcome.code }),
      });
      continue;
    }
    enabled.push(check);
    findings.push(...outcome.findings);
  }

  const summary = summarizeFindings(enabled, findings);
  return {
    schemaVersion: DRIFT_SCHEMA_VERSION,
    scopeMode: options.scopeMode,
    base: options.scopeMode === "changed" ? options.base : null,
    resolvedRef: options.scopeMode === "changed" ? resolvedRef : null,
    roots: reportRoots(options, input),
    configPath: options.configPath ?? null,
    enabledChecks: enabled,
    skippedChecks: skipped,
    summary,
    findings,
    scopeCount: detectorScope.files.length,
    scope: detectorScope.files,
  };
}

function reportRoots(options: CliOptions, input: CheckRunInput): readonly string[] {
  return options.roots.length > 0 ? options.roots : input.roots;
}

function summarizeFindings(
  enabledChecks: readonly DriftCheckId[],
  findings: readonly DriftFinding[],
): DriftReportSummary {
  const byCheck: Partial<Record<DriftCheckId, number>> = {};
  for (const check of enabledChecks) byCheck[check] = 0;
  for (const finding of findings) {
    const current = byCheck[finding.check];
    if (current !== undefined) byCheck[finding.check] = current + 1;
  }
  return { total: findings.length, byCheck };
}
