import type {
  LintRatchetBaseline,
  LintRatchetBaselineValidationFailure,
  LintRatchetRuleSourceHashesById,
} from "./baseline.js";
import { parseLintRatchetBaseline, parseLintRatchetBaselineStructure } from "./baseline.js";
import type { LintRatchetConfig } from "./config-types.js";
import type { LintRatchetWorkflowVocabulary } from "./engine-context.js";
import { DEFAULT_BASELINE_FILENAME } from "./engine-context.js";

export interface ParsedBaselineWithRuleSourceDrift {
  readonly baseline?: LintRatchetBaseline;
  readonly failures: readonly string[];
  readonly ruleSourceIdentityDrift: boolean;
}

function isOnlyRuleSourceStaleFailure(
  failures: readonly LintRatchetBaselineValidationFailure[],
): boolean {
  return failures.length > 0 && failures.every((failure) => failure.code === "rule-source-drift");
}

export function parseBaselineWithRuleSourceDrift(
  text: string,
  ratchets: readonly LintRatchetConfig[],
  ruleSourceHashesById: LintRatchetRuleSourceHashesById,
  options: {
    readonly workflowVocabulary: LintRatchetWorkflowVocabulary;
    readonly baselineFile?: string;
  },
): ParsedBaselineWithRuleSourceDrift {
  const baselineFile = options.baselineFile ?? DEFAULT_BASELINE_FILENAME;
  const strict = parseLintRatchetBaseline(text, ratchets, ruleSourceHashesById, {
    workflowVocabulary: options.workflowVocabulary,
    baselineFile,
  });
  if (strict.baseline !== undefined) {
    return { baseline: strict.baseline, failures: [], ruleSourceIdentityDrift: false };
  }
  if (!isOnlyRuleSourceStaleFailure(strict.validationFailures)) {
    return { failures: strict.failures, ruleSourceIdentityDrift: false };
  }

  const structural = parseLintRatchetBaselineStructure(
    text,
    options.workflowVocabulary,
    undefined,
    baselineFile,
  );
  if (structural.baseline === undefined) {
    return {
      failures: [...strict.failures, ...structural.failures],
      ruleSourceIdentityDrift: false,
    };
  }
  return {
    baseline: structural.baseline,
    failures: strict.failures,
    ruleSourceIdentityDrift: true,
  };
}

// Whether an equal-count message swap could be detected across every compared
// message-count baseline item. The swap detector needs a messagesFingerprint on
// both sides (see equalCountMessageSwapInfo); freshly collected current items
// always carry one, so the only gap is a baseline item that predates the
// fingerprint. When any message-count baseline item lacks it, an equal-count
// swap on that path is invisible and "findings unchanged" cannot be claimed.
export function equalCountSwapsProvable(
  baseline: LintRatchetBaseline,
  ratchets: readonly LintRatchetConfig[],
): boolean {
  for (const ratchet of ratchets) {
    if (ratchet.metric !== "message-count") continue;
    const test = baseline.tests[ratchet.id];
    if (test === undefined) continue;
    for (const item of Object.values(test.items)) {
      if (item.messagesFingerprint === undefined) return false;
    }
  }
  return true;
}

export function formatRuleSourceDriftClassification(
  changedCount: number,
  baselineDisplayName: string,
  options: {
    readonly workflowVocabulary: LintRatchetWorkflowVocabulary;
    readonly infoCount?: number;
    readonly equalCountSwapsProvable?: boolean;
  },
): string {
  const infoCount = options.infoCount ?? 0;
  const swapsProvable = options.equalCountSwapsProvable ?? true;
  if (changedCount === 0 && infoCount === 0) {
    // "findings unchanged" is only provable when every compared message-count
    // item carries a messagesFingerprint; without it, an equal-count message
    // swap is invisible (see equalCountMessageSwapInfo), so the honest claim
    // narrows to the finding counts.
    if (!swapsProvable) {
      return (
        `lint:ratchet rule source identity drift only — finding counts unchanged from ${baselineDisplayName} ` +
        "(equal-count message swaps not provable without messagesFingerprint); " +
        `run ${options.workflowVocabulary.updateCommand} to refresh ruleSourceHash metadata`
      );
    }
    return (
      `lint:ratchet rule source identity drift only — findings unchanged from ${baselineDisplayName}; ` +
      `run ${options.workflowVocabulary.updateCommand} to refresh ruleSourceHash metadata`
    );
  }
  if (changedCount === 0) {
    return (
      "lint:ratchet rule source identity drift — finding set changed (informational finding changes only); " +
      `counts match ${baselineDisplayName}, but ${String(infoCount)} informational equal-count swap(s) were reported; ` +
      `run ${options.workflowVocabulary.updateCommand} after reviewing the info findings`
    );
  }
  return (
    "lint:ratchet rule source identity drift — finding set changed; inspect diagnostics, " +
    `then run ${options.workflowVocabulary.updateCommand} after fixing or accepting the finding changes`
  );
}
