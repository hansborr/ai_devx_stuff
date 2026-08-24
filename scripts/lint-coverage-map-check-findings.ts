import type {
  CheckFinding,
  ConfigSurfaceCoverageEntry,
  CoveragePattern,
  CoverageRow,
} from "./lint-coverage-map-check-types.js";
import type { CoverageStatusPart } from "./lint-coverage-map-manifest-schema.js";

// Lexes ratchet claims out of an entry's `ratchets` prose. This is a partial
// pattern by construction, so `lint-coverage-map-manifest-schema.ts` refuses any
// entry whose prose contains a ratchet-shaped reference this would skip — a
// reference the lexer cannot see would render as a claim and validate as none.
export const RATCHET_ID_PATTERN = /ratchet\/[a-z0-9-]+/gu;

const COMPATIBLE_STATUS_PARTS = new Map<CoverageStatusPart, ReadonlySet<CoverageStatusPart>>([
  ["linted", new Set(["linted", "ratcheted", "proposed", "pending-leaf"])],
  ["ratcheted", new Set(["linted", "ratcheted", "proposed", "pending-leaf"])],
  ["proposed", new Set(["linted", "ratcheted", "proposed", "pending-leaf"])],
  ["pending-leaf", new Set(["linted", "ratcheted", "proposed", "pending-leaf"])],
  ["excluded", new Set(["excluded", "not-code"])],
  ["not-code", new Set(["excluded", "not-code"])],
]);

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

const MANIFEST_MODULE_GLOB = "scripts/lint-coverage-map-manifest-<area>.ts";

function appendEntryFindingsSection(
  lines: string[],
  title: string,
  findings: readonly CheckFinding[],
): void {
  if (findings.length === 0) return;
  lines.push("", title);
  for (const finding of findings)
    lines.push(`- entry \`${finding.entry ?? ""}\`: ${finding.value}`);
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
      `Add each to the coverage manifest (\`${MANIFEST_MODULE_GLOB}\`) as a new`,
      "`globs` pattern on an existing entry or as a new entry. Run",
      "`bun run docs:lint-coverage-map:suggest` for ready-to-paste entries.",
    );
  }
}

export function formatFindings(findings: readonly CheckFinding[]): string {
  const lines = ["lint-coverage-map-check found drift:"];
  const stale = findings.filter((finding) => finding.kind === "stale-path");
  const unknown = findings.filter((finding) => finding.kind === "unknown-ratchet");
  const ratchetMembership = findings.filter(
    (finding) => finding.kind === "ratchet-membership-mismatch",
  );
  const conflicts = findings.filter((finding) => finding.kind === "conflicting-coverage");
  const configSurfaceMismatches = findings.filter(
    (finding) => finding.kind === "config-surface-coverage-mismatch",
  );
  const unaccounted = findings.filter((finding) => finding.kind === "unaccounted-file");
  const filesCounts = findings.filter((finding) => finding.kind === "files-count-stale");
  const eslintReachMissing = findings.filter((finding) => finding.kind === "eslint-reach-missing");
  const eslintReachUnexpected = findings.filter(
    (finding) => finding.kind === "eslint-reach-unexpected",
  );
  appendEntryFindingsSection(lines, "Stale path/group globs:", stale);
  appendEntryFindingsSection(lines, "Unknown ratchet IDs:", unknown);
  appendEntryFindingsSection(lines, "Ratchet membership mismatches:", ratchetMembership);
  appendEntryFindingsSection(lines, "Stale Files counts:", filesCounts);
  appendValueFindingsSection(lines, "Conflicting coverage rows:", conflicts);
  appendValueFindingsSection(lines, "Config surface coverage mismatches:", configSurfaceMismatches);
  appendUnaccountedSection(lines, unaccounted);
  appendEntryFindingsSection(lines, "ESLint reach gaps:", eslintReachMissing);
  appendEntryFindingsSection(
    lines,
    "Rows normal lint reaches but that do not claim `linted`:",
    eslintReachUnexpected,
  );
  return `${lines.join("\n")}\n`;
}

const GLOB_META_PATTERN = /[*?{}[\]]/u;

function stalePathHint(
  pattern: CoveragePattern,
  trackedFiles: readonly string[],
  worktreeExists: (relativePath: string) => boolean,
): string {
  // A concrete (non-glob) path that exists in the worktree but matched no
  // tracked file is almost always an un-`git add`-ed new file, not a typo.
  if (GLOB_META_PATTERN.test(pattern.glob)) return "";
  const tracked = new Set(trackedFiles);
  if (tracked.has(pattern.glob)) return "";
  if (!worktreeExists(pattern.glob)) return "";
  return "; did you forget to `git add` it?";
}

export function collectStalePathFindings(
  patterns: readonly CoveragePattern[],
  trackedFiles: readonly string[],
  worktreeExists: (relativePath: string) => boolean,
): CheckFinding[] {
  return patterns
    .filter((pattern) => !trackedFiles.some(pattern.matcher))
    .map(
      (pattern): CheckFinding => ({
        kind: "stale-path",
        entry: pattern.entryId,
        value: `\`${pattern.glob}\` matched 0 tracked files${stalePathHint(pattern, trackedFiles, worktreeExists)}`,
      }),
    );
}

