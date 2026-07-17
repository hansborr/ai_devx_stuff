import { compareByCodepoint } from "../lib/codepoint-compare.js";
import type {
  LintRatchetBaseline,
  LintRatchetComparison,
  LintRatchetCoverageShrink,
  LintRatchetMetricMigration,
  LintRatchetOrphanBaselineItem,
  LintRatchetOrphanRemoval,
  LintRatchetRetireRequest,
  LintRatchetUpdateDecision,
  LintRatchetUpdateOptions,
} from "./baseline.js";
import { compareCurrentToBaseline as compareCurrentToBaselineImpl } from "./baseline-compare.js";
import { currentByIdFromBaseline } from "./baseline-format.js";
import {
  collectCoverageShrinks,
  collectMetricMigrations,
  excludeIncomparableMigratedDeltas,
  metricMigrationFailure,
} from "./baseline-update-lifecycle.js";
import type { LintRatchetConfig } from "./lint-ratchet-config.js";
import {
  RATCHET_REGRESSION_REASON_PLACEHOLDER,
  ratchetRegressionReasonFailure,
} from "./recovery-command.js";

interface ZeroToNonzeroPath {
  readonly path: string;
  readonly count: number;
}

interface ZeroToNonzeroTransition {
  readonly testId: string;
  readonly ruleId: string;
  readonly newPaths: readonly ZeroToNonzeroPath[];
}

function detectZeroToNonzeroTransitions(
  committed: LintRatchetBaseline,
  generated: LintRatchetBaseline,
): readonly ZeroToNonzeroTransition[] {
  const transitions: ZeroToNonzeroTransition[] = [];
  for (const [testId, genTest] of Object.entries(generated.tests)) {
    const committedTest = committed.tests[testId];
    if (committedTest === undefined) continue;
    const committedEmpty = Object.keys(committedTest.items).length === 0;
    const generatedPaths = Object.entries(genTest.items)
      .map(([path, item]) => ({ path, count: item.count }))
      .sort((left, right) => left.path.localeCompare(right.path));
    if (committedEmpty && generatedPaths.length > 0) {
      transitions.push({ testId, ruleId: genTest.ruleId, newPaths: generatedPaths });
    }
  }
  return transitions;
}

export function formatZeroToNonzeroWarnings(
  transitions: readonly ZeroToNonzeroTransition[],
): readonly string[] {
  return transitions.map(
    (t) =>
      `lint:ratchet:update accepted new findings for a previously clean ratchet ` +
      `${t.testId} (rule: ${t.ruleId}): ${String(t.newPaths.length)} path(s) — ` +
      `${t.newPaths.map((entry) => `${entry.path}: ${String(entry.count)}`).join(", ")}. ` +
      `Inspect these paths before committing; fix accidental findings instead of baselining them.`,
  );
}

function orphanBaselineItems(
  test: LintRatchetBaseline["tests"][string],
): readonly LintRatchetOrphanBaselineItem[] {
  return (
    Object.entries(test.items)
      .map(([path, item]) => ({ path, ...item }))
      // codepoint order, not localeCompare — load-bearing for committed/freshness-compared
      // bytes: this snapshot is serialized into the debt-log orphan record and matched back
      // by the accounting lifecycle, which canonicalizes to compareByCodepoint.
      .sort((left, right) => compareByCodepoint(left.path, right.path))
  );
}

function allowWorseReasonSuffix(leadIn: string): string {
  return `${leadIn} --allow-worse --reason "${RATCHET_REGRESSION_REASON_PLACEHOLDER}"`;
}

// Snapshot every committed baseline entry whose id no longer matches the
// registry (a rename or removal). Always computed so an accepted --allow-worse
// run can record the exact debt being dropped; the caller decides whether the
// non-empty set is a failure (without --allow-worse) or a logged acceptance.
export function collectOrphanRemovals(
  committed: LintRatchetBaseline,
  ratchets: readonly LintRatchetConfig[],
): readonly LintRatchetOrphanRemoval[] {
  const registryIds = new Set(ratchets.map((ratchet) => ratchet.id));
  const removals: LintRatchetOrphanRemoval[] = [];
  for (const testId of Object.keys(committed.tests).sort()) {
    if (registryIds.has(testId)) continue;
    const test = committed.tests[testId];
    if (test === undefined) continue;
    removals.push({
      testId,
      ruleId: test.ruleId,
      metric: test.metric,
      baselineItems: orphanBaselineItems(test),
    });
  }
  return removals;
}

