import type {
  LintRatchetBaseline,
  LintRatchetRuleSourceHashesById,
} from "./lint-ratchet-baseline.js";
import {
  parseLintRatchetBaseline,
  parseLintRatchetBaselineStructure,
} from "./lint-ratchet-baseline.js";
import type { LintRatchetConfig } from "./lint-ratchet-config.js";
import { BASELINE_FILENAME } from "./paths.js";

const RULE_SOURCE_STALE_FAILURE_PATTERN =
  /^ratchet\/[a-z0-9]+(?:-[a-z0-9]+)*\.ruleSourceHash is stale \(run "bun run lint:ratchet:update" to regenerate\)$/u;

export interface ParsedBaselineWithRuleSourceDrift {
  readonly baseline?: LintRatchetBaseline;
  readonly failures: readonly string[];
  readonly ruleSourceIdentityDrift: boolean;
}

function isOnlyRuleSourceStaleFailure(failures: readonly string[]): boolean {
  return (
    failures.length > 0 &&
    failures.every((failure) => RULE_SOURCE_STALE_FAILURE_PATTERN.test(failure))
  );
}

export function parseBaselineWithRuleSourceDrift(
  text: string,
  ratchets: readonly LintRatchetConfig[],
  ruleSourceHashesById: LintRatchetRuleSourceHashesById,
): ParsedBaselineWithRuleSourceDrift {
  const strict = parseLintRatchetBaseline(text, ratchets, ruleSourceHashesById);
  if (strict.baseline !== undefined) {
    return { baseline: strict.baseline, failures: [], ruleSourceIdentityDrift: false };
  }
  if (!isOnlyRuleSourceStaleFailure(strict.failures)) {
    return { failures: strict.failures, ruleSourceIdentityDrift: false };
  }

  const structural = parseLintRatchetBaselineStructure(text);
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

export function formatRuleSourceDriftClassification(changedCount: number, infoCount = 0): string {
  if (changedCount === 0 && infoCount === 0) {
    return (
      `lint:ratchet rule source identity drift only - current findings match ${BASELINE_FILENAME}; ` +
      "run bun run lint:ratchet:update to refresh ruleSourceHash metadata"
    );
  }
  if (changedCount === 0) {
    return (
      "lint:ratchet rule source identity drift with informational finding changes; " +
      `counts match ${BASELINE_FILENAME}, but ${String(infoCount)} informational equal-count swap(s) were reported; ` +
      "run bun run lint:ratchet:update after reviewing the info findings"
    );
  }
  return (
    "lint:ratchet rule source identity drift changed current findings; inspect diagnostics, " +
    "then run bun run lint:ratchet:update after fixing or accepting the finding changes"
  );
}