// The leading `Files` count is a derivable fact, so nothing should have to
// notice by hand when it rots. Sum the leading `N .ext [+ N .ext]...` groups —
// stopping at the first parenthetical, whose digits are prose — and compare with
// the tracked files the row's globs match. A row opts out only by writing down
// why (`filesCountNote`): a deliberate subset whose siblings own the rest, or a
// narrative cell that is not a total at all.
function assertedFileCount(filesProse: string): number | undefined {
  const head = filesProse.split("(")[0] ?? "";
  if (!/^\s*\d/u.test(head)) return undefined;
  return [...head.matchAll(/\d+/gu)].reduce((total, match) => total + Number(match[0]), 0);
}

export function collectFilesCountFindings(
  rows: readonly CoverageRow[],
  trackedFiles: readonly string[],
): CheckFinding[] {
  return rows.flatMap((row): CheckFinding[] => {
    if (row.filesCountNote !== undefined || row.filesProse === undefined) return [];
    const matched = trackedFiles.filter((file) =>
      row.patterns.some((pattern) => pattern.matcher(file)),
    ).length;
    // A row that matches nothing at all is `collectStalePathFindings`'s to
    // report; adding a count finding on top would just double the noise.
    if (matched === 0) return [];
    const asserted = assertedFileCount(row.filesProse);
    if (asserted === undefined) {
      return [
        {
          kind: "files-count-stale",
          entry: row.id,
          value: `\`Files\` cell \`${row.filesProse}\` starts with no count; give it one or add a \`filesCountNote\` saying why it is not a total`,
        },
      ];
    }
    if (asserted === matched) return [];
    return [
      {
        kind: "files-count-stale",
        entry: row.id,
        value: `\`Files\` asserts ${String(asserted)} but the row's globs match ${String(matched)} tracked file(s); correct the count, or add a \`filesCountNote\` if the difference is deliberate`,
      },
    ];
  });
}

// Status vocabulary and the normal-lint/status agreement are enforced by the
// manifest schema, so the only row-level text check left here is that a named
// ratchet id still exists in the live registry.
export function collectUnknownRatchetFindings(
  rows: readonly CoverageRow[],
  ratchetIds: ReadonlySet<string>,
): CheckFinding[] {
  return rows.flatMap((row): CheckFinding[] =>
    [...row.ratchetProse.matchAll(RATCHET_ID_PATTERN)]
      .filter((match) => !ratchetIds.has(match[0]))
      .map((match): CheckFinding => ({ kind: "unknown-ratchet", entry: row.id, value: match[0] })),
  );
}

interface CoverageRowMatch {
  readonly id: string;
  readonly statusParts: readonly CoverageStatusPart[];
}

const MIN_CONFLICTING_COVERAGE_ROWS = 2;
const CONFIG_SURFACE_COVERAGE_STATUS = "linted";
const CONFIG_SURFACE_FILE_PATTERN = /(?:^|\/)[^/]+\.config\.[^/]+$/u;
const CONFIG_SURFACE_FILE_EXTENSIONS = new Set(["js", "mjs", "ts"]);

interface ConfigSurfaceCoverageFindingOptions {
  readonly configSurfaceEntries: readonly ConfigSurfaceCoverageEntry[];
  readonly trackedFiles: readonly string[];
  readonly rows: readonly CoverageRow[];
  readonly trackedFileIsInScope: (file: string) => boolean;
}

function matchedCoverageRows(file: string, rows: readonly CoverageRow[]): CoverageRowMatch[] {
  return rows
    .filter((row) => row.patterns.some((pattern) => pattern.matcher(file)))
    .map((row): CoverageRowMatch => ({ id: row.id, statusParts: row.statusParts }));
}

function statusesAreCompatible(
  leftParts: readonly CoverageStatusPart[],
  rightParts: readonly CoverageStatusPart[],
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
  return matches
    .map((match) => `entry \`${match.id}\` \`${match.statusParts.join(" + ")}\``)
    .join("; ");
}

export function collectConflictingCoverageFindings(
  trackedFiles: readonly string[],
  rows: readonly CoverageRow[],
  trackedFileIsInScope: (file: string) => boolean,
): CheckFinding[] {
  return trackedFiles.filter(trackedFileIsInScope).flatMap((file): CheckFinding[] => {
    const matches = matchedCoverageRows(file, rows);
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
  const { configSurfaceEntries, rows, trackedFileIsInScope, trackedFiles } = options;
  const manifestPaths = new Set(configSurfaceEntries.map((entry) => entry.path));
  const manifestFindings = configSurfaceEntries.flatMap((entry): CheckFinding[] => {
    const matches = matchedCoverageRows(entry.path, rows);
    const hasExpectedStatus = matches.some((match) =>
      match.statusParts.some((part) => part === entry.coverageStatus),
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
      const matches = matchedCoverageRows(file, rows).filter((match) =>
        match.statusParts.some((part) => part === CONFIG_SURFACE_COVERAGE_STATUS),
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
  patterns: readonly CoveragePattern[],
  trackedFileIsInScope: (file: string) => boolean,
): CheckFinding[] {
  return trackedFiles
    .filter(trackedFileIsInScope)
    .filter((file) => !patterns.some((pattern) => pattern.matcher(file)))
    .map((file): CheckFinding => ({ kind: "unaccounted-file", value: file }));
}
