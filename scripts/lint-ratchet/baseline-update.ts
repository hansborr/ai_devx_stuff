import type {
  LintRatchetBaseline,
  LintRatchetOrphanBaselineItem,
  LintRatchetOrphanRemoval,
  LintRatchetUpdateDecision,
} from "../lint-ratchet-baseline.js";
import { compareCurrentToBaseline as compareCurrentToBaselineImpl } from "../lint-ratchet-baseline-compare.js";
import type { LintRatchetConfig } from "../lint-ratchet-config.js";
import { currentByIdFromBaseline } from "./baseline-format.js";
import {
  ratchetRegressionReasonFailure,
  RATCHET_REGRESSION_REASON_PLACEHOLDER,
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
  return Object.entries(test.items)
    .map(([path, item]) => ({ path, ...item }))
    .sort((left, right) => left.path.localeCompare(right.path));
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
    `this looks like a rename or removal — pass --allow-worse --reason "${RATCHET_REGRESSION_REASON_PLACEHOLDER}" ` +
    "so count protection is not bypassed silently"
  );
}

export function decideLintRatchetUpdate(
  committed: LintRatchetBaseline,
  generated: LintRatchetBaseline,
  ratchets: readonly LintRatchetConfig[],
  options: { readonly allowWorse: boolean; readonly reason?: string },
): LintRatchetUpdateDecision {
  const comparison = compareCurrentToBaselineImpl(
    committed,
    ratchets,
    currentByIdFromBaseline(generated),
  );
  const failures: string[] = [];
  const warnings: string[] = [];
  const reason = options.reason?.trim() ?? "";
  if (comparison.regressions.length > 0 && !options.allowWorse) {
    failures.push(
      `generated baseline is worse for ${String(comparison.regressions.length)} path(s); ` +
        `pass --allow-worse --reason "${RATCHET_REGRESSION_REASON_PLACEHOLDER}" to accept intentional new debt`,
    );
  }

  const orphanRemovals = collectOrphanRemovals(committed, ratchets);
  const orphanFailure = formatOrphanFailure(orphanRemovals);
  if (orphanFailure !== undefined && !options.allowWorse) {
    failures.push(orphanFailure);
  }
  if (options.allowWorse) {
    const reasonFailure = ratchetRegressionReasonFailure(reason);
    if (reasonFailure !== undefined) failures.push(reasonFailure);
  }

  const zeroToNonzero = detectZeroToNonzeroTransitions(committed, generated);
  if (zeroToNonzero.length > 0) {
    warnings.push(...formatZeroToNonzeroWarnings(zeroToNonzero));
  }

  return { ...comparison, allowed: failures.length === 0, failures, warnings, orphanRemovals };
}
