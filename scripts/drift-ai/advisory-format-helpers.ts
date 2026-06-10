import type { BoundedFullHistory } from "./bounded-full-history.js";
import type { PrototypeCap, PrototypePrerequisite } from "./prototype-advisory.js";

export type BoundedHistoryDisclosure = {
  readonly commitCount: number;
  readonly distinctFileCount: number;
  readonly partial: boolean;
  readonly stoppedReason: BoundedFullHistory["stoppedReason"];
  readonly moreHistoryMayExist: boolean;
  readonly scannedRange: BoundedFullHistory["scannedRange"];
  readonly linesAvailable: boolean;
  readonly elapsedMs: number;
  readonly unexamined: BoundedFullHistory["unexamined"];
};

export function positiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isInteger(value) || value <= 0) return fallback;
  return value;
}

export function plural(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

export function formatPercent(value: number, fractionDigits = 0): string {
  return fractionDigits === 0
    ? `${Math.round(value * 100)}%`
    : `${(value * 100).toFixed(fractionDigits)}%`;
}

export function boundedHistoryDisclosure(history: BoundedFullHistory): BoundedHistoryDisclosure {
  return {
    commitCount: history.commitCount,
    distinctFileCount: history.distinctFileCount,
    partial: history.partial,
    stoppedReason: history.stoppedReason,
    moreHistoryMayExist: history.moreHistoryMayExist,
    scannedRange: history.scannedRange,
    linesAvailable: history.linesAvailable,
    elapsedMs: history.elapsedMs,
    unexamined: history.unexamined,
  };
}

export type BoundedHistoryAdvisoryFields = {
  readonly prerequisites: readonly PrototypePrerequisite[];
  readonly caps: readonly PrototypeCap[];
  readonly degradations: readonly string[];
};

export function boundedHistoryAdvisoryFields(
  history: BoundedFullHistory,
): BoundedHistoryAdvisoryFields {
  return {
    prerequisites: [boundedHistoryPrerequisite(history)],
    caps: history.prototypeCaps,
    degradations: [...history.degradations, history.renameCaveat],
  };
}

function boundedHistoryPrerequisite(history: BoundedFullHistory): PrototypePrerequisite {
  return {
    name: "bounded git history",
    satisfied: history.gitError === null,
    detail:
      history.gitError === null
        ? `scanned ${history.commitCount} commit(s) and ${history.distinctFileCount} distinct file path(s); stoppedReason=${history.stoppedReason}`
        : `git log failed: ${history.gitError}`,
  };
}

export function formatBoundedHistory(history: BoundedHistoryDisclosure): string {
  const partial = history.partial ? "partial" : "complete";
  const lineMode = history.linesAvailable ? "numstat lines available" : "name-only line fallback";
  return `${history.commitCount} commit(s), ${history.distinctFileCount} file path(s), ${partial}, stoppedReason=${history.stoppedReason}, ${lineMode}, elapsed ${history.elapsedMs}ms`;
}

export function formatScannedRange(range: BoundedFullHistory["scannedRange"]): string {
  const since = range.since === null ? "beginning" : `since ${range.since}`;
  const newest = formatCommitRef(range.newestCommitHash, range.newestCommitDate);
  const oldest = formatCommitRef(range.oldestCommitHash, range.oldestCommitDate);
  return `${since}; newest ${newest}; oldest ${oldest}`;
}

function formatCommitRef(hash: string | null, date: string | null): string {
  if (hash === null && date === null) return "n/a";
  if (hash === null) return date ?? "n/a";
  if (date === null) return hash;
  return `${hash} @ ${date}`;
}
