import type { LINT_RATCHET_BASELINE_VERSION } from "./baseline-constants.js";
import { compareCurrentToBaseline as compareCurrentToBaselineImpl } from "./lint-ratchet-baseline-compare.js";
import type {
  JsonValue,
  LintRatchetConfig,
  LintRatchetMetric,
  LintRatchetMode,
} from "./lint-ratchet-config.js";
import type { LintRatchetMetricItem } from "./lint-ratchet-metrics.js";

type LintRatchetBaselineItem = LintRatchetMetricItem;

interface LintRatchetBaselineTest {
  readonly ruleId: string;
  readonly mode: LintRatchetMode;
  readonly target: number;
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

export interface LintRatchetComparison {
  readonly regressions: readonly LintRatchetRegression[];
  readonly improvements: readonly LintRatchetImprovement[];
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

export interface LintRatchetUpdateDecision extends LintRatchetComparison {
  readonly allowed: boolean;
  readonly failures: readonly string[];
  readonly warnings: readonly string[];
  readonly orphanRemovals: readonly LintRatchetOrphanRemoval[];
}

export interface ParsedLintRatchetBaseline {
  readonly baseline?: LintRatchetBaseline;
  readonly failures: readonly string[];
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
  RULE_ID_PATTERN,
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
