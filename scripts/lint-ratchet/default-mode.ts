import { existsSync, readFileSync } from "node:fs";

import {
  collectCurrentById,
  DEFAULT_COLLECT_CONCURRENCY,
  totalCurrentCount,
} from "./current-collector.js";
import { buildEnvelopeFromComparison, loadRuleDocsById, validateEnvelope } from "./diagnostics.js";
import {
  compareCurrentToBaseline,
  type LintRatchetBaseline,
  type LintRatchetRuleSourceHashesById,
} from "./lint-ratchet-baseline.js";
import { lintRatchets } from "./lint-ratchet-config.js";
import { ConfigError } from "./lint-ratchet-metrics.js";
import { emitHarnessDiagnosticsEnvelope } from "./lint-ratchet-output.js";
import { BASELINE_FILENAME, baselinePath } from "./paths.js";
import { REGRESSION_RECOVERY_FOOTER } from "./recovery-command.js";
import { buildReportOnlySummaries } from "./report-only-diagnostics.js";
import { buildRuleSourceHashesById } from "./rule-source.js";
import {
  formatRuleSourceDriftClassification,
  parseBaselineWithRuleSourceDrift,
} from "./rule-source-drift.js";
import { baselineRatchets } from "./runtime-config.js";

export interface LintRatchetDefaultModeOptions {
  readonly collectConcurrency?: number;
}

function readBaseline(): string {
  if (!existsSync(baselinePath)) {
    throw new ConfigError(`${BASELINE_FILENAME} does not exist; run bun run lint:ratchet:update`);
  }
  return readFileSync(baselinePath, "utf8");
}

function collectConcurrency(options: LintRatchetDefaultModeOptions): number {
  return options.collectConcurrency ?? DEFAULT_COLLECT_CONCURRENCY;
}

function parseDefaultBaseline(ruleSourceHashesById: LintRatchetRuleSourceHashesById): {
  readonly baseline: LintRatchetBaseline;
  readonly ruleSourceIdentityDrift: boolean;
} {
  const parsed = parseBaselineWithRuleSourceDrift(
    readBaseline(),
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
  const enforcedRatchets = baselineRatchets(lintRatchets);
  const parsedBaseline = parseDefaultBaseline(ruleSourceHashesById);
  const currentById = await collectCurrentById(ruleSourceHashesById, collectConcurrency(options));
  const comparison = compareCurrentToBaseline(
    parsedBaseline.baseline,
    enforcedRatchets,
    currentById,
  );
  const reportOnlySummaries = buildReportOnlySummaries(lintRatchets, currentById);
  const envelope = buildEnvelopeFromComparison({
    regressions: comparison.regressions,
    improvements: comparison.improvements,
    infos: comparison.infos,
    ruleDocsById,
    ratchets: lintRatchets,
    reportOnlySummaries,
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
    console.error(formatRuleSourceDriftClassification(changedCount, infoCount));
    process.exitCode = 1;
  }
  if (changedCount > 0) process.exitCode = 1;
}