function formatOrphanFailure(
  orphanRemovals: readonly LintRatchetOrphanRemoval[],
): string | undefined {
  if (orphanRemovals.length === 0) return undefined;
  const orphanIds = orphanRemovals.map((removal) => removal.testId);
  return (
    `committed baseline carries ${String(orphanIds.length)} entr${orphanIds.length === 1 ? "y" : "ies"} ` +
    `with no matching registry id (${orphanIds.join(", ")}); ` +
    `this looks like a rename or removal — ${allowWorseReasonSuffix("pass")} ` +
    "so count protection is not bypassed silently"
  );
}

function orphanFindingTotal(orphan: LintRatchetOrphanRemoval): number {
  return orphan.baselineItems.reduce((total, item) => total + item.count, 0);
}

interface RetireResolution {
  // The id retired without --allow-worse / accepted debt, set only when promotion
  // was proven for a zero-finding orphan. Apply writes its retirement record.
  readonly retiredRatchetId?: string;
  readonly optionsAttestation?: LintRatchetRetireRequest["optionsAttestation"];
  // The retire-specific failure, if the request could not be honored.
  readonly failure?: string;
}

// Resolve an explicit --retire-ratchet request against the orphaned baseline
// entries. A zero baseline alone is not proof the guard was replaced, so the
// caller must prove normal lint now errors on the retired scope; otherwise this
// falls back to the --allow-worse + debt-log path.
function resolveRetire(
  retire: LintRatchetRetireRequest,
  orphanRemovals: readonly LintRatchetOrphanRemoval[],
): RetireResolution {
  const orphan = orphanRemovals.find((removal) => removal.testId === retire.id);
  if (orphan === undefined) {
    return {
      failure:
        `--retire-ratchet ${retire.id} requires ${retire.id} to be an orphaned committed ` +
        "baseline entry (an id removed from the registry); no such entry was found",
    };
  }
  if (orphanFindingTotal(orphan) > 0) {
    return {
      failure:
        `--retire-ratchet ${retire.id} only retires a zero-finding orphan; ${retire.id} still ` +
        `carries ${String(orphanFindingTotal(orphan))} finding(s) — drain or ` +
        `${allowWorseReasonSuffix("accept them with")} instead`,
    };
  }
  if (!retire.normalErrorProven) {
    return {
      failure:
        `--retire-ratchet ${retire.id} requires proof the rule was promoted: normal lint must ` +
        `error on the retired scope. It does not, so the guard may have been dropped without a ` +
        `replacement — ${allowWorseReasonSuffix("accept the removal with")} instead`,
    };
  }
  return {
    retiredRatchetId: retire.id,
    ...(retire.optionsAttestation === undefined
      ? {}
      : { optionsAttestation: retire.optionsAttestation }),
  };
}

interface UpdateGateResult {
  readonly failures: readonly string[];
  readonly orphanRemovals: readonly LintRatchetOrphanRemoval[];
  readonly coverageShrinks: readonly LintRatchetCoverageShrink[];
  readonly retiredRatchetId?: string;
  readonly retirementOptionsAttestation?: LintRatchetRetireRequest["optionsAttestation"];
}

interface CollectUpdateGateOptions {
  readonly committed: LintRatchetBaseline;
  readonly generated: LintRatchetBaseline;
  readonly ratchets: readonly LintRatchetConfig[];
  readonly comparison: LintRatchetComparison;
  readonly metricMigrations: readonly LintRatchetMetricMigration[];
  readonly options: LintRatchetUpdateOptions;
}

function coverageShrinkFailure(
  coverageShrinks: readonly LintRatchetCoverageShrink[],
  options: LintRatchetUpdateOptions,
): string | undefined {
  if (options.allowWorse || coverageShrinks.length === 0) return undefined;
  return (
    `registry glob changes cause a coverage shrink for ${String(coverageShrinks.length)} ratchet(s): ` +
    `${coverageShrinks.map((shrink) => `${shrink.ratchetId} (${shrink.removedPaths.join(", ")})`).join("; ")}; ` +
    `${allowWorseReasonSuffix("pass")} to accept and record the removed coverage`
  );
}

