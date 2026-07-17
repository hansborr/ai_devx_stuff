import type { CheckRunInput, CheckServiceEnv } from "./check-plugin.js";
import { checkPluginFor } from "./check-registry.js";
import { clearKnipRunCache } from "./knip-runner.js";
import type { DetectorScope } from "./scope.js";
import {
  type CheckTiming,
  type CliOptions,
  DRIFT_SCHEMA_VERSION,
  type DriftCheckId,
  type DriftFinding,
  type DriftReport,
  type DriftReportSummary,
  type SkippedDriftCheck,
} from "./types.js";
export type ReportBuildInput = Omit<CheckRunInput, "env"> & {
  readonly env: Omit<CheckServiceEnv, "cli" | "reportCache">;
};

// Monotonic wall-clock seam in milliseconds. Injected so per-check timing is
// deterministic in tests; production uses `performance.now()` for an elapsed that
// is immune to wall-clock adjustments. Timing is evidence only — it never gates,
// sorts, or changes a finding (see `CheckTiming` in types.ts).
export type Clock = () => number;

const defaultClock: Clock = () => performance.now();

function elapsedMs(startMs: number, clock: Clock): number {
  // Whole milliseconds, floored at zero so a non-monotonic injected clock can
  // never report negative time. Rounding here keeps `totalDurationMs` exactly the
  // sum of the per-check durations.
  return Math.max(0, Math.round(clock() - startMs));
}

export function buildReport(
  options: CliOptions,
  resolvedRef: string | null,
  detectorScope: DetectorScope,
  input: ReportBuildInput,
  clock: Clock = defaultClock,
): DriftReport {
  // Bound the cross-check knip memo to this report build. The whole-project knip
  // checks still share one spawn inside the loop below, but repeated direct
  // buildReport callers never inherit stale JSON from a prior build.
  clearKnipRunCache();
  const reportInput: CheckRunInput = {
    ...input,
    env: { ...input.env, cli: options, reportCache: new Map<string, unknown>() },
  };
  const enabled: DriftCheckId[] = [];
  const skipped: SkippedDriftCheck[] = [];
  const findings: DriftFinding[] = [];
  // One timing row per dispatched check, in run order, including skips (a cheap
  // skip reads as a low duration). Timing is recorded around the full dispatch —
  // registry lookup, lazy service resolution, preflight, and run — so the cost a
  // reader sees matches what the check actually spends.
  const checkTimings: CheckTiming[] = [];

  for (const check of options.checks) {
    const startMs = clock();
    const plugin = checkPluginFor(check);
    if (plugin === undefined) {
      skipped.push({ check, reason: "check is not implemented" });
      checkTimings.push({ check, durationMs: elapsedMs(startMs, clock) });
      continue;
    }
    const outcome = plugin.runWithSelectedConfig(reportInput);
    checkTimings.push({ check, durationMs: elapsedMs(startMs, clock) });
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
  const totalDurationMs = checkTimings.reduce((sum, timing) => sum + timing.durationMs, 0);
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
    checkTimings,
    totalDurationMs,
    findings,
    scopeCount: detectorScope.files.length,
    scope: detectorScope.files,
  };
}

function reportRoots(options: CliOptions, input: Pick<CheckRunInput, "roots">): readonly string[] {
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
