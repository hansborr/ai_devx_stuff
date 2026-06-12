import type { CheckFinding, PathPattern, TableRow } from "./lint-coverage-map-check-types.js";

const RATCHET_ID_PATTERN = /ratchet\/[a-z0-9-]+/gu;
const VALID_STATUS_PARTS = new Set([
  "linted",
  "ratcheted",
  "proposed",
  "pending-leaf",
  "excluded",
  "not-code",
]);

function isValidStatus(status: string): boolean {
  const parts = status.split("+").map((part) => part.trim());
  return parts.length > 0 && parts.every((part) => VALID_STATUS_PARTS.has(part));
}

function groupByDirectory(files: readonly string[]): string[] {
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const slash = file.lastIndexOf("/");
    const directory = slash < 0 ? "." : file.slice(0, slash);
    const bucket = groups.get(directory) ?? [];
    bucket.push(file);
    groups.set(directory, bucket);
  }
  const lines: string[] = [];
  for (const [directory, groupFiles] of [...groups.entries()].sort()) {
    lines.push(`- ${directory}:`);
    for (const file of groupFiles) lines.push(`    ${file}`);
  }
  return lines;
}

export function formatFindings(findings: readonly CheckFinding[]): string {
  const lines = ["lint-coverage-map-check found drift:"];
  const stale = findings.filter((finding) => finding.kind === "stale-path");
  const unknown = findings.filter((finding) => finding.kind === "unknown-ratchet");
  const invalid = findings.filter((finding) => finding.kind === "invalid-status");
  const unaccounted = findings.filter((finding) => finding.kind === "unaccounted-file");
  const eslintReachMissing = findings.filter((finding) => finding.kind === "eslint-reach-missing");
  if (stale.length > 0) {
    lines.push("", "Stale path/group patterns:");
    for (const finding of stale) lines.push(`- line ${String(finding.line)}: ${finding.value}`);
  }
  if (unknown.length > 0) {
    lines.push("", "Unknown ratchet IDs:");
    for (const finding of unknown) lines.push(`- line ${String(finding.line)}: ${finding.value}`);
  }
  if (invalid.length > 0) {
    lines.push("", "Invalid status values:");
    for (const finding of invalid) lines.push(`- line ${String(finding.line)}: ${finding.value}`);
  }
  if (unaccounted.length > 0) {
    lines.push("", "Unaccounted tracked files:");
    lines.push(...groupByDirectory(unaccounted.map((finding) => finding.value)));
  }
  if (eslintReachMissing.length > 0) {
    lines.push("", "ESLint reach gaps:");
    for (const finding of eslintReachMissing)
      lines.push(`- line ${String(finding.line)}: ${finding.value}`);
  }
  return `${lines.join("\n")}\n`;
}

export function collectStalePathFindings(
  pathPatterns: readonly PathPattern[],
  trackedFiles: readonly string[],
): CheckFinding[] {
  return pathPatterns
    .filter((p) => !trackedFiles.some(p.matcher))
    .map(
      (p): CheckFinding => ({
        kind: "stale-path",
        line: p.line,
        value: `\`${p.source}\` (${p.pattern}) matched 0 tracked files`,
      }),
    );
}

export function collectRowFindings(
  rows: readonly TableRow[],
  ratchetIds: ReadonlySet<string>,
): CheckFinding[] {
  return rows.flatMap((row): CheckFinding[] => [
    ...[...row.ratchets.matchAll(RATCHET_ID_PATTERN)]
      .filter((m) => !ratchetIds.has(m[0]))
      .map((m): CheckFinding => ({ kind: "unknown-ratchet", line: row.line, value: m[0] })),
    ...(isValidStatus(row.status)
      ? []
      : [{ kind: "invalid-status" as const, line: row.line, value: row.status }]),
  ]);
}

export function collectUnaccountedFileFindings(
  trackedFiles: readonly string[],
  pathPatterns: readonly PathPattern[],
  trackedFileIsInScope: (file: string) => boolean,
): CheckFinding[] {
  return trackedFiles
    .filter(trackedFileIsInScope)
    .filter((file) => !pathPatterns.some((p) => p.matcher(file)))
    .map((file): CheckFinding => ({ kind: "unaccounted-file", value: file }));
}
