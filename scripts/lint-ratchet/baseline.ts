import { compareCurrentToBaseline as compareCurrentToBaselineImpl } from "./baseline-compare.js";
import type { LINT_RATCHET_BASELINE_VERSION } from "./baseline-constants.js";
import type {
  JsonValue,
  LintRatchetConfig,
  LintRatchetMetric,
  LintRatchetMode,
} from "./lint-ratchet-config.js";
import type { LintRatchetMetricItem } from "./metrics.js";

type LintRatchetBaselineItem = LintRatchetMetricItem;

interface LintRatchetBaselineTest {
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
  readonly version: typeof LINT_RATCHET_BASELINE_VERSION;
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
}

export interface StructuralLintRatchetBaseline {
  readonly baseline?: LintRatchetBaseline;
  readonly failures: readonly string[];
}

export {
  buildLintRatchetBaseline,
  currentByIdFromBaseline,
  formatLintRatchetBaseline,
} from "./baseline-format.js";
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
): LintRatchetComparison {
  return compareCurrentToBaselineImpl(baseline, ratchets, currentById);
}
