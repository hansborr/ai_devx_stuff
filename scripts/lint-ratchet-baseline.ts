import type { LINT_RATCHET_BASELINE_VERSION } from "./lint-ratchet/baseline-constants.js";
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

export interface LintRatchetUpdateDecision extends LintRatchetComparison {
  readonly allowed: boolean;
  readonly failures: readonly string[];
  readonly warnings: readonly string[];
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
} from "./lint-ratchet/baseline-format.js";
export {
  computeCoreLintRatchetRuleSourceHash,
  computeLintRatchetConfigHash,
  LINT_RATCHET_CONFIG_HASH_PREFIX,
  RULE_ID_PATTERN,
  ruleNamespace,
} from "./lint-ratchet/baseline-hash.js";
export {
  decideLintRatchetUpdate,
  formatZeroToNonzeroWarnings,
} from "./lint-ratchet/baseline-update.js";
export {
  parseLintRatchetBaseline,
  parseLintRatchetBaselineStructure,
} from "./lint-ratchet/baseline-validation.js";
export { validateLintRatchetRegistry } from "./lint-ratchet/registry-validation.js";

export function compareCurrentToBaseline(
  baseline: LintRatchetBaseline,
  ratchets: readonly LintRatchetConfig[],
  currentById: LintRatchetCurrentById,
): LintRatchetComparison {
  return compareCurrentToBaselineImpl(baseline, ratchets, currentById);
}
