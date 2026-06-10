// knip duplicate-exports adapter: parse knip's `duplicates` issue category
// (duplicate export aliases) and build provenance-stamped findings. This is a
// pass-through over the target's own knip verdict; source clone detection remains
// the separate jscpd-backed `duplicates` check.

import { changedFilesFromScope, sortFindingsByFileMessage, toPosix } from "./path-util.js";
import type { DetectorScope } from "./scope.js";
import type { DriftFinding, FindingProvenance } from "./types.js";

export type KnipDuplicateExportSymbol = {
  readonly name: string;
  readonly line?: number;
  readonly col?: number;
};

export type KnipDuplicateExportGroup = {
  readonly file: string;
  readonly symbols: readonly KnipDuplicateExportSymbol[];
};

export type ParseKnipDuplicatesResult =
  | { readonly ok: true; readonly groups: readonly KnipDuplicateExportGroup[] }
  | { readonly ok: false; readonly error: string };

// Parse the `duplicates` category from `knip --reporter json` (knip 6.14.1
// shape): `{ "issues": [{ "file": "src/a.ts", "duplicates": [[{ "name",
// "line", "col", "pos" }, ...]] }] }`. A missing/non-array category is "no
// duplicate export rows" for this adapter, not a parser failure.
export function parseKnipDuplicates(jsonText: string): ParseKnipDuplicatesResult {
  if (jsonText.trim().length === 0) return { ok: false, error: "knip produced no JSON output" };
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  if (!isObject(raw)) return { ok: false, error: "expected a JSON object with an 'issues' array" };
  const issues = raw["issues"];
  if (!Array.isArray(issues)) return { ok: true, groups: [] };
  const groups: KnipDuplicateExportGroup[] = [];
  for (const row of issues) groups.push(...groupsFromRow(row));
  return { ok: true, groups };
}

function groupsFromRow(row: unknown): KnipDuplicateExportGroup[] {
  if (!isObject(row)) return [];
  const file = row["file"];
  const duplicates = row["duplicates"];
  if (typeof file !== "string" || file.length === 0 || !Array.isArray(duplicates)) return [];
  const posixFile = toPosix(file);
  const groups: KnipDuplicateExportGroup[] = [];
  for (const group of duplicates) {
    const parsed = groupFromItems(posixFile, group);
    if (parsed !== undefined) groups.push(parsed);
  }
  return groups;
}

function groupFromItems(file: string, group: unknown): KnipDuplicateExportGroup | undefined {
  if (!Array.isArray(group)) return undefined;
  const symbols = group.flatMap(symbolFromItem);
  return symbols.length < 2 ? undefined : { file, symbols };
}

function symbolFromItem(item: unknown): readonly KnipDuplicateExportSymbol[] {
  if (!isObject(item)) return [];
  const name = item["name"];
  if (typeof name !== "string" || name.length === 0) return [];
  return [{ name, ...locationFromItem(item) }];
}

// --- findings ---------------------------------------------------------------

export const KNIP_DUPLICATES_REPAIR_HINT =
  "if the aliases are redundant, keep one exported name and update callers; if the alias is intentional public API compatibility, add it to the target's knip ignore config so the duplicate-export signal stays clean.";

export function buildKnipDuplicateFindings(
  groups: readonly KnipDuplicateExportGroup[],
  detectorScope: DetectorScope,
  provenance: FindingProvenance,
): DriftFinding[] {
  const inScope = filterGroupsToScope(groups, detectorScope);
  const findings = inScope.map<DriftFinding>((group) => ({
    check: "knip-duplicates",
    file: group.file,
    message: messageFor(group),
    hint: KNIP_DUPLICATES_REPAIR_HINT,
    details: {
      category: "duplicates",
      symbols: group.symbols.map((symbol) => symbol.name),
      symbolCount: group.symbols.length,
    },
    provenance,
  }));
  return sortFindingsByFileMessage(findings);
}

function messageFor(group: KnipDuplicateExportGroup): string {
  const symbols = group.symbols.map((symbol) => symbolLabel(group.file, symbol)).join(", ");
  return `duplicate export aliases ${symbols} (knip reports them as duplicate exports)`;
}

function symbolLabel(file: string, symbol: KnipDuplicateExportSymbol): string {
  const location = fullLocation(symbol);
  return location === undefined
    ? `${symbol.name} (${file})`
    : `${symbol.name} (${file}:${String(location.line)}:${String(location.col)})`;
}

function filterGroupsToScope(
  groups: readonly KnipDuplicateExportGroup[],
  detectorScope: DetectorScope,
): KnipDuplicateExportGroup[] {
  const inScope = scopeFileSet(detectorScope);
  return groups.filter((group) => inScope.has(toPosix(group.file)));
}

function scopeFileSet(detectorScope: DetectorScope): ReadonlySet<string> {
  if (detectorScope.scopeMode === "current") {
    return new Set(detectorScope.files.map((file) => toPosix(file.path)));
  }
  return new Set(changedFilesFromScope(detectorScope).map((file) => toPosix(file.path)));
}

function locationFromItem(
  item: Record<string, unknown>,
): { readonly line: number; readonly col: number } | undefined {
  const line = positiveIntegerOrUndefined(item["line"]);
  const col = positiveIntegerOrUndefined(item["col"]);
  return line === undefined || col === undefined ? undefined : { line, col };
}

function fullLocation(
  symbol: KnipDuplicateExportSymbol,
): { readonly line: number; readonly col: number } | undefined {
  const line = positiveIntegerOrUndefined(symbol.line);
  const col = positiveIntegerOrUndefined(symbol.col);
  return line === undefined || col === undefined ? undefined : { line, col };
}

function positiveIntegerOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
