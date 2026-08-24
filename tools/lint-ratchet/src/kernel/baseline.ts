import { compareCurrentToBaseline as compareCurrentToBaselineImpl } from "./baseline-compare.js";
import {
  type LINT_RATCHET_BASELINE_ACCEPTED_VERSIONS,
  LINT_RATCHET_BASELINE_VERSION_POLICY,
  lintRatchetBaselineRegenerateForVersion,
  type LintRatchetBaselineVersionPolicy,
} from "./baseline-constants.js";
import {
  computeLintRatchetConfigHash,
  normalizeRuleOptions,
  normalizeStringList,
} from "./baseline-hash.js";
import { lintRatchetBaselineSpec, lintRatchetBaselineToGrouped } from "./baseline-spec.js";
import { compareByCodepoint } from "./codepoint-compare.js";
import type {
  JsonValue,
  LintRatchetConfig,
  LintRatchetMetric,
  LintRatchetMode,
} from "./config-types.js";
import type { LintRatchetWorkflowVocabulary } from "./engine-context.js";
import { formatGroupedBaseline } from "./group-baseline.js";
import { metricItemForFormat } from "./metric-strategies.js";
import type { LintRatchetMetricItem } from "./metrics-types.js";

type LintRatchetBaselineItem = LintRatchetMetricItem;

export interface LintRatchetBaselineTest {
  readonly ruleId: string;
  readonly mode: LintRatchetMode;
  readonly metric: LintRatchetMetric;
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly ruleOptions: readonly JsonValue[];
  readonly configHash: string;
  readonly ruleSourceHash: string;
  readonly items: Readonly<Record<string, LintRatchetBaselineItem>>;
}

export type LintRatchetRuleSourceHashesById = ReadonlyMap<string, string>;

export interface LintRatchetBaseline {
  readonly version: (typeof LINT_RATCHET_BASELINE_ACCEPTED_VERSIONS)[number];
  readonly regenerate?: unknown;
  readonly tests: Readonly<Record<string, LintRatchetBaselineTest>>;
}

export interface LintRatchetCurrentItem extends LintRatchetBaselineItem {
  readonly firstLine?: number;
  readonly firstMessage?: string;
  readonly firstMessageId?: string;
}

export type LintRatchetCurrentById = ReadonlyMap<
  string,
  ReadonlyMap<string, LintRatchetCurrentItem>
>;

export interface LintRatchetRegression {
  readonly testId: string;
  readonly ruleId: string;
  readonly path: string;
  readonly baselineCount: number;
  readonly currentCount: number;
  readonly baselineLines?: number;
  readonly currentLines?: number;
  readonly baselineComplexity?: number;
  readonly currentComplexity?: number;
  readonly line?: number;
  readonly firstMessage?: string;
  readonly firstMessageId?: string;
  readonly reason: "new-path" | "increased-count" | "increased-lines" | "increased-complexity";
}

export interface LintRatchetImprovement {
  readonly testId: string;
  readonly ruleId: string;
  readonly path: string;
  readonly baselineCount: number;
  readonly currentCount: number;
  readonly baselineLines?: number;
  readonly currentLines?: number;
  readonly baselineComplexity?: number;
  readonly currentComplexity?: number;
  readonly reason: "removed-path" | "lower-count" | "lower-lines" | "lower-complexity";
}

export interface LintRatchetInfo {
  readonly testId: string;
  readonly ruleId: string;
  readonly path: string;
  readonly baselineCount: number;
  readonly currentCount: number;
  readonly reason: "equal-count-message-swap";
}

export interface LintRatchetComparison {
  readonly regressions: readonly LintRatchetRegression[];
  readonly improvements: readonly LintRatchetImprovement[];
  readonly infos?: readonly LintRatchetInfo[];
}

// A committed baseline path snapshot carried when an orphaned (renamed/removed)
// ratchet id is accepted via --allow-worse, so the debt log records the exact
// count protection being dropped, not just the id.
export interface LintRatchetOrphanBaselineItem extends LintRatchetBaselineItem {
  readonly path: string;
}

export interface LintRatchetOrphanRemoval {
  readonly testId: string;
  readonly ruleId: string;
  readonly metric: LintRatchetMetric;
  readonly baselineItems: readonly LintRatchetOrphanBaselineItem[];
}

