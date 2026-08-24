import {
  compareCurrentToBaseline,
  type LintRatchetBaseline,
  type LintRatchetRuleSourceHashesById,
} from "@musi/lint-ratchet/kernel/baseline.js";
import {
  collectCurrentById,
  DEFAULT_COLLECT_CONCURRENCY,
  totalCurrentCount,
} from "@musi/lint-ratchet/kernel/current-collector.js";
import { ConfigError } from "@musi/lint-ratchet/kernel/metrics-types.js";
import { regressionRecoveryFooter } from "@musi/lint-ratchet/kernel/recovery-command.js";
import { buildRuleSourceHashesById } from "@musi/lint-ratchet/kernel/rule-source.js";
import {
  equalCountSwapsProvable,
  formatRuleSourceDriftClassification,
  parseBaselineWithRuleSourceDrift,
} from "@musi/lint-ratchet/kernel/rule-source-drift.js";

import { buildEnvelopeFromComparison, loadRuleDocsById } from "./diagnostics.js";
import { musiLintRatchetBinding, musiLintRatchetWorkflowVocabulary } from "./engine-binding.js";
import { lintRatchets } from "./lint-ratchet-config.js";
import { emitHarnessDiagnosticsEnvelope } from "./output.js";
import { BASELINE_FILENAME, readBaselineOrThrow } from "./paths.js";

export interface LintRatchetDefaultModeOptions {
  readonly collectConcurrency?: number;
}

function collectConcurrency(options: LintRatchetDefaultModeOptions): number {
  return options.collectConcurrency ?? DEFAULT_COLLECT_CONCURRENCY;
}

function parseDefaultBaseline(ruleSourceHashesById: LintRatchetRuleSourceHashesById): {
  readonly baseline: LintRatchetBaseline;
  readonly ruleSourceIdentityDrift: boolean;
} {
  const parsed = parseBaselineWithRuleSourceDrift(
    readBaselineOrThrow(musiLintRatchetWorkflowVocabulary.updateCommand),
    lintRatchets,
    ruleSourceHashesById,
    {
      workflowVocabulary: musiLintRatchetWorkflowVocabulary,
      baselineFile: BASELINE_FILENAME,
    },
  );
  if (parsed.baseline === undefined) throw new ConfigError(parsed.failures.join("\n"));
  return {
    baseline: parsed.baseline,
    ruleSourceIdentityDrift: parsed.ruleSourceIdentityDrift,
  };
}

export async function runDefault(options: LintRatchetDefaultModeOptions): Promise<void> {
  const ruleDocsById = await loadRuleDocsById();
  const ruleSourceHashesById = buildRuleSourceHashesById(lintRatchets, musiLintRatchetBinding);
  const parsedBaseline = parseDefaultBaseline(ruleSourceHashesById);
  const currentById = await collectCurrentById({
    ruleSourceHashesById,
    ratchets: lintRatchets,
    binding: musiLintRatchetBinding,
    concurrency: collectConcurrency(options),
  });
  const comparison = compareCurrentToBaseline(
    parsedBaseline.baseline,
    lintRatchets,
    currentById,
    musiLintRatchetWorkflowVocabulary,
  );
  const envelope = buildEnvelopeFromComparison({
    regressions: comparison.regressions,
    improvements: comparison.improvements,
    infos: comparison.infos,
    ruleDocsById,
    ratchets: lintRatchets,
  });
  emitHarnessDiagnosticsEnvelope(envelope);

  const changedCount = comparison.regressions.length + comparison.improvements.length;
  const infoCount = comparison.infos?.length ?? 0;
  const hasRuleSourceIdentityDrift = parsedBaseline.ruleSourceIdentityDrift;
  const label = changedCount > 0 || hasRuleSourceIdentityDrift ? "FAIL" : "OK";
  console.error(
    `lint:ratchet ${label} — ${String(totalCurrentCount(currentById))} current finding(s); ` +
      `${String(comparison.regressions.length)} regression(s); ${String(comparison.improvements.length)} improvement(s); ` +
      `blocking=${String(envelope.summary.blocking)} info=${String(envelope.summary.info)}`,
  );
  if (comparison.regressions.length > 0) {
    console.error(regressionRecoveryFooter(musiLintRatchetWorkflowVocabulary));
  }
  if (hasRuleSourceIdentityDrift) {
    console.error(
      formatRuleSourceDriftClassification(changedCount, BASELINE_FILENAME, {
        infoCount,
        equalCountSwapsProvable: equalCountSwapsProvable(parsedBaseline.baseline, lintRatchets),
        workflowVocabulary: musiLintRatchetWorkflowVocabulary,
      }),
    );
    process.exitCode = 1;
  }
  if (changedCount > 0) process.exitCode = 1;
}
