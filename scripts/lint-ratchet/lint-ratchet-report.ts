import { readFileSync } from "node:fs";

import {
  type HarnessDiagnostics,
  harnessDiagnosticsSchema,
  type HarnessFinding,
  type HarnessFindingSeverity,
} from "../../packages/shared/src/schemas/harness-diagnostics.js";
import { ConfigError } from "./lint-ratchet-metrics.js";
import { escapeMarkdownText, markdownCode } from "./markdown-escape.js";
import { RATCHET_UPDATE_COMMAND, REGRESSION_RECOVERY_FOOTER } from "./recovery-command.js";

const DEFAULT_MAX_FINDINGS_PER_CONTROL = 10;
const JSON_INDENT_SPACES = 2;
const STICKY_COMMENT_MARKER = "<!-- lint-ratchet-summary -->";
export const LINT_RATCHET_REPORT_ARTIFACT_URL_ENV = "LINT_RATCHET_REPORT_ARTIFACT_URL" as const;
const IMPROVEMENT_REASONS: ReadonlySet<string> = new Set([
  "lower-count",
  "lower-lines",
  "lower-complexity",
  "removed-path",
]);

interface FormatHarnessDiagnosticsReportOptions {
  readonly maxFindingsPerControl?: number;
  readonly artifactName?: string;
}