export interface LintRatchetCoverageShrink {
  readonly ratchetId: string;
  readonly ruleId: string;
  readonly previousFiles: readonly string[];
  readonly currentFiles: readonly string[];
  readonly previousIgnores: readonly string[];
  readonly currentIgnores: readonly string[];
  readonly removedPaths: readonly string[];
}

// A ratchet whose metric changed between the committed and generated baseline.
// Per-path values are not comparable across metrics, so such a change is neither
// a regression nor an improvement: the update records a reasoned migration entry
// instead, which is what the debt-accounting gate demands.
export interface LintRatchetMetricMigration {
  readonly ratchetId: string;
  readonly ruleId: string;
  readonly fromMetric: LintRatchetMetric;
  readonly toMetric: LintRatchetMetric;
}

// Proof the caller supplies so the retire path can skip --allow-worse + the
// debt log: the retired ratchet must still error under normal lint on its
// recorded scope. A zero baseline alone never proves the guard was replaced.
export interface LintRatchetRetireRequest {
  readonly id: string;
  readonly normalErrorProven: boolean;
  readonly optionsAttestation?: LintRatchetRetirementOptionsAttestation;
}

export interface LintRatchetRetirementOptionsAttestation {
  readonly reason: string;
  readonly ratchetOptions: readonly JsonValue[];
  readonly normalLintOptions: readonly (readonly JsonValue[])[];
}

// Update-time policy shared by the decide gate and the apply orchestration:
// accept a worse baseline (with reason) or retire a proven zero-finding ratchet.
export interface LintRatchetUpdateOptions {
  readonly allowWorse: boolean;
  readonly workflowVocabulary: LintRatchetWorkflowVocabulary;
  readonly reason?: string;
  // Answers "why is the new metric the right measure" on metric-migration
  // records; falls back to `reason` so a migration-only update needs one flag.
  readonly migrationReason?: string;
  readonly retire?: LintRatchetRetireRequest;
}

export interface LintRatchetUpdateDecision extends LintRatchetComparison {
  readonly allowed: boolean;
  readonly failures: readonly string[];
  readonly warnings: readonly string[];
  readonly orphanRemovals: readonly LintRatchetOrphanRemoval[];
  readonly coverageShrinks: readonly LintRatchetCoverageShrink[];
  // Ratchets whose metric changed; each needs a reasoned migration record so the
  // debt-accounting gate can account for the otherwise-incomparable per-path
  // values. Excluded from regressions/improvements for the same reason.
  readonly metricMigrations: readonly LintRatchetMetricMigration[];
  // Set only when --retire-ratchet retired a zero-finding orphan whose
  // promotion to normal lint was proven; such a retirement is a strict
  // improvement, never accepted debt, so it is excluded from orphanRemovals and
  // recorded separately as a proven retirement.
  readonly retiredRatchetId?: string;
  readonly retirementOptionsAttestation?: LintRatchetRetirementOptionsAttestation;
}

export type LintRatchetBaselineValidationFailureCode =
  | "config-hash-mismatch"
  | "files-mismatch"
  | "ignores-mismatch"
  | "metric-item-invalid"
  | "metric-mismatch"
  | "missing-ratchet"
  | "nondeterministic-json"
  | "orphan-ratchet"
  | "rule-id-mismatch"
  | "rule-options-mismatch"
  | "rule-source-drift"
  | "rule-source-hash-required"
  | "structure";

export interface LintRatchetBaselineValidationFailure {
  readonly code: LintRatchetBaselineValidationFailureCode;
  readonly message: string;
}

export interface ParsedLintRatchetBaseline {
  readonly baseline?: LintRatchetBaseline;
  readonly failures: readonly string[];
  readonly validationFailures: readonly LintRatchetBaselineValidationFailure[];
  readonly warnings: readonly string[];
}

export interface StructuralLintRatchetBaseline {
  readonly baseline?: LintRatchetBaseline;
  readonly failures: readonly string[];
}

