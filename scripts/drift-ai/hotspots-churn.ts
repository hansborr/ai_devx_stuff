// Churn lens: top files by churn (revisions, or lines when the collector
// auto-switched on squash detection), each row carrying full actionability
// context. A THRESHOLDED list, not a fixed top-N: a file only shows if it stands
// out from the in-window distribution (score ≥ factor × median). A flat
// distribution yields "no clear hotspots this window" and zero rows — never
// padded to N (brainstorm §1.8 move 4). Evidence, not verdicts: the noisy real
// top-N (CHANGELOG / lockfile / i18n) is shown, never auto-filtered.

import { buildCommitIntentOverlay } from "./commit-intent.js";
import { aggregateAuthors, recentSubjects, shellQuoteArg } from "./hotspots-actionability.js";
import type { ChurnHotspot, ChurnSection } from "./hotspots-format.js";
import type { CollectedHistory, CommitRecord } from "./hotspots-history.js";

export const DEFAULT_CHURN_STANDOUT_FACTOR = 2; // a row qualifies at ≥ factor × median churn

export type ReduceChurnOptions = {
  readonly top: number;
  readonly standoutFactor?: number;
};

type ChurnAggregate = { revisions: number; linesChanged: number };

export function reduceChurn(history: CollectedHistory, options: ReduceChurnOptions): ChurnSection {
  const standoutFactor = options.standoutFactor ?? DEFAULT_CHURN_STANDOUT_FACTOR;
  const aggregates = aggregateChurn(history.records);
  const scored = [...aggregates.entries()].map(([path, aggregate]) => ({
    path,
    revisions: aggregate.revisions,
    linesChanged: aggregate.linesChanged,
    score: history.metric === "lines" ? aggregate.linesChanged : aggregate.revisions,
  }));
  const medianScore = median(scored.map((entry) => entry.score));
  const threshold = standoutFactor * medianScore;
  const standouts = scored
    .filter((entry) => entry.score >= threshold && entry.score > medianScore)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path, "en"))
    .slice(0, options.top);
  const entries = standouts.map((entry) => withContext(entry, history.records));
  return {
    lens: "churn",
    metric: history.metric,
    standoutFactor,
    medianScore,
    emptyReason: entries.length === 0 ? emptyReason(scored.length) : null,
    entries,
  };
}

function aggregateChurn(records: readonly CommitRecord[]): Map<string, ChurnAggregate> {
  const byPath = new Map<string, ChurnAggregate>();
  for (const record of records) {
    const counted = new Set<string>();
    for (const file of record.files) {
      const aggregate = byPath.get(file.path) ?? { revisions: 0, linesChanged: 0 };
      if (!counted.has(file.path)) {
        aggregate.revisions += 1;
        counted.add(file.path);
      }
      aggregate.linesChanged += file.added + file.deleted;
      byPath.set(file.path, aggregate);
    }
  }
  return byPath;
}

function withContext(
  entry: { path: string; revisions: number; linesChanged: number; score: number },
  records: readonly CommitRecord[],
): ChurnHotspot {
  const touches = (record: CommitRecord): boolean =>
    record.files.some((file) => file.path === entry.path);
  const subjects = recentSubjects(records, touches);
  return {
    ...entry,
    authors: aggregateAuthors(records, touches),
    recentSubjects: subjects,
    commitIntent: buildCommitIntentOverlay(subjects),
    inspectCommand: `git log --oneline -- ${shellQuoteArg(entry.path)}`,
    baseline: null,
  };
}

function emptyReason(touchedFiles: number): string {
  if (touchedFiles === 0) return "no files changed in-window.";
  return "no clear hotspots this window (distribution flat — nothing stands out above the median).";
}

// Median of the in-window touched set's churn scores (average of the two middle
// values for an even count). Used as the standout reference, not for ranking.
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
