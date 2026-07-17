// Suppression-churn lens: a second git pass over suppression-changing patches.
// This intentionally does NOT reduce over the shared numstat collector; the
// collector has no content signal about lines that gained/lost suppressions.

import { DEFAULT_DRIFT_AI_CONFIG, type DriftAiIgnoreConfig } from "./config.js";
import { type GitRunner, isIgnoredPath } from "./git-changed-scope.js";
import { buildRowActionability, shellQuoteArg } from "./hotspots-actionability.js";
import type { SuppressionChurnHotspot, SuppressionChurnSection } from "./hotspots-format.js";
import { buildGitLogWalkArgs } from "./hotspots-git-log.js";
import { type CommitRecord, parseGitLog } from "./hotspots-history.js";

const SUPPRESSION_CHURN_PATTERN = "eslint-disable|@ts-";
const DEFAULT_SUPPRESSION_CHURN_MIN_CHANGES = 2;

export type CollectSuppressionChurnOptions = {
  readonly git: GitRunner;
  readonly windowDays: number;
  readonly ignore?: DriftAiIgnoreConfig;
};

export type ReduceSuppressionChurnOptions = {
  readonly top: number;
  readonly minChanges?: number;
  readonly skipReason?: string | null;
};

type SuppressionCandidate = {
  readonly path: string;
  readonly suppressionChanges: number;
  readonly score: number;
};

export function collectSuppressionChurnRecords(
  options: CollectSuppressionChurnOptions,
): CommitRecord[] {
  // Shares the identical base args (incl. --no-renames) with the numstat history
  // walk via buildGitLogWalkArgs; only the --name-only mode and the -G pickaxe
  // that narrows to suppression-changing patches differ.
  const output = options.git(
    buildGitLogWalkArgs({
      windowDays: options.windowDays,
      numstat: false,
      pickaxe: SUPPRESSION_CHURN_PATTERN,
    }),
  );
  const ignore = options.ignore ?? DEFAULT_DRIFT_AI_CONFIG.ignore;
  return parseGitLog(output, { numstat: false }).map((record) => filterRecordFiles(record, ignore));
}

export function reduceSuppressionChurn(
  records: readonly CommitRecord[],
  options: ReduceSuppressionChurnOptions,
): SuppressionChurnSection {
  const minChanges = options.minChanges ?? DEFAULT_SUPPRESSION_CHURN_MIN_CHANGES;
  if (options.skipReason !== undefined && options.skipReason !== null) {
    return {
      lens: "suppression-churn",
      pattern: SUPPRESSION_CHURN_PATTERN,
      minChanges,
      emptyReason: options.skipReason,
      entries: [],
    };
  }
  const candidates = [...aggregateSuppressionChanges(records).entries()]
    .map(([path, suppressionChanges]) => ({
      path,
      suppressionChanges,
      score: suppressionChanges,
    }))
    .filter((candidate) => candidate.suppressionChanges >= minChanges)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path, "en"))
    .slice(0, options.top);
  return {
    lens: "suppression-churn",
    pattern: SUPPRESSION_CHURN_PATTERN,
    minChanges,
    emptyReason:
      candidates.length === 0
        ? `no suppression-churn hotspots this window (no file has at least ${minChanges} suppression-changing commits).`
        : null,
    entries: candidates.map((candidate) => withContext(candidate, records)),
  };
}

function filterRecordFiles(record: CommitRecord, ignore: DriftAiIgnoreConfig): CommitRecord {
  return { ...record, files: record.files.filter((file) => !isIgnoredPath(file.path, ignore)) };
}

function aggregateSuppressionChanges(records: readonly CommitRecord[]): Map<string, number> {
  const byPath = new Map<string, number>();
  for (const record of records) {
    for (const path of new Set(record.files.map((file) => file.path))) {
      byPath.set(path, (byPath.get(path) ?? 0) + 1);
    }
  }
  return byPath;
}

function withContext(
  candidate: SuppressionCandidate,
  records: readonly CommitRecord[],
): SuppressionChurnHotspot {
  // Same path-keyed touch predicate as the other lenses, but the inspect command
  // carries the `-G'<pattern>'` so re-running it lands on the suppression-changing
  // patches rather than every commit touching the file.
  return {
    ...candidate,
    ...buildRowActionability(records, {
      touches: (record) => record.files.some((file) => file.path === candidate.path),
      inspectCommand: `git log --oneline -G'${SUPPRESSION_CHURN_PATTERN}' -- ${shellQuoteArg(
        candidate.path,
      )}`,
    }),
  };
}
