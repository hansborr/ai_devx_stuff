import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const PORTING_SECTION_HEADING = "## Porting This";
const PORTING_README_PATH = "scripts/ai-hooks/README.md";
const PORTING_SCAN_ROOTS = ["scripts"] as const;
const SKIPPED_DIRECTORY_NAMES = new Set(["fixtures", "node_modules", "tests"]);
const CHECKLIST_ID_PATTERN = /^- `([a-z0-9]+(?:-[a-z0-9]+)*)`(?:\s|$)/u;
const SOURCE_MARKER_PATTERN = /^\s*(?:#|\/\/)\s*porting-knob:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\b/gmu;

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function parsePortingChecklist(readme: string): readonly string[] {
  const lines = readme.split(/\r?\n/u);
  const headingIndex = lines.indexOf(PORTING_SECTION_HEADING);
  if (headingIndex < 0) return [];

  const ids: string[] = [];
  for (const line of portingSectionLines(lines, headingIndex)) {
    const match = CHECKLIST_ID_PATTERN.exec(line);
    if (match?.[1] !== undefined) ids.push(match[1]);
  }
  return ids;
}

function portingSectionLines(lines: readonly string[], headingIndex: number): readonly string[] {
  const sectionLines: string[] = [];
  for (const line of lines.slice(headingIndex + 1)) {
    if (/^#{1,6} /u.test(line)) break;
    sectionLines.push(line);
  }
  return sectionLines;
}

export function collectPortingKnobMarkers(
  sources: ReadonlyMap<string, string>,
): ReadonlyMap<string, readonly string[]> {
  const pathsById = new Map<string, Set<string>>();
  for (const [path, source] of sources) {
    for (const match of source.matchAll(SOURCE_MARKER_PATTERN)) {
      const id = match[1];
      if (id === undefined) continue;
      let paths = pathsById.get(id);
      if (paths === undefined) {
        paths = new Set<string>();
        pathsById.set(id, paths);
      }
      paths.add(path);
    }
  }

  return new Map(
    [...pathsById.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([id, paths]) => [id, [...paths].sort(compareText)] as const),
  );
}

function malformedChecklistBulletFailures(readme: string): readonly string[] {
  const lines = readme.split(/\r?\n/u);
  const headingIndex = lines.indexOf(PORTING_SECTION_HEADING);
  const failures: string[] = [];
  for (const line of portingSectionLines(lines, headingIndex)) {
    if (line.startsWith("- ") && !CHECKLIST_ID_PATTERN.test(line)) {
      failures.push(`Porting This bullet is missing a leading \`porting-knob\` id: ${line}`);
    }
  }
  return failures;
}

export function portingKnobParityFailures(
  readme: string,
  sources: ReadonlyMap<string, string>,
): readonly string[] {
  if (!readme.split(/\r?\n/u).includes(PORTING_SECTION_HEADING)) {
    return [`${PORTING_README_PATH} is missing the Porting This section`];
  }

  const checklist = parsePortingChecklist(readme);
  const markers = collectPortingKnobMarkers(sources);
  const checklistIds = new Set<string>();
  const failures = [...malformedChecklistBulletFailures(readme)];

  for (const id of checklist) {
    if (checklistIds.has(id)) {
      failures.push(`Porting This contains duplicate marker id: ${id}`);
    }
    checklistIds.add(id);
  }
  for (const id of checklistIds) {
    if (!markers.has(id)) {
      failures.push(`Porting This documents marker without a source comment: ${id}`);
    }
  }
  for (const [id, paths] of markers) {
    if (!checklistIds.has(id)) {
      failures.push(`source marker is missing from Porting This: ${id} (${paths.join(", ")})`);
    }
  }

  return failures;
}

function collectSourceFiles(root: string, directory: string, sources: Map<string, string>): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
        collectSourceFiles(root, join(directory, entry.name), sources);
      }
      continue;
    }
    if (!entry.isFile()) continue;

    const path = join(directory, entry.name);
    const source = readFileSync(path, "utf8");
    if (!source.includes("\0")) sources.set(relative(root, path), source);
  }
}

export function checkPortingKnobParity(repoRoot: string): readonly string[] {
  const sources = new Map<string, string>();
  for (const scanRoot of PORTING_SCAN_ROOTS) {
    collectSourceFiles(repoRoot, join(repoRoot, scanRoot), sources);
  }
  return portingKnobParityFailures(
    readFileSync(join(repoRoot, PORTING_README_PATH), "utf8"),
    sources,
  );
}
