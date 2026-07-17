import type {
  CheckFinding,
  ConfigSurfaceCoverageEntry,
  PathPattern,
  TableRow,
} from "./lint-coverage-map-check-types.js";

export const RATCHET_ID_PATTERN = /ratchet\/[a-z0-9-]+/gu;
const VALID_STATUS_PARTS = new Set([
  "linted",
  "ratcheted",
  "proposed",
  "pending-leaf",
  "excluded",
  "not-code",
]);

const COMPATIBLE_STATUS_PARTS = new Map<string, ReadonlySet<string>>([
  ["linted", new Set(["linted", "ratcheted", "proposed", "pending-leaf"])],
  ["ratcheted", new Set(["linted", "ratcheted", "proposed", "pending-leaf"])],
  ["proposed", new Set(["linted", "ratcheted", "proposed", "pending-leaf"])],
  ["pending-leaf", new Set(["linted", "ratcheted", "proposed", "pending-leaf"])],
  ["excluded", new Set(["excluded", "not-code"])],
  ["not-code", new Set(["excluded", "not-code"])],
]);

export function validStatusParts(status: string): string[] {
  const parts = status.split("+").map((part) => part.trim());
  return parts.length > 0 && parts.every((part) => VALID_STATUS_PARTS.has(part)) ? parts : [];
}