function regressionFailure(
  comparison: LintRatchetComparison,
  options: LintRatchetUpdateOptions,
): string | undefined {
  if (options.allowWorse || comparison.regressions.length === 0) return undefined;
  return (
    `generated baseline is worse for ${String(comparison.regressions.length)} path(s); ` +
    `${allowWorseReasonSuffix("pass")} to accept intentional new debt`
  );
}

function reasonFailure(options: LintRatchetUpdateOptions): string | undefined {
  if (!options.allowWorse) return undefined;
  return ratchetRegressionReasonFailure(options.reason?.trim() ?? "");
}

// Drop a proven retirement from the orphan set: a retired zero-finding,
// promotion-proven ratchet is a strict improvement, not dropped debt, so it
// must not reach the --allow-worse + debt-log gate.
function accountableOrphans(
  allOrphanRemovals: readonly LintRatchetOrphanRemoval[],
  retiredRatchetId: string | undefined,
): readonly LintRatchetOrphanRemoval[] {
  if (retiredRatchetId === undefined) return allOrphanRemovals;
  return allOrphanRemovals.filter((removal) => removal.testId !== retiredRatchetId);
}

// Collect every blocking failure for an update and the orphan set that remains
// accountable as dropped debt (a proven retirement is removed from that set).
function collectUpdateGate(params: CollectUpdateGateOptions): UpdateGateResult {
  const { committed, generated, ratchets, comparison, metricMigrations, options } = params;
  const allOrphanRemovals = collectOrphanRemovals(committed, ratchets);
  const coverageShrinks = collectCoverageShrinks(committed, generated);
  const retire =
    options.retire === undefined ? undefined : resolveRetire(options.retire, allOrphanRemovals);
  const orphanRemovals = accountableOrphans(allOrphanRemovals, retire?.retiredRatchetId);

  const failures = [
    regressionFailure(comparison, options),
    coverageShrinkFailure(coverageShrinks, options),
    metricMigrationFailure(metricMigrations, options),
    retire?.failure,
    options.allowWorse ? undefined : formatOrphanFailure(orphanRemovals),
    reasonFailure(options),
  ].filter((failure): failure is string => failure !== undefined);

  return {
    failures,
    orphanRemovals,
    coverageShrinks,
    ...(retire?.retiredRatchetId === undefined
      ? {}
      : {
          retiredRatchetId: retire.retiredRatchetId,
          ...(retire.optionsAttestation === undefined
            ? {}
            : { retirementOptionsAttestation: retire.optionsAttestation }),
        }),
  };
}

export function decideLintRatchetUpdate(
  committed: LintRatchetBaseline,
  generated: LintRatchetBaseline,
  ratchets: readonly LintRatchetConfig[],
  options: LintRatchetUpdateOptions,
): LintRatchetUpdateDecision {
  const metricMigrations = collectMetricMigrations(committed, generated);
  const migratedIds = new Set(metricMigrations.map((migration) => migration.ratchetId));
  const comparison = excludeIncomparableMigratedDeltas(
    compareCurrentToBaselineImpl(committed, ratchets, currentByIdFromBaseline(generated)),
    migratedIds,
  );
  const gate = collectUpdateGate({
    committed,
    generated,
    ratchets,
    comparison,
    metricMigrations,
    options,
  });

  const warnings = formatZeroToNonzeroWarnings(
    detectZeroToNonzeroTransitions(committed, generated),
  );

  const allowed = gate.failures.length === 0;
  return {
    ...comparison,
    allowed,
    failures: gate.failures,
    warnings,
    orphanRemovals: gate.orphanRemovals,
    coverageShrinks: gate.coverageShrinks,
    metricMigrations,
    ...(allowed && gate.retiredRatchetId !== undefined
      ? {
          retiredRatchetId: gate.retiredRatchetId,
          ...(gate.retirementOptionsAttestation === undefined
            ? {}
            : { retirementOptionsAttestation: gate.retirementOptionsAttestation }),
        }
      : {}),
  };
}
