import type { BacklogLintFinding, BacklogLintFindingKind } from "./backlog-lint-types.js";

// Display titles keyed in OUTPUT order, which is not the union's declaration
// order ("unknown-status" is last in the union but third here); object key
// insertion order drives section emission, so this map is the single source of
// both ordering and exhaustiveness. `satisfies` makes adding a
// BacklogLintFindingKind without a display section a typecheck failure.
export const BACKLOG_LINT_SECTION_TITLES = {
  "missing-status": "Missing Status:",
  "empty-status": "Empty Status:",
  "unknown-status": "Unknown Status:",
  "missing-date": "Missing Date:",
  "invalid-date": "Invalid Date:",
  "stale-note": "Stale Notes:",
  "missing-index": "Missing Pack Index:",
  "nonstandard-index-name": "Nonstandard Index Name:",
  "index-leaf-drift": "Index/Leaf Drift:",
  "dangling-index-link": "Dangling Index Links:",
  "unlisted-leaf": "Unlisted Leaves:",
} as const satisfies Record<BacklogLintFindingKind, string>;

const SECTION_KINDS = Object.keys(BACKLOG_LINT_SECTION_TITLES) as readonly BacklogLintFindingKind[]; // type-assertion-boundary: interop - Object.keys widens the satisfies-checked map's keys to string; the literal admits only BacklogLintFindingKind keys

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
  for (const kind of SECTION_KINDS) {
    appendFindingSection(lines, BACKLOG_LINT_SECTION_TITLES[kind], findingsForKind(findings, kind));
  }
  return `${lines.join("\n")}\n`;
}
