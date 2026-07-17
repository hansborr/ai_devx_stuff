import {
  compareCurrentToBaseline,
  type LintRatchetBaseline,
  type LintRatchetRuleSourceHashesById,
} from "./baseline.js";
import {
  collectCurrentById,
  DEFAULT_COLLECT_CONCURRENCY,
  totalCurrentCount,
} from "./current-collector.js";
import { buildEnvelopeFromComparison, loadRuleDocsById, validateEnvelope } from "./diagnostics.js";
import { lintRatchets } from "./lint-ratchet-config.js";
import { ConfigError } from "./metrics.js";
import { emitHarnessDiagnosticsEnvelope } from "./output.js";
import { readBaselineOrThrow } from "./paths.js";
import { REGRESSION_RECOVERY_FOOTER } from "./recovery-command.js";
import { buildRuleSourceHashesById } from "./rule-source.js";
import {
  equalCountSwapsProvable,
  formatRuleSourceDriftClassification,
  parseBaselineWithRuleSourceDrift,
} from "./rule-source-drift.js";

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
    readBaselineOrThrow(),
    lintRatchets,
    ruleSourceHashesById,
  );
  if (parsed.baseline === undefined) throw new ConfigError(parsed.failures.join("\n"));
  return {
    baseline: parsed.baseline,
    ruleSourceIdentityDrift: parsed.ruleSourceIdentityDrift,
  };
}

export async function runDefault(options: LintRatchetDefaultModeOptions): Promise<void> {
  const ruleDocsById = await loadRuleDocsById();
  const ruleSourceHashesById = buildRuleSourceHashesById(lintRatchets);
  const parsedBaseline = parseDefaultBaseline(ruleSourceHashesById);
  const currentById = await collectCurrentById(ruleSourceHashesById, collectConcurrency(options));
  const comparison = compareCurrentToBaseline(parsedBaseline.baseline, lintRatchets, currentById);
  const envelope = buildEnvelopeFromComparison({
    regressions: comparison.regressions,
    improvements: comparison.improvements,
    infos: comparison.infos,
    ruleDocsById,
    ratchets: lintRatchets,
  });
  validateEnvelope(envelope);
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
    console.error(REGRESSION_RECOVERY_FOOTER);
  }
  if (hasRuleSourceIdentityDrift) {
    console.error(
      formatRuleSourceDriftClassification(
        changedCount,
        infoCount,
        equalCountSwapsProvable(parsedBaseline.baseline, lintRatchets),
      ),
    );
    process.exitCode = 1;
  }
  if (changedCount > 0) process.exitCode = 1;
}