function isValidStatus(status: string): boolean {
  return validStatusParts(status).length > 0;
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

const MAP_DOC_PATH = "docs/generated/lint-coverage-map.md";

function appendLineFindingsSection(
  lines: string[],
  title: string,
  findings: readonly CheckFinding[],
): void {
  if (findings.length === 0) return;
  lines.push("", title);
  for (const finding of findings) lines.push(`- line ${String(finding.line)}: ${finding.value}`);
}

function appendValueFindingsSection(
  lines: string[],
  title: string,
  findings: readonly CheckFinding[],
): void {
  if (findings.length === 0) return;
  lines.push("", title);
  for (const finding of findings) lines.push(`- ${finding.value}`);
}

function appendUnaccountedSection(lines: string[], unaccounted: readonly CheckFinding[]): void {
  if (unaccounted.length > 0) {
    lines.push("", "Unaccounted tracked files:");
    lines.push(...groupByDirectory(unaccounted.map((finding) => finding.value)));
    lines.push(
      `Add each to ${MAP_DOC_PATH}. The first rooted full path in a \`Path / group\` cell`,
      "sets the base dir for subsequent bare filenames in that cell. Run",
      "`bun run docs:lint-coverage-map:suggest` for ready-to-paste rows.",
    );
  }
}

export function formatFindings(findings: readonly CheckFinding[]): string {
  const lines = ["lint-coverage-map-check found drift:"];
  const stale = findings.filter((finding) => finding.kind === "stale-path");
  const unknown = findings.filter((finding) => finding.kind === "unknown-ratchet");
  const invalid = findings.filter((finding) => finding.kind === "invalid-status");
  const statusConsistency = findings.filter(
    (finding) => finding.kind === "status-consistency-mismatch",
  );
  const ratchetMembership = findings.filter(
    (finding) => finding.kind === "ratchet-membership-mismatch",
  );
  const conflicts = findings.filter((finding) => finding.kind === "conflicting-coverage");
  const configSurfaceMismatches = findings.filter(
    (finding) => finding.kind === "config-surface-coverage-mismatch",
  );
  const unaccounted = findings.filter((finding) => finding.kind === "unaccounted-file");
  const eslintReachMissing = findings.filter((finding) => finding.kind === "eslint-reach-missing");
  appendLineFindingsSection(lines, "Stale path/group patterns:", stale);
  appendLineFindingsSection(lines, "Unknown ratchet IDs:", unknown);
  appendLineFindingsSection(lines, "Invalid status values:", invalid);
  appendLineFindingsSection(lines, "Normal-lint / status inconsistencies:", statusConsistency);
  appendLineFindingsSection(lines, "Ratchet membership mismatches:", ratchetMembership);
  appendValueFindingsSection(lines, "Conflicting coverage rows:", conflicts);
  appendValueFindingsSection(lines, "Config surface coverage mismatches:", configSurfaceMismatches);
  appendUnaccountedSection(lines, unaccounted);
  appendLineFindingsSection(lines, "ESLint reach gaps:", eslintReachMissing);
  return `${lines.join("\n")}\n`;
}

const GLOB_META_PATTERN = /[*?{}[\]]/u;

function stalePathHint(
  pattern: PathPattern,
  trackedFiles: readonly string[],
  worktreeExists: (relativePath: string) => boolean,
): string {
  // A concrete (non-glob) path that exists in the worktree but matched no
  // tracked file is almost always an un-`git add`-ed new file, not a typo.
  if (GLOB_META_PATTERN.test(pattern.pattern)) return "";
  const tracked = new Set(trackedFiles);
  if (tracked.has(pattern.pattern)) return "";
  if (!worktreeExists(pattern.pattern)) return "";
  return "; did you forget to `git add` it?";
}

export function collectStalePathFindings(
  pathPatterns: readonly PathPattern[],
  trackedFiles: readonly string[],
  worktreeExists: (relativePath: string) => boolean,
): CheckFinding[] {
  return pathPatterns
    .filter((p) => !trackedFiles.some(p.matcher))
    .map(
      (p): CheckFinding => ({
        kind: "stale-path",
        line: p.line,
        value: `\`${p.source}\` (${p.pattern}) matched 0 tracked files${stalePathHint(p, trackedFiles, worktreeExists)}`,
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

interface CoverageRowMatch {
  readonly line: number;
  readonly status: string;
  readonly statusParts: readonly string[];
}

const MIN_CONFLICTING_COVERAGE_ROWS = 2;
const CONFIG_SURFACE_COVERAGE_STATUS = "linted";
const CONFIG_SURFACE_FILE_PATTERN = /(?:^|\/)[^/]+\.config\.[^/]+$/u;
const CONFIG_SURFACE_FILE_EXTENSIONS = new Set(["js", "mjs", "ts"]);

interface ConfigSurfaceCoverageFindingOptions {
  readonly configSurfaceEntries: readonly ConfigSurfaceCoverageEntry[];
  readonly trackedFiles: readonly string[];
  readonly rows: readonly TableRow[];
  readonly extractPathPatterns: (row: TableRow) => readonly PathPattern[];
  readonly trackedFileIsInScope: (file: string) => boolean;
}

interface RowWithPatterns {
  readonly row: TableRow;
  readonly patterns: readonly PathPattern[];
}

function matchedCoverageRows(
  file: string,
  rowsWithPatterns: readonly RowWithPatterns[],
): CoverageRowMatch[] {
  return rowsWithPatterns
    .filter(({ patterns }) => patterns.some((pattern) => pattern.matcher(file)))
    .map(
      ({ row }): CoverageRowMatch => ({
        line: row.line,
        status: row.status,
        statusParts: validStatusParts(row.status),
      }),
    )
    .filter((match) => match.statusParts.length > 0);
}

function statusesAreCompatible(
  leftParts: readonly string[],
  rightParts: readonly string[],
): boolean {
  return leftParts.every((left) => {
    const compatible = COMPATIBLE_STATUS_PARTS.get(left);
    return compatible !== undefined && rightParts.every((right) => compatible.has(right));
  });
}

function hasConflictingStatus(matches: readonly CoverageRowMatch[]): boolean {
  return matches.some((left, leftIndex) =>
    matches
      .slice(leftIndex + 1)
      .some((right) => !statusesAreCompatible(left.statusParts, right.statusParts)),
  );
}

function formatCoverageMatches(matches: readonly CoverageRowMatch[]): string {
  return matches.map((match) => `line ${String(match.line)} \`${match.status}\``).join("; ");
}

export function collectConflictingCoverageFindings(
  trackedFiles: readonly string[],
  rows: readonly TableRow[],
  extractPathPatterns: (row: TableRow) => readonly PathPattern[],
  trackedFileIsInScope: (file: string) => boolean,
): CheckFinding[] {
  const rowsWithPatterns = rows.map((row) => ({ row, patterns: extractPathPatterns(row) }));
  return trackedFiles.filter(trackedFileIsInScope).flatMap((file): CheckFinding[] => {
    const matches = matchedCoverageRows(file, rowsWithPatterns);

    if (matches.length < MIN_CONFLICTING_COVERAGE_ROWS || !hasConflictingStatus(matches)) return [];
    return [
      {
        kind: "conflicting-coverage",
        value: `\`${file}\` matched incompatible statuses: ${formatCoverageMatches(matches)}`,
      },
    ];
  });
}

function formatConfigSurfaceCoverageValue(
  entry: ConfigSurfaceCoverageEntry,
  matches: readonly CoverageRowMatch[],
): string {
  const matchedStatuses = matches.length === 0 ? "none" : formatCoverageMatches(matches);
  return `\`${entry.path}\` expected coverage status \`${entry.coverageStatus}\` from config-surface manifest; matched statuses: ${matchedStatuses}`;
}

function formatUnmanifestedConfigSurfaceCoverageValue(
  path: string,
  matches: readonly CoverageRowMatch[],
): string {
  return `\`${path}\` is linted as a config surface in the coverage map but is missing from config-surface manifest; matched statuses: ${formatCoverageMatches(matches)}`;
}

function isConfigSurfaceFilePath(path: string): boolean {
  if (!CONFIG_SURFACE_FILE_PATTERN.test(path)) return false;
  const extensionIndex = path.lastIndexOf(".");
  if (extensionIndex < 0) return false;
  return CONFIG_SURFACE_FILE_EXTENSIONS.has(path.slice(extensionIndex + 1));
}

export function collectConfigSurfaceCoverageFindings(
  options: ConfigSurfaceCoverageFindingOptions,
): CheckFinding[] {
  const { configSurfaceEntries, extractPathPatterns, rows, trackedFileIsInScope, trackedFiles } =
    options;
  const rowsWithPatterns = rows.map((row) => ({ row, patterns: extractPathPatterns(row) }));
  const manifestPaths = new Set(configSurfaceEntries.map((entry) => entry.path));
  const manifestFindings = configSurfaceEntries.flatMap((entry): CheckFinding[] => {
    const matches = matchedCoverageRows(entry.path, rowsWithPatterns);
    const hasExpectedStatus = matches.some((match) =>
      match.statusParts.includes(entry.coverageStatus),
    );
    if (hasExpectedStatus) return [];
    return [
      {
        kind: "config-surface-coverage-mismatch",
        value: formatConfigSurfaceCoverageValue(entry, matches),
      },
    ];
  });
  const unmanifestedFindings = trackedFiles
    .filter(trackedFileIsInScope)
    .filter(isConfigSurfaceFilePath)
    .filter((file) => !manifestPaths.has(file))
    .flatMap((file): CheckFinding[] => {
      const matches = matchedCoverageRows(file, rowsWithPatterns).filter((match) =>
        match.statusParts.includes(CONFIG_SURFACE_COVERAGE_STATUS),
      );
      if (matches.length === 0) return [];
      return [
        {
          kind: "config-surface-coverage-mismatch",
          value: formatUnmanifestedConfigSurfaceCoverageValue(file, matches),
        },
      ];
    });

  return [...manifestFindings, ...unmanifestedFindings];
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
