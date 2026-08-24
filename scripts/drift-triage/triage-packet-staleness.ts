import type {
  StaleAdvisoryDisclosure,
  TriagePacketOptions,
  TriagePacketProvenance,
} from "./triage-packet-types.js";
import type { TriageInputSummary, TriageItem, TriageLocation } from "./triage-report-types.js";

type StaleReason = StaleAdvisoryDisclosure["reasons"][number];

export function findStaleAdvisories(
  inputs: readonly TriageInputSummary[],
  items: readonly TriageItem[],
  provenance: TriagePacketProvenance,
  readSourceFile: TriagePacketOptions["readSourceFile"],
): StaleAdvisoryDisclosure[] {
  const sourceLines = new Map<string, readonly string[] | null>();
  const disclosures: StaleAdvisoryDisclosure[] = [];
  for (const input of inputs) {
    if (input.kind !== "semgrep-advisory" && input.kind !== "dolos-advisory") continue;
    const affected = items.filter((item) =>
      item.evidence.some((evidence) => evidence.inputPath === input.path),
    );
    if (affected.length === 0) continue;
    const reasons = provenanceReasons(input, provenance);
    const unresolvableLocations = unresolvedLocations(affected, readSourceFile, sourceLines);
    if (unresolvableLocations.length > 0) reasons.push("unresolvable-location");
    if (reasons.length === 0) continue;
    disclosures.push({
      inputPath: input.path,
      itemIds: affected.map((item) => item.id),
      ...(input.scanProvenance === undefined ? {} : { scanProvenance: input.scanProvenance }),
      reasons,
      unresolvableLocations,
      route: "needs-human-regenerate",
    });
  }
  return disclosures;
}

function provenanceReasons(
  input: TriageInputSummary,
  current: TriagePacketProvenance,
): StaleReason[] {
  const scan = input.scanProvenance;
  if (scan === undefined) return ["missing-scan-provenance"];
  const reasons = scanStabilityReasons(scan.changedDuringScan);
  if (scan.gitHead === null || current.gitHead === null) {
    reasons.push("provenance-unavailable");
  } else if (scan.gitHead !== current.gitHead) {
    reasons.push("git-head-mismatch");
  }
  if (scan.gitDirty === null || current.gitDirty === null) {
    if (!reasons.includes("provenance-unavailable")) reasons.push("provenance-unavailable");
  } else if (scan.gitDirty !== current.gitDirty) {
    reasons.push("dirty-state-mismatch");
  }
  appendUniqueReasons(
    reasons,
    stateFingerprintReasons(scan.stateFingerprint, current.stateFingerprint),
  );
  return reasons;
}

function stateFingerprintReasons(
  scanFingerprint: string | null | undefined,
  currentFingerprint: string | null | undefined,
): StaleReason[] {
  if (scanFingerprint === undefined) return [];
  if (scanFingerprint === null || currentFingerprint == null) return ["provenance-unavailable"];
  return scanFingerprint === currentFingerprint ? [] : ["state-fingerprint-mismatch"];
}

function appendUniqueReasons(target: StaleReason[], additions: readonly StaleReason[]): void {
  for (const reason of additions) {
    if (!target.includes(reason)) target.push(reason);
  }
}

function scanStabilityReasons(changedDuringScan: boolean | null | undefined): StaleReason[] {
  if (changedDuringScan === true) return ["repository-changed-during-scan"];
  if (changedDuringScan === null) return ["provenance-unavailable"];
  return [];
}

function unresolvedLocations(
  items: readonly TriageItem[],
  readSourceFile: TriagePacketOptions["readSourceFile"],
  sourceLines: Map<string, readonly string[] | null>,
): string[] {
  if (readSourceFile === undefined) return [];
  const unresolved = new Set<string>();
  for (const location of items.flatMap((item) => item.locationDetails)) {
    if (!rangeResolves(location, readSourceFile, sourceLines)) {
      unresolved.add(formatStalenessLocation(location));
    }
  }
  return [...unresolved];
}

function rangeResolves(
  location: TriageLocation,
  readSourceFile: NonNullable<TriagePacketOptions["readSourceFile"]>,
  sourceLines: Map<string, readonly string[] | null>,
): boolean {
  if (location.startLine === null || location.endLine === null) return true;
  const lines = cachedSourceLines(location.path, readSourceFile, sourceLines);
  if (lines === null) return false;
  if (!lineRangeValid(location.startLine, location.endLine, lines.length)) return false;
  return (
    columnsOrdered(location) &&
    columnResolves(location.startCol, lines[location.startLine - 1]) &&
    columnResolves(location.endCol, lines[location.endLine - 1])
  );
}

function lineRangeValid(startLine: number, endLine: number, lineCount: number): boolean {
  return (
    Number.isInteger(startLine) &&
    Number.isInteger(endLine) &&
    startLine >= 1 &&
    endLine >= startLine &&
    endLine <= lineCount
  );
}

// Line ordering is already guaranteed by the endLine >= startLine check above, so
// only same-line ranges need their columns compared: no match ends before it starts.
function columnsOrdered(location: TriageLocation): boolean {
  if (location.startLine !== location.endLine) return true;
  if (location.startCol === null || location.endCol === null) return true;
  return location.startCol <= location.endCol;
}

// Columns are 1-based and measured in UTF-8 bytes: Semgrep (1.165.0) derives them
// from byte offsets, so lines holding multi-byte characters have valid columns past
// their UTF-16 length. Under Semgrep's exclusive-end model both endpoints are carets
// between characters, so each resolves in 1..byteLength + 1: a zero-width match at
// end of line (or on an empty line) legitimately cites byteLength + 1 for both
// columns. Anything beyond that caret — or a same-line range ending before it
// starts — cites text the line no longer holds; stale evidence a line-count check
// alone would miss.
function columnResolves(col: number | null, lineText: string | undefined): boolean {
  if (col === null) return true;
  if (lineText === undefined) return false;
  const maxCol = Buffer.byteLength(lineText, "utf8") + 1;
  return Number.isInteger(col) && col >= 1 && col <= maxCol;
}

function cachedSourceLines(
  path: string,
  readSourceFile: NonNullable<TriagePacketOptions["readSourceFile"]>,
  sourceLines: Map<string, readonly string[] | null>,
): readonly string[] | null {
  const cached = sourceLines.get(path);
  if (cached !== undefined || sourceLines.has(path)) return cached ?? null;
  let lines: readonly string[] | null;
  try {
    const contents = readSourceFile(path);
    lines = contents === null ? null : splitLines(contents);
  } catch {
    lines = null;
  }
  sourceLines.set(path, lines);
  return lines;
}

function splitLines(contents: string): readonly string[] {
  if (contents.length === 0) return [];
  const lines = contents.split(/\r?\n/u);
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
}

function formatStalenessLocation(location: TriageLocation): string {
  if (location.startLine === null || location.endLine === null) return location.path;
  if (location.startCol !== null && location.endCol !== null) {
    return (
      `${location.path}:${String(location.startLine)}:${String(location.startCol)}` +
      `-${String(location.endLine)}:${String(location.endCol)}`
    );
  }
  return `${location.path}:${String(location.startLine)}-${String(location.endLine)}`;
}
