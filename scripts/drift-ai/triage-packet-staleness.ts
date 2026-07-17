import type {
  StaleAdvisoryDisclosure,
  TriagePacketOptions,
  TriagePacketProvenance,
} from "./triage-packet-types.js";
import type { TriageInputSummary, TriageItem, TriageLocation } from "./triage-report-types.js";

type StaleReason = StaleAdvisoryDisclosure["reasons"][number];

const STANDARD_TRIAGE_GENERATED_ARTIFACTS = [
  "drift-all.json",
  "semgrep-candidates.json",
  "dolos-candidates.json",
] as const;

/**
 * Keep provenance probes blind to the standard report set as well as any
 * caller-declared output paths. Scanners and packet generation must use this
 * same set or one report can make a sibling advisory look stale.
 */
export function triageGeneratedArtifactExclusions(
  additionalPaths: readonly string[] = [],
): string[] {
  return [...new Set([...STANDARD_TRIAGE_GENERATED_ARTIFACTS, ...additionalPaths])];
}

export function findStaleAdvisories(
  inputs: readonly TriageInputSummary[],
  items: readonly TriageItem[],
  provenance: TriagePacketProvenance,
  readSourceFile: TriagePacketOptions["readSourceFile"],
): StaleAdvisoryDisclosure[] {
  const sourceLines = new Map<string, number | null>();
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
  sourceLines: Map<string, number | null>,
): string[] {
  if (readSourceFile === undefined) return [];
  const unresolved = new Set<string>();
  for (const location of items.flatMap((item) => item.locationDetails)) {
    if (!rangeResolves(location, readSourceFile, sourceLines)) {
      unresolved.add(formatLocation(location));
    }
  }
  return [...unresolved];
}

function rangeResolves(
  location: TriageLocation,
  readSourceFile: NonNullable<TriagePacketOptions["readSourceFile"]>,
  sourceLines: Map<string, number | null>,
): boolean {
  if (location.startLine === null || location.endLine === null) return true;
  const lineCount = cachedLineCount(location.path, readSourceFile, sourceLines);
  return (
    lineCount !== null &&
    Number.isInteger(location.startLine) &&
    Number.isInteger(location.endLine) &&
    location.startLine >= 1 &&
    location.endLine >= location.startLine &&
    location.endLine <= lineCount
  );
}

function cachedLineCount(
  path: string,
  readSourceFile: NonNullable<TriagePacketOptions["readSourceFile"]>,
  sourceLines: Map<string, number | null>,
): number | null {
  const cached = sourceLines.get(path);
  if (cached !== undefined || sourceLines.has(path)) return cached ?? null;
  let lineCount: number | null;
  try {
    const contents = readSourceFile(path);
    lineCount = contents === null ? null : countLines(contents);
  } catch {
    lineCount = null;
  }
  sourceLines.set(path, lineCount);
  return lineCount;
}

function countLines(contents: string): number {
  if (contents.length === 0) return 0;
  const lines = contents.split(/\r?\n/u);
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

function formatLocation(location: TriageLocation): string {
  if (location.startLine === null || location.endLine === null) return location.path;
  return `${location.path}:${String(location.startLine)}-${String(location.endLine)}`;
}