interface RunLintRatchetReportOptions extends FormatHarnessDiagnosticsReportOptions {
  readonly input?: string;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function formatTotals(envelope: HarnessDiagnostics): readonly string[] {
  return [
    "| Total | Blocking | Warning | Info |",
    "| ---: | ---: | ---: | ---: |",
    `| ${String(envelope.findings.length)} | ${String(envelope.summary.blocking)} | ${String(envelope.summary.warning)} | ${String(envelope.summary.info)} |`,
  ];
}

function groupedFindings(
  findings: readonly HarnessFinding[],
): readonly [string, readonly HarnessFinding[]][] {
  const byControl = new Map<string, HarnessFinding[]>();
  for (const finding of findings) {
    const group = byControl.get(finding.control) ?? [];
    group.push(finding);
    byControl.set(finding.control, group);
  }
  return [...byControl.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([control, group]) => [
      control,
      [...group].sort(
        (left, right) =>
          (left.path ?? "").localeCompare(right.path ?? "") || (left.line ?? 0) - (right.line ?? 0),
      ),
    ]);
}

function severityCount(
  findings: readonly HarnessFinding[],
  severity: HarnessFindingSeverity,
): number {
  return findings.filter((finding) => finding.severity === severity).length;
}

function severityMix(findings: readonly HarnessFinding[]): string {
  const parts: string[] = [];
  for (const [severity, label] of [
    ["block", "blocking"],
    ["warn", "warning"],
    ["info", "info"],
  ] as const) {
    const count = severityCount(findings, severity);
    if (count > 0) parts.push(`${String(count)} ${label}`);
  }
  return parts.join(", ");
}

function deltaForPair(
  baseline: number | undefined,
  current: number | undefined,
): string | undefined {
  if (baseline === undefined || current === undefined) return undefined;
  return `${String(baseline)} → ${String(current)}`;
}

function findingDelta(finding: HarnessFinding): string | undefined {
  return (
    deltaForPair(finding.baselineLines, finding.currentLines) ??
    deltaForPair(finding.baselineComplexity, finding.currentComplexity) ??
    deltaForPair(finding.baselineCount, finding.currentCount)
  );
}

function isImprovement(finding: HarnessFinding): boolean {
  return finding.reason !== undefined && IMPROVEMENT_REASONS.has(finding.reason);
}

function findingLocation(finding: HarnessFinding): string | undefined {
  if (finding.path === undefined) return undefined;
  const path =
    finding.line === undefined ? finding.path : `${finding.path}:${String(finding.line)}`;
  return markdownCode(path);
}

function findingPrefix(finding: HarnessFinding): string {
  return [findingLocation(finding), findingDelta(finding)]
    .filter((part) => part !== undefined)
    .join(" — ");
}

function formatFindingBullet(finding: HarnessFinding): string {
  const prefix = findingPrefix(finding);
  const details = `(why: ${escapeMarkdownText(finding.why)}; fix: ${escapeMarkdownText(finding.howToFix)})`;
  return prefix.length === 0 ? `- ${details}` : `- ${prefix} ${details}`;
}

function recoveryLineFor(group: readonly HarnessFinding[]): string | undefined {
  const improvement = group.find(isImprovement);
  if (improvement === undefined) return undefined;
  if (improvement.howToFix.includes(RATCHET_UPDATE_COMMAND)) {
    return escapeMarkdownText(improvement.howToFix);
  }
  return `Run \`${RATCHET_UPDATE_COMMAND}\` to lock in the improvement.`;
}

function maxFindingsPerControl(options: FormatHarnessDiagnosticsReportOptions | undefined): number {
  const requested = options?.maxFindingsPerControl ?? DEFAULT_MAX_FINDINGS_PER_CONTROL;
  return Math.max(0, Math.floor(requested));
}

function formatControlSection(
  control: string,
  findings: readonly HarnessFinding[],
  limit: number,
): readonly string[] {
  const lines = [
    `#### ${markdownCode(control)} (${String(findings.length)} ${pluralize(findings.length, "finding")}, ${severityMix(findings)})`,
  ];
  for (const finding of findings.slice(0, limit)) {
    lines.push(formatFindingBullet(finding));
  }
  const remaining = findings.length - limit;
  if (remaining > 0) lines.push(`_${String(remaining)} more in artifact._`);
  const recovery = recoveryLineFor(findings);
  if (recovery !== undefined) lines.push(recovery);
  return lines;
}

function footerRecoveryLine(findings: readonly HarnessFinding[]): string {
  if (findings.length === 0) return "Recovery: nothing to do.";
  const hasRegression = findings.some(
    (finding) => finding.severity === "block" && !isImprovement(finding),
  );
  if (hasRegression) return REGRESSION_RECOVERY_FOOTER;
  if (findings.every((finding) => finding.severity !== "block")) {
    return "Recovery: review informational findings.";
  }
  return `Recovery: \`${RATCHET_UPDATE_COMMAND}\``;
}

function footerLines(
  envelope: HarnessDiagnostics,
  options: FormatHarnessDiagnosticsReportOptions | undefined,
): readonly string[] {
  return [
    ...(options?.artifactName === undefined
      ? []
      : [`Artifact: ${escapeMarkdownText(options.artifactName)}`]),
    footerRecoveryLine(envelope.findings),
  ];
}

export function formatHarnessDiagnosticsReport(
  envelope: HarnessDiagnostics,
  options?: FormatHarnessDiagnosticsReportOptions,
): string {
  const lines = [STICKY_COMMENT_MARKER, "### Lint ratchet", "", ...formatTotals(envelope), ""];
  if (envelope.findings.length === 0) {
    lines.push("No ratchet findings. (clean)", "");
  } else {
    const limit = maxFindingsPerControl(options);
    for (const [control, findings] of groupedFindings(envelope.findings)) {
      lines.push(...formatControlSection(control, findings, limit), "");
    }
  }
  lines.push(...footerLines(envelope, options));
  return `${lines.join("\n")}\n`;
}

function parseJsonInput(input: string): unknown {
  try {
    const parsed: unknown = JSON.parse(input);
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown JSON parse error";
    throw new ConfigError(`failed to parse harness diagnostics JSON: ${message}`);
  }
}

function parseDiagnostics(input: string): HarnessDiagnostics {
  const result = harnessDiagnosticsSchema.safeParse(parseJsonInput(input));
  if (!result.success) {
    throw new ConfigError(
      `harness diagnostics failed schema validation:\n${JSON.stringify(result.error.issues, null, JSON_INDENT_SPACES)}`,
    );
  }
  if (result.data.tool !== "lint:ratchet") {
    throw new ConfigError(`expected lint:ratchet diagnostics, got ${result.data.tool}`);
  }
  return result.data;
}

export function runLintRatchetReport(options: RunLintRatchetReportOptions): string {
  const input =
    options.input === undefined ? readFileSync(0, "utf8") : readFileSync(options.input, "utf8");
  return formatHarnessDiagnosticsReport(parseDiagnostics(input), options);
}

export type { HarnessDiagnostics };
