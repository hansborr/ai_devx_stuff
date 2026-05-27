import type { LintRatchetBaseline, LintRatchetUpdateDecision } from "../lint-ratchet-baseline.js";
import { compareCurrentToBaseline as compareCurrentToBaselineImpl } from "../lint-ratchet-baseline-compare.js";
import type { LintRatchetConfig } from "../lint-ratchet-config.js";
import { currentByIdFromBaseline } from "./baseline-format.js";

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

function collectOrphanFailure(
  committed: LintRatchetBaseline,
  ratchets: readonly LintRatchetConfig[],
): string | undefined {
  const registryIds = new Set(ratchets.map((ratchet) => ratchet.id));
  const orphanIds = Object.keys(committed.tests)
    .filter((id) => !registryIds.has(id))
    .sort();
  if (orphanIds.length === 0) return undefined;
  return (
    `committed baseline carries ${String(orphanIds.length)} entr${orphanIds.length === 1 ? "y" : "ies"} ` +
    `with no matching registry id (${orphanIds.join(", ")}); ` +
    'this looks like a rename or removal — pass --allow-worse --reason "<why>" ' +
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
        'pass --allow-worse --reason "<why>" to accept intentional new debt',
    );
  }

  const orphanFailure = collectOrphanFailure(committed, ratchets);
  if (orphanFailure !== undefined && !options.allowWorse) {
    failures.push(orphanFailure);
  }
  if (options.allowWorse && reason.length === 0) {
    failures.push("--allow-worse requires a non-empty --reason");
  }

  const zeroToNonzero = detectZeroToNonzeroTransitions(committed, generated);
  if (zeroToNonzero.length > 0) {
    warnings.push(...formatZeroToNonzeroWarnings(zeroToNonzero));
  }

  return { ...comparison, allowed: failures.length === 0, failures, warnings };
}
