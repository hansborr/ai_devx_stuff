import { DriftAiError } from "./errors.js";
import type { ScopeMode } from "./scope.js";
import type { DriftCheckId, DriftChunkManifest, DriftFinding, DriftFindingChunk } from "./types.js";

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
  const chunkCount = Math.ceil(grouped.length / chunkSize);
  const chunks: DriftFindingChunk[] = [];
  for (let offset = 0; offset < grouped.length; offset += chunkSize) {
    const slice = grouped.slice(offset, offset + chunkSize);
    const first = slice[0];
    if (first === undefined) continue;
    chunks.push({
      schemaVersion: 1,
      scopeMode,
      roots,
      enabledChecks,
      totalFindings: findings.length,
      chunkSize,
      chunkIndex: chunks.length + 1,
      chunkCount,
      check: first.check,
      findings: slice,
    });
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
    schemaVersion: 1,
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
): DriftFinding[] {
  const grouped: DriftFinding[] = [];
  for (const check of orderedChunkChecks(findings, enabledChecks)) {
    grouped.push(...findings.filter((finding) => finding.check === check));
  }
  return grouped;
}

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
