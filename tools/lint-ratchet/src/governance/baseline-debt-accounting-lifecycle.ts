import type { LintRatchetBaseline, LintRatchetOrphanRemoval } from "../kernel/baseline.js";
import { compareByCodepoint } from "../kernel/codepoint-compare.js";
import {
  collectCoverageShrinkDiffs,
  collectMetricChangeDiffs,
  type CoverageShrinkDiff,
} from "../kernel/lifecycle-diff.js";
import { assertNever } from "../kernel/runtime-config.js";
import type { LintRatchetDebtLogEntry } from "./debt-log-schema.js";

type BaselineTest = NonNullable<LintRatchetBaseline["tests"][string]>;

interface MissingRatchetAccountingFailure {
  readonly kind: "missing-ratchet";
  readonly testId: string;
  readonly ruleId: string;
}

interface MetricChangeAccountingFailure {
  readonly kind: "metric-change";
  readonly testId: string;
  readonly ruleId: string;
  readonly previousMetric: BaselineTest["metric"];
  readonly currentMetric: BaselineTest["metric"];
}

interface CoverageShrinkAccountingFailure extends CoverageShrinkDiff {
  readonly kind: "coverage-shrink";
  readonly unaccountedPaths: readonly string[];
  readonly hasShrinkRecords: boolean;
}

export type LifecycleAccountingFailure =
  | MissingRatchetAccountingFailure
  | MetricChangeAccountingFailure
  | CoverageShrinkAccountingFailure;

function collectMissingRatchets(
  baseBaseline: LintRatchetBaseline,
  currentBaseline: LintRatchetBaseline,
): readonly MissingRatchetAccountingFailure[] {
  return Object.keys(baseBaseline.tests)
    .filter((testId) => currentBaseline.tests[testId] === undefined)
    .map((testId) => ({
      kind: "missing-ratchet",
      testId,
      ruleId: baseBaseline.tests[testId]?.ruleId ?? "unknown",
    }));
}

function collectMetricChanges(
  baseBaseline: LintRatchetBaseline,
  currentBaseline: LintRatchetBaseline,
): readonly MetricChangeAccountingFailure[] {
  return collectMetricChangeDiffs(baseBaseline, currentBaseline).map((change) => ({
    kind: "metric-change",
    testId: change.testId,
    ruleId: change.ruleId,
    previousMetric: change.fromMetric,
    currentMetric: change.toMetric,
  }));
}

function accountsForMissingRatchet(
  failure: MissingRatchetAccountingFailure,
  baseTest: BaselineTest,
  entries: readonly LintRatchetDebtLogEntry[],
): boolean {
  return entries.some((entry) => {
    switch (entry.kind) {
      case "retirement":
        return entry.ratchetId === failure.testId && Object.keys(baseTest.items).length === 0;
      case "accepted-debt":
        return entry.orphansRemoved.some((orphan) =>
          orphanMatchesRemovedBaseline(orphan, failure.testId, baseTest),
        );
      case "coverage-shrink":
      case "metric-migration":
        return false;
      default:
        return assertNever(entry);
    }
  });
}

function orphanMatchesRemovedBaseline(
  orphan: LintRatchetOrphanRemoval,
  testId: string,
  baseTest: BaselineTest,
): boolean {
  if (
    orphan.testId !== testId ||
    orphan.ruleId !== baseTest.ruleId ||
    orphan.metric !== baseTest.metric
  ) {
    return false;
  }
  const byPath = (left: { readonly path: string }, right: { readonly path: string }): number =>
    compareByCodepoint(left.path, right.path);
  const expectedItems = Object.entries(baseTest.items)
    .map(([path, item]) => ({ path, ...item }))
    .sort(byPath);
  return JSON.stringify([...orphan.baselineItems].sort(byPath)) === JSON.stringify(expectedItems);
}

function accountsForMetricChange(
  failure: MetricChangeAccountingFailure,
  entries: readonly LintRatchetDebtLogEntry[],
): boolean {
  return entries.some((entry) => {
    switch (entry.kind) {
      case "metric-migration":
        return (
          entry.ratchetId === failure.testId &&
          entry.fromMetric === failure.previousMetric &&
          entry.toMetric === failure.currentMetric
        );
      case "accepted-debt":
      case "coverage-shrink":
      case "retirement":
        return false;
      default:
        return assertNever(entry);
    }
  });
}

// Per-path accounting, not glob-state chain replay: a widening step has no
// recordable entry (the schema rejects empty removedPaths), so requiring the
// appended records to compose from the base globs to the endpoint globs
// dead-ends permanently on narrow-then-rewiden histories. A path only lands in
// diff.removedPaths when it is genuinely out of scope at the endpoint, so it is
// enough that every such path appears in some appended coverage-shrink record
// for this ratchet. Deliberate trade: a path dropped-with-record, re-widened,
// then dropped again without a record passes via the stale union entry.
function unaccountedCoverageShrink(
  diff: CoverageShrinkDiff,
  entries: readonly LintRatchetDebtLogEntry[],
): CoverageShrinkAccountingFailure | undefined {
  const shrinkEntries = entries.flatMap((entry) => {
    switch (entry.kind) {
      case "coverage-shrink":
        return entry.ratchetId === diff.testId ? [entry] : [];
      case "accepted-debt":
      case "metric-migration":
      case "retirement":
        return [];
      default:
        return assertNever(entry);
    }
  });
  const recordedPaths = new Set(shrinkEntries.flatMap((entry) => entry.removedPaths));
  const unaccountedPaths = diff.removedPaths.filter((path) => !recordedPaths.has(path));
  if (unaccountedPaths.length === 0) return undefined;
  return {
    kind: "coverage-shrink",
    ...diff,
    unaccountedPaths,
    hasShrinkRecords: shrinkEntries.length > 0,
  };
}

export function collectUnaccountedLifecycleChanges(
  baseBaseline: LintRatchetBaseline,
  currentBaseline: LintRatchetBaseline,
  entries: readonly LintRatchetDebtLogEntry[],
): readonly LifecycleAccountingFailure[] {
  return [
    ...collectMissingRatchets(baseBaseline, currentBaseline).filter((failure) => {
      const baseTest = baseBaseline.tests[failure.testId];
      return baseTest === undefined || !accountsForMissingRatchet(failure, baseTest, entries);
    }),
    ...collectMetricChanges(baseBaseline, currentBaseline).filter(
      (failure) => !accountsForMetricChange(failure, entries),
    ),
    ...collectCoverageShrinkDiffs(baseBaseline, currentBaseline).flatMap((diff) => {
      const failure = unaccountedCoverageShrink(diff, entries);
      return failure === undefined ? [] : [failure];
    }),
  ];
}
