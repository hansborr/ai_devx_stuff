import type { TriageLocation } from "./triage-report-types.js";

const LOCATION_SUFFIX = /:\d+(?::\d+)?(?:-\d+(?::\d+)?)?$/u;
const COLUMN_LOCATION = /^(.*):(\d+):(\d+)(?:-(\d+):(\d+))?$/u;
const LINE_LOCATION = /^(.*):(\d+)(?:-(\d+))?$/u;
const TEST_FILE = /(?:\.(?:test|spec)(?:-helper)?|-test-helper)\.[^/]+$/u;
const TEST_DIRECTORY = /(?:^|\/)(?:__tests__|tests?|e2e|fixtures|test-support|examples)\//u;

export function mergeUniqueLocations(target: string[], additions: readonly string[]): void {
  const knownLocations = new Set(target);
  for (const location of additions) {
    if (!knownLocations.has(location)) {
      target.push(location);
      knownLocations.add(location);
    }
  }
}

export function mergeUniqueLocationDetails(
  target: TriageLocation[],
  additions: readonly TriageLocation[],
): void {
  const known = new Set(target.map(locationDetailKey));
  for (const location of additions) {
    const key = locationDetailKey(location);
    if (!known.has(key)) {
      target.push(location);
      known.add(key);
    }
  }
}

export function parseDisplayLocation(location: string): TriageLocation {
  const columnMatch = COLUMN_LOCATION.exec(location);
  if (columnMatch !== null) return parseColumnLocation(columnMatch, location);
  const match = LINE_LOCATION.exec(location);
  if (match === null) return locationWithoutRange(location);
  const startLine = Number(match[2]);
  const endLine = match[3] === undefined ? startLine : Number(match[3]);
  return {
    path: match[1] ?? location,
    startLine,
    startCol: null,
    endLine,
    endCol: null,
  };
}

function parseColumnLocation(match: RegExpExecArray, fallback: string): TriageLocation {
  const startLine = Number(match[2]);
  const startCol = Number(match[3]);
  return {
    path: match[1] ?? fallback,
    startLine,
    startCol,
    endLine: match[4] === undefined ? startLine : Number(match[4]),
    endCol: match[5] === undefined ? startCol : Number(match[5]),
  };
}

function locationWithoutRange(path: string): TriageLocation {
  return { path, startLine: null, startCol: null, endLine: null, endCol: null };
}

function locationDetailKey(location: TriageLocation): string {
  return JSON.stringify(location);
}

export function pairKey(locations: readonly [string, string]): string;
export function pairKey(locations: readonly string[]): string | null;
export function pairKey(locations: readonly string[]): string | null {
  if (locations.length !== 2) return null;
  const files = locations.map((location) => location.replace(LOCATION_SUFFIX, ""));
  const normalized = (files[0] === files[1] ? [...locations] : files).sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  return `pair:${normalized.join("<=>")}`;
}

export function isTestLocation(location: string): boolean {
  const file = location.replace(LOCATION_SUFFIX, "");
  return TEST_FILE.test(file) || TEST_DIRECTORY.test(file);
}
