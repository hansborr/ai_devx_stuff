import type {
  LintRatchetBaseline,
  LintRatchetComparison,
  LintRatchetCoverageShrink,
  LintRatchetImprovement,
  LintRatchetMetricMigration,
  LintRatchetRegression,
  LintRatchetUpdateOptions,
} from "./baseline.js";
import { collectCoverageShrinkDiffs, collectMetricChangeDiffs } from "./lifecycle-diff.js";
import { isRatchetRegressionReasonPlaceholder } from "./recovery-command.js";

// Update-time lifecycle collectors: the non-count changes an update can make to
// a surviving ratchet (a glob-driven coverage shrink or a metric migration).
// Both need a reasoned debt-log record because their effect is not captured by
// the per-path count comparison, and both are mirrored by the accounting-side
// checks in baseline-debt-accounting-lifecycle.ts. The diff cores live in
// lifecycle-diff.ts, shared with the accounting side; only the record shapes
// differ per side.

export function collectCoverageShrinks(
  committed: LintRatchetBaseline,
  generated: LintRatchetBaseline,
): readonly LintRatchetCoverageShrink[] {
  return collectCoverageShrinkDiffs(committed, generated).map(({ testId, ...shrink }) => ({
    ratchetId: testId,
    ...shrink,
  }));
}

// A metric change on a surviving ratchet is not a regression or an improvement:
// the two metrics' per-path values are not comparable. Collect them so the gate
// can demand a reasoned migration record and the comparison can exclude them.
export function collectMetricMigrations(
  committed: LintRatchetBaseline,
  generated: LintRatchetBaseline,
): readonly LintRatchetMetricMigration[] {
  return collectMetricChangeDiffs(committed, generated).map((change) => ({
    ratchetId: change.testId,
    ruleId: change.ruleId,
    fromMetric: change.fromMetric,
    toMetric: change.toMetric,
  }));
}

// The ESLint finding `count` is carried by every metric, so count and new-path
// deltas stay comparable across a metric change; only the metric-specific
// line/complexity/message-fingerprint deltas are meaningless once the metric
// changed. These sets name the reasons that survive a migration; typing them
// from the reason unions makes a union rename a compile error instead of a
// silently broken filter.
const COUNT_COMPARABLE_REGRESSION_REASONS: ReadonlySet<LintRatchetRegression["reason"]> = new Set([
  "new-path",
  "increased-count",
]);
const COUNT_COMPARABLE_IMPROVEMENT_REASONS: ReadonlySet<LintRatchetImprovement["reason"]> = new Set(
  ["removed-path", "lower-count"],
);

// For a migrated ratchet, keep only the count-comparable regressions/improvements
// and drop the metric-specific deltas (line/complexity) plus message-swap infos,
// whose per-path values were measured against the old metric. A real count
// increase during a migration therefore still demands --allow-worse and produces
// an accepted-debt entry alongside the metric-migration record.
export function excludeIncomparableMigratedDeltas(
  comparison: LintRatchetComparison,
  migratedIds: ReadonlySet<string>,
): LintRatchetComparison {
  if (migratedIds.size === 0) return comparison;
  const survives = <Reason extends string>(
    entry: { readonly testId: string; readonly reason: Reason },
    comparable: ReadonlySet<Reason>,
  ): boolean => !migratedIds.has(entry.testId) || comparable.has(entry.reason);
  return {
    regressions: comparison.regressions.filter((entry) =>
      survives(entry, COUNT_COMPARABLE_REGRESSION_REASONS),
    ),
    improvements: comparison.improvements.filter((entry) =>
      survives(entry, COUNT_COMPARABLE_IMPROVEMENT_REASONS),
    ),
    ...(comparison.infos === undefined
      ? {}
      : { infos: comparison.infos.filter((entry) => !migratedIds.has(entry.testId)) }),
  };
}

export function metricMigrationFailure(
  metricMigrations: readonly LintRatchetMetricMigration[],
  options: LintRatchetUpdateOptions,
): string | undefined {
  if (metricMigrations.length === 0) return undefined;
  // --migration-reason answers the migration's own question when supplied;
  // otherwise --reason is the supported fallback, including for a mixed update.
  // Name the flag whose value was actually validated so the operator fixes the
  // bad rationale they passed.
  const reason = (options.migrationReason ?? options.reason)?.trim() ?? "";
  if (reason.length > 0 && !isRatchetRegressionReasonPlaceholder(reason)) return undefined;
  const flag = options.migrationReason === undefined ? "--reason" : "--migration-reason";
  const changes = metricMigrations
    .map((migration) => `${migration.ratchetId} (${migration.fromMetric} → ${migration.toMetric})`)
    .join(", ");
  return (
    `changing a ratchet metric for ${changes} needs ` +
    `${flag} "<why the new metric is the right measure>" so the migration is recorded in the ` +
    "debt log; per-path values are not comparable across metrics"
  );
}
