import type { BacklogLintFinding, BacklogLintFindingKind } from "./backlog-lint-types.js";

function findingsForKind(
  findings: readonly BacklogLintFinding[],
  kind: BacklogLintFindingKind,
): BacklogLintFinding[] {
  return findings.filter((finding) => finding.kind === kind);
}

function findingLine(finding: BacklogLintFinding): string {
  const line = finding.line === undefined ? "" : `:${String(finding.line)}`;
  return `- ${finding.path}${line} - ${finding.message}`;
}

function appendFindingSection(
  lines: string[],
  title: string,
  findings: readonly BacklogLintFinding[],
): void {
  if (findings.length === 0) return;
  lines.push("", title);
  for (const finding of findings) lines.push(findingLine(finding));
}

export function formatBacklogLintResult(
  checkedCount: number,
  findings: readonly BacklogLintFinding[],
): string {
  if (findings.length === 0) {
    return `backlog:lint OK - ${String(checkedCount)} note(s) checked; 0 advisory finding(s).\n`;
  }
  const lines = [
    `backlog:lint advisory findings - ${String(findings.length)} finding(s) across ${String(checkedCount)} note(s).`,
    "This script is report-only; fix these when touching the note or triaging the pack.",
  ];
  appendFindingSection(lines, "Missing Status:", findingsForKind(findings, "missing-status"));
  appendFindingSection(lines, "Empty Status:", findingsForKind(findings, "empty-status"));
  appendFindingSection(lines, "Missing Date:", findingsForKind(findings, "missing-date"));
  appendFindingSection(lines, "Invalid Date:", findingsForKind(findings, "invalid-date"));
  appendFindingSection(lines, "Stale Notes:", findingsForKind(findings, "stale-note"));
  return `${lines.join("\n")}\n`;
}
