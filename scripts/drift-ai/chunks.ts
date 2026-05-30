import { DriftAiError } from "./errors.js";
import type { ScopeMode } from "./scope.js";
import {
  DRIFT_SCHEMA_VERSION,
  type DriftCheckId,
  type DriftChunkManifest,
  type DriftFinding,
  type DriftFindingChunk,
} from "./types.js";

export function groupFindingsForChunks(
  findings: readonly DriftFinding[],
  scopeMode: ScopeMode,
  roots: readonly string[],
  enabledChecks: readonly DriftCheckId[],
  chunkSize: number,
): DriftFindingChunk[] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new DriftAiError("drift:ai: chunkSize must be a positive integer.");
  }
  const grouped = groupFindingsByCheck(findings, enabledChecks);
  const chunkCount = grouped.reduce(
    (total, group) => total + Math.ceil(group.findings.length / chunkSize),
    0,
  );
  const chunks: DriftFindingChunk[] = [];
  for (const group of grouped) {
    for (let offset = 0; offset < group.findings.length; offset += chunkSize) {
      const slice = group.findings.slice(offset, offset + chunkSize);
      chunks.push({
        schemaVersion: DRIFT_SCHEMA_VERSION,
        scopeMode,
        roots,
        enabledChecks,
        totalFindings: findings.length,
        chunkSize,
        chunkIndex: chunks.length + 1,
        chunkCount,
        check: group.check,
        findings: slice,
      });
    }
  }
  return chunks;
}

export function buildChunkManifest(
  scopeMode: ScopeMode,
  roots: readonly string[],
  enabledChecks: readonly DriftCheckId[],
  totalFindings: number,
  chunkSize: number,
  chunks: readonly DriftFindingChunk[],
): DriftChunkManifest {
  return {
    schemaVersion: DRIFT_SCHEMA_VERSION,
    scopeMode,
    roots,
    enabledChecks,
    totalFindings,
    chunkSize,
    chunks: chunks.map((chunk) => ({
      index: chunk.chunkIndex,
      path: chunkFilename(chunk.chunkIndex, chunk.check),
      check: chunk.check,
      findingCount: chunk.findings.length,
    })),
  };
}

function groupFindingsByCheck(
  findings: readonly DriftFinding[],
  enabledChecks: readonly DriftCheckId[],
): FindingGroup[] {
  const grouped: FindingGroup[] = [];
  for (const check of orderedChunkChecks(findings, enabledChecks)) {
    const checkFindings = findings.filter((finding) => finding.check === check);
    if (checkFindings.length > 0) grouped.push({ check, findings: checkFindings });
  }
  return grouped;
}

type FindingGroup = {
  readonly check: DriftCheckId;
  readonly findings: readonly DriftFinding[];
};

function orderedChunkChecks(
  findings: readonly DriftFinding[],
  enabledChecks: readonly DriftCheckId[],
): DriftCheckId[] {
  const present = new Set(findings.map((finding) => finding.check));
  const ordered = enabledChecks.filter((check) => present.has(check));
  const extras = [...present]
    .filter((check) => !enabledChecks.includes(check))
    .sort((left, right) => left.localeCompare(right, "en"));
  return [...ordered, ...extras];
}

export function chunkFilename(globalIndex: number, check: DriftCheckId): string {
  return `${String(globalIndex).padStart(3, "0")}-${check}.json`;
}

export function formatStableJson(value: DriftFindingChunk | DriftChunkManifest): string {
  return JSON.stringify(value, null, 2);
}