export {
  computeCoreLintRatchetRuleSourceHash,
  computeLintRatchetConfigHash,
  LINT_RATCHET_CONFIG_HASH_PREFIX,
  ruleNamespace,
} from "./baseline-hash.js";
export {
  collectOrphanRemovals,
  decideLintRatchetUpdate,
  formatZeroToNonzeroWarnings,
} from "./baseline-update.js";
export {
  parseLintRatchetBaseline,
  parseLintRatchetBaselineStructure,
} from "./baseline-validation.js";
export { validateLintRatchetRegistry } from "./registry-validation.js";

export function compareCurrentToBaseline(
  baseline: LintRatchetBaseline,
  ratchets: readonly LintRatchetConfig[],
  currentById: LintRatchetCurrentById,
  workflowVocabulary: LintRatchetWorkflowVocabulary,
): LintRatchetComparison {
  return compareCurrentToBaselineImpl(baseline, ratchets, currentById, workflowVocabulary);
}

function positiveMetricItems(
  metric: LintRatchetConfig["metric"],
  currentItems: ReadonlyMap<string, LintRatchetCurrentItem> | undefined,
): Readonly<Record<string, LintRatchetBaselineItem>> {
  const items: Record<string, LintRatchetBaselineItem> = {};
  const sortedItems = [...(currentItems?.entries() ?? [])].sort(([left], [right]) =>
    compareByCodepoint(left, right),
  );
  for (const [path, item] of sortedItems) {
    if (item.count > 0) items[path] = metricItemForFormat(metric, item);
  }
  return items;
}

export function baselineTestFromConfig(
  config: LintRatchetConfig,
  currentItems: ReadonlyMap<string, LintRatchetCurrentItem> | undefined,
  ruleSourceHash: string,
): LintRatchetBaselineTest {
  return {
    ruleId: config.ruleId,
    mode: config.mode,
    metric: config.metric,
    files: normalizeStringList(config.files),
    ignores: normalizeStringList(config.ignores),
    ruleOptions: normalizeRuleOptions(config.ruleOptions),
    configHash: computeLintRatchetConfigHash(config),
    ruleSourceHash,
    items: positiveMetricItems(config.metric, currentItems),
  };
}

function requireRuleSourceHash(
  ruleSourceHashesById: LintRatchetRuleSourceHashesById,
  ratchetId: string,
): string {
  const hash = ruleSourceHashesById.get(ratchetId);
  if (hash === undefined) {
    throw new Error(`lint-ratchet: missing rule source hash for ${ratchetId}`);
  }
  return hash;
}

export function buildLintRatchetBaseline(
  ratchets: readonly LintRatchetConfig[],
  currentById: LintRatchetCurrentById,
  ruleSourceHashesById: LintRatchetRuleSourceHashesById,
  options: {
    readonly workflowVocabulary: LintRatchetWorkflowVocabulary;
    readonly versionPolicy?: LintRatchetBaselineVersionPolicy;
  },
): LintRatchetBaseline {
  const versionPolicy = options.versionPolicy ?? LINT_RATCHET_BASELINE_VERSION_POLICY;
  const tests: Record<string, LintRatchetBaselineTest> = {};
  for (const ratchet of ratchets) {
    tests[ratchet.id] = baselineTestFromConfig(
      ratchet,
      currentById.get(ratchet.id),
      requireRuleSourceHash(ruleSourceHashesById, ratchet.id),
    );
  }
  const regenerate = lintRatchetBaselineRegenerateForVersion(
    versionPolicy.writeVersion,
    options.workflowVocabulary.updateCommand,
  );
  return {
    version: versionPolicy.writeVersion,
    ...(regenerate === undefined ? {} : { regenerate }),
    tests,
  };
}

export function currentByIdFromBaseline(baseline: LintRatchetBaseline): LintRatchetCurrentById {
  const currentById = new Map<string, ReadonlyMap<string, LintRatchetCurrentItem>>();
  for (const [testId, test] of Object.entries(baseline.tests)) {
    const items = new Map<string, LintRatchetCurrentItem>();
    for (const [path, item] of Object.entries(test.items)) items.set(path, item);
    currentById.set(testId, items);
  }
  return currentById;
}

export function formatLintRatchetBaseline(
  baseline: LintRatchetBaseline,
  workflowVocabulary: LintRatchetWorkflowVocabulary,
): string {
  return formatGroupedBaseline(
    lintRatchetBaselineSpec(undefined, workflowVocabulary),
    lintRatchetBaselineToGrouped(baseline),
  );
}
