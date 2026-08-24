import type { TriageLocation } from "./triage-report-types.js";

const LOCATION_SUFFIX = /:\d+(?::\d+)?(?:-\d+(?::\d+)?)?$/u;
const COLUMN_LOCATION = /^(.*):(\d+):(\d+)(?:-(\d+):(\d+))?$/u;
const LINE_LOCATION = /^(.*):(\d+)(?:-(\d+))?$/u;

export function locationPath(location: string): string {
  return location.replace(LOCATION_SUFFIX, "");
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

export function formatItemLocation(location: TriageLocation): string {
  if (location.startLine === null || location.endLine === null) return location.path;
  return `${location.path}:${String(location.startLine)}-${String(location.endLine)}`;
}

export function uniqueLocations(locations: readonly string[]): string[] {
  return [...new Set(locations)];
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
