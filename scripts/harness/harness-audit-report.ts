// Report assembly and rendering for harness:audit, extracted from
// scripts/harness-audit.ts so the CLI module stays under the max-lines cap.
// The CLI re-exports this module's public surface; consumers keep importing
// from scripts/harness-audit.ts.

import type {
  HarnessDiagnostics,
  HarnessDiagnosticTool,
  HarnessFindingSeverity,
} from "../../packages/shared/src/schemas/harness-diagnostics.js";

const JSON_INDENT_SPACES = 2;

/** One envelope file that read, parsed, and validated cleanly. */
export type LoadedEnvelope = {
  readonly path: string;
  readonly envelope: HarnessDiagnostics;
};

/** An envelope file that could not be read, parsed, or validated. */
export type EnvelopeFailure = {
  readonly path: string;
  readonly reason: string;
};

export type HarnessAuditSeverityCounts = {
  readonly blocking: number;
  readonly warning: number;
  readonly info: number;
};

export type HarnessAuditControlSummary = HarnessAuditSeverityCounts & {
  readonly control: string;
  readonly total: number;
};

export type HarnessAuditToolSummary = HarnessAuditSeverityCounts & {
  readonly tool: HarnessDiagnosticTool;
  readonly sources: readonly string[];
  readonly envelopes: number;
  readonly total: number;
  readonly controls: readonly HarnessAuditControlSummary[];
};

export type HarnessAuditTotals = HarnessAuditSeverityCounts & {
  readonly envelopes: number;
  readonly tools: number;
  readonly total: number;
};

export type HarnessAuditReport = {
  readonly tools: readonly HarnessAuditToolSummary[];
  readonly totals: HarnessAuditTotals;
  readonly failures: readonly EnvelopeFailure[];
};

type SeverityAccumulator = { blocking: number; warning: number; info: number };

function newSeverityAccumulator(): SeverityAccumulator {
  return { blocking: 0, warning: 0, info: 0 };
}

function bumpSeverity(counts: SeverityAccumulator, severity: HarnessFindingSeverity): void {
  if (severity === "block") counts.blocking += 1;
  else if (severity === "warn") counts.warning += 1;
  else counts.info += 1;
}

type ToolAccumulator = SeverityAccumulator & {
  readonly tool: HarnessDiagnosticTool;
  readonly sources: string[];
  envelopes: number;
  readonly controls: Map<string, SeverityAccumulator>;
};

function totalOf(counts: HarnessAuditSeverityCounts): number {
  return counts.blocking + counts.warning + counts.info;
}

function controlSummaries(
  controls: ReadonlyMap<string, SeverityAccumulator>,
): readonly HarnessAuditControlSummary[] {
  return [...controls.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([control, counts]) => ({ control, ...counts, total: totalOf(counts) }));
}

/**
 * Fold the loaded envelopes into one report grouped by tool. Envelopes that
 * share a tool id merge into a single group whose `sources` lists every
 * contributing file, so two runs of the same producer are summarized together.
 * Tools, sources, and controls are sorted for deterministic output.
 */
export function buildAuditReport(
  envelopes: readonly LoadedEnvelope[],
  failures: readonly EnvelopeFailure[],
): HarnessAuditReport {
  const byTool = new Map<HarnessDiagnosticTool, ToolAccumulator>();
  for (const { path, envelope } of envelopes) {
    const accumulator =
      byTool.get(envelope.tool) ??
      ({
        tool: envelope.tool,
        sources: [],
        envelopes: 0,
        ...newSeverityAccumulator(),
        controls: new Map<string, SeverityAccumulator>(),
      } satisfies ToolAccumulator);
    byTool.set(envelope.tool, accumulator);
    accumulator.sources.push(path);
    accumulator.envelopes += 1;
    for (const finding of envelope.findings) {
      bumpSeverity(accumulator, finding.severity);
      const controlCounts = accumulator.controls.get(finding.control) ?? newSeverityAccumulator();
      accumulator.controls.set(finding.control, controlCounts);
      bumpSeverity(controlCounts, finding.severity);
    }
  }

  const tools: HarnessAuditToolSummary[] = [...byTool.values()]
    .sort((left, right) => left.tool.localeCompare(right.tool))
    .map((accumulator) => ({
      tool: accumulator.tool,
      sources: [...accumulator.sources].sort((left, right) => left.localeCompare(right)),
      envelopes: accumulator.envelopes,
      blocking: accumulator.blocking,
      warning: accumulator.warning,
      info: accumulator.info,
      total: totalOf(accumulator),
      controls: controlSummaries(accumulator.controls),
    }));

  const totals: HarnessAuditTotals = {
    envelopes: envelopes.length,
    tools: tools.length,
    blocking: tools.reduce((sum, tool) => sum + tool.blocking, 0),
    warning: tools.reduce((sum, tool) => sum + tool.warning, 0),
    info: tools.reduce((sum, tool) => sum + tool.info, 0),
    total: tools.reduce((sum, tool) => sum + tool.total, 0),
  };

  return { tools, totals, failures };
}

const REPORT_ONLY_FOOTER =
  "Report-only: findings above never change this command's exit code; only " +
  "unreadable or malformed envelope files do (exit 2).";

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function severityLine(counts: HarnessAuditSeverityCounts): string {
  const total = totalOf(counts);
  return (
    `${String(counts.blocking)} blocking, ${String(counts.warning)} warning, ` +
    `${String(counts.info)} info (${String(total)} ${pluralize(total, "entry", "entries")})`
  );
}

function severityMix(counts: HarnessAuditSeverityCounts): string {
  const parts: string[] = [];
  if (counts.blocking > 0) parts.push(`${String(counts.blocking)} blocking`);
  if (counts.warning > 0) parts.push(`${String(counts.warning)} warning`);
  if (counts.info > 0) parts.push(`${String(counts.info)} info`);
  return parts.join(", ");
}

function toolSection(tool: HarnessAuditToolSummary): readonly string[] {
  const lines = [
    `${tool.tool} — ${String(tool.envelopes)} ${pluralize(tool.envelopes, "envelope")} (${tool.sources.join(", ")})`,
    `  ${tool.total === 0 ? "clean (no findings)" : severityLine(tool)}`,
  ];
  for (const control of tool.controls) {
    lines.push(`    ${control.control}: ${severityMix(control)}`);
  }
  return lines;
}

export function formatText(report: HarnessAuditReport): string {
  const lines: string[] = [
    "harness:audit — diagnostics fusion (artifact, not an edit-loop gate)",
    "",
  ];
  lines.push(
    `Envelopes: ${String(report.totals.envelopes)} read, ${String(report.failures.length)} unreadable/malformed; ` +
      `${String(report.totals.tools)} ${pluralize(report.totals.tools, "tool")}`,
  );
  lines.push(`Totals: ${severityLine(report.totals)}`);

  if (report.tools.length === 0) {
    lines.push("", "No valid envelopes were read.");
  } else {
    for (const tool of report.tools) {
      lines.push("", ...toolSection(tool));
    }
  }

  if (report.failures.length > 0) {
    lines.push("", `Unreadable or malformed envelopes (${String(report.failures.length)}):`);
    for (const failure of report.failures) {
      lines.push(`  - ${failure.path}: ${failure.reason}`);
    }
  }

  lines.push("", REPORT_ONLY_FOOTER);
  return lines.join("\n");
}

export function formatJson(report: HarnessAuditReport): string {
  return JSON.stringify(report, null, JSON_INDENT_SPACES);
}
