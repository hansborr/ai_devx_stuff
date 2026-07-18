import type { LintRatchetBaseline } from "./baseline.js";
import type { LintRatchetMetric } from "./config-types.js";
import { matchesRatchet } from "./ratchet-globs.js";

// Shared base->current lifecycle diff cores. The update side
// (baseline-update-lifecycle.ts) uses these to decide which coverage-shrink and
// metric-migration debt-log records get written; the accounting side
// (baseline-debt-accounting-lifecycle.ts) independently recomputes the same
// diff and replays the written records against it. The two sides are
// writer/checker coupled: if their removedPaths filter, glob comparison, or
// sort ever drift, records written by an update stop satisfying the accounting
// gate on a later innocent commit — so the diff logic must exist exactly once.

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export interface CoverageShrinkDiff {
  readonly testId: string;
  readonly ruleId: string;
  readonly previousFiles: readonly string[];
  readonly currentFiles: readonly string[];
  readonly previousIgnores: readonly string[];
  readonly currentIgnores: readonly string[];
  readonly removedPaths: readonly string[];
}

interface MetricChangeDiff {
  readonly testId: string;
  readonly ruleId: string;
  readonly fromMetric: LintRatchetMetric;
  readonly toMetric: LintRatchetMetric;
}

export function collectCoverageShrinkDiffs(
  baseBaseline: LintRatchetBaseline,
  currentBaseline: LintRatchetBaseline,
): readonly CoverageShrinkDiff[] {
  return Object.keys(currentBaseline.tests).flatMap((testId) => {
    const previous = baseBaseline.tests[testId];
    const current = currentBaseline.tests[testId];
    if (previous === undefined || current === undefined) return [];
    if (
      equalStrings(previous.files, current.files) &&
      equalStrings(previous.ignores, current.ignores)
    ) {
      return [];
    }
    const removedPaths = Object.keys(previous.items)
      .filter((path) => current.items[path] === undefined && !matchesRatchet(current, path))
      .sort();
    if (removedPaths.length === 0) return [];
    return [
      {
        testId,
        ruleId: current.ruleId,
        previousFiles: previous.files,
        currentFiles: current.files,
        previousIgnores: previous.ignores,
        currentIgnores: current.ignores,
        removedPaths,
      },
    ];
  });
}

export function collectMetricChangeDiffs(
  baseBaseline: LintRatchetBaseline,
  currentBaseline: LintRatchetBaseline,
): readonly MetricChangeDiff[] {
  return Object.keys(currentBaseline.tests).flatMap((testId) => {
    const previous = baseBaseline.tests[testId];
    const current = currentBaseline.tests[testId];
    if (previous === undefined || current === undefined) return [];
    if (previous.metric === current.metric) return [];
    return [
      {
        testId,
        ruleId: current.ruleId,
        fromMetric: previous.metric,
        toMetric: current.metric,
      },
    ];
  });
}
