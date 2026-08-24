import { readFileSync } from "node:fs";

import {
  HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
  type HarnessDiagnostics,
  harnessDiagnosticsSchema,
  type HarnessFinding,
  type HarnessFindingSeverity,
} from "@musi/harness-diagnostics/schema.js";
import {
  LOWER_COMPLEXITY_REASON,
  LOWER_COUNT_REASON,
  LOWER_LINES_REASON,
} from "@musi/lint-ratchet/kernel/baseline-compare.js";
import {
  escapeMarkdownProse,
  escapeMarkdownText,
  markdownCode,
} from "@musi/lint-ratchet/kernel/markdown-escape.js";
import { ConfigError } from "@musi/lint-ratchet/kernel/metrics-types.js";
import { regressionRecoveryFooter } from "@musi/lint-ratchet/kernel/recovery-command.js";
import { REMOVED_PATH_REASON } from "@musi/lint-ratchet/kernel/removed-path-improvements.js";

import { musiLintRatchetWorkflowVocabulary } from "./engine-binding.js";

const DEFAULT_MAX_FINDINGS_PER_CONTROL = 10;
const JSON_INDENT_SPACES = 2;
const STICKY_COMMENT_MARKER = "<!-- lint-ratchet-summary -->";
export const LINT_RATCHET_REPORT_ARTIFACT_URL_ENV = "LINT_RATCHET_REPORT_ARTIFACT_URL" as const;
// Only consulted for legacy envelopes that omit `kind`; rebuilt from the
// producers' exported reason constants so the vocabulary can't silently drift.
const IMPROVEMENT_REASONS: ReadonlySet<string> = new Set([
  LOWER_COUNT_REASON,
  LOWER_LINES_REASON,
  LOWER_COMPLEXITY_REASON,
  REMOVED_PATH_REASON,
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
  if (finding.kind !== undefined) return finding.kind === "improvement";
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
  const details = `(why: ${escapeMarkdownProse(finding.why)}; fix: ${escapeMarkdownProse(finding.howToFix)})`;
  return prefix.length === 0 ? `- ${details}` : `- ${prefix} ${details}`;
}

function recoveryLineFor(group: readonly HarnessFinding[]): string | undefined {
  const improvement = group.find(isImprovement);
  if (improvement === undefined) return undefined;
  // Both branches render intentional inline code: the builder's howToFix carries
  // a backticked command, and the fallback authors one directly.
  const updateCommand = musiLintRatchetWorkflowVocabulary.updateCommand;
  if (improvement.howToFix.includes(updateCommand)) {
    return escapeMarkdownProse(improvement.howToFix);
  }
  return `Run \`${updateCommand}\` to lock in the improvement.`;
}

function maxFindingsPerControl(options: FormatHarnessDiagnosticsReportOptions | undefined): number {
  const requested = options?.maxFindingsPerControl ?? DEFAULT_MAX_FINDINGS_PER_CONTROL;
  return Math.max(0, Math.floor(requested));
}

function truncationLine(remaining: number, hasArtifact: boolean): string {
  return hasArtifact
    ? `_${String(remaining)} more in artifact._`
    : `_${String(remaining)} more (rerun with a higher per-control limit or see the JSON envelope)._`;
}

function formatControlSection(
  control: string,
  findings: readonly HarnessFinding[],
  limit: number,
  hasArtifact: boolean,
): readonly string[] {
  const lines = [
    `#### ${markdownCode(control)} (${String(findings.length)} ${pluralize(findings.length, "finding")}, ${severityMix(findings)})`,
  ];
  for (const finding of findings.slice(0, limit)) {
    lines.push(formatFindingBullet(finding));
  }
  const remaining = findings.length - limit;
  if (remaining > 0) lines.push(truncationLine(remaining, hasArtifact));
  const recovery = recoveryLineFor(findings);
  if (recovery !== undefined) lines.push(recovery);
  return lines;
}

function footerRecoveryLine(findings: readonly HarnessFinding[]): string {
  if (findings.length === 0) return "Recovery: nothing to do.";
  const hasRegression = findings.some(
    (finding) => finding.severity === "block" && !isImprovement(finding),
  );
  if (hasRegression) return regressionRecoveryFooter(musiLintRatchetWorkflowVocabulary);
  if (findings.every((finding) => finding.severity !== "block")) {
    return "Recovery: review informational findings.";
  }
  return `Recovery: \`${musiLintRatchetWorkflowVocabulary.updateCommand}\``;
}

function artifactLine(artifactName: string): string {
  // artifactName is a URL in practice (LINT_RATCHET_REPORT_ARTIFACT_URL). Render
  // it as an autolink so GitHub keeps it clickable; escaping a URL would mangle
  // repo/org names containing `_`. A non-URL name still gets prose escaping.
  if (/^https?:\/\//u.test(artifactName)) {
    return `Artifact: <${artifactName}>`;
  }
  return `Artifact: ${escapeMarkdownText(artifactName)}`;
}

function footerLines(
  envelope: HarnessDiagnostics,
  options: FormatHarnessDiagnosticsReportOptions | undefined,
): readonly string[] {
  return [
    ...(options?.artifactName === undefined ? [] : [artifactLine(options.artifactName)]),
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
    const hasArtifact = options?.artifactName !== undefined;
    for (const [control, findings] of groupedFindings(envelope.findings)) {
      lines.push(...formatControlSection(control, findings, limit, hasArtifact), "");
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

function diagnosticsVersion(parsed: unknown): string | undefined {
  if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
    const { version } = parsed;
    return typeof version === "string" ? version : undefined;
  }
  return undefined;
}

function parseDiagnostics(input: string): HarnessDiagnostics {
  const parsed = parseJsonInput(input);
  const version = diagnosticsVersion(parsed);
  if (version !== undefined && version !== HARNESS_DIAGNOSTICS_SCHEMA_VERSION) {
    throw new ConfigError(
      `unsupported harness diagnostics version ${version}; this reader supports version ${HARNESS_DIAGNOSTICS_SCHEMA_VERSION}`,
    );
  }
  const result = harnessDiagnosticsSchema.safeParse(parsed);
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
