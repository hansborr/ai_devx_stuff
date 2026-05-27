import { existsSync, readFileSync, writeFileSync } from "node:fs";

import {
  buildLintRatchetBaseline,
  compareCurrentToBaseline,
  decideLintRatchetUpdate,
  formatLintRatchetBaseline,
  parseLintRatchetBaseline,
  parseLintRatchetBaselineStructure,
  type LintRatchetRuleSourceHashesById,
  validateLintRatchetRegistry,
} from "../lint-ratchet-baseline.js";
import { lintRatchets, lintRatchetThirdPartyPluginAllowlist } from "../lint-ratchet-config.js";
import { ConfigError } from "../lint-ratchet-metrics.js";
import { emitHarnessDiagnosticsEnvelope } from "../lint-ratchet-output.js";
import {
  LINT_RATCHET_REPORT_ARTIFACT_URL_ENV,
  runLintRatchetReport,
} from "../lint-ratchet-report.js";
import { runLintRatchetSummary } from "../lint-ratchet-summary.js";
import {
  formatUndocumentedZeroBaselineFailure,
  runLintRatchetZeroBaselineAuditResult,
} from "../lint-ratchet-zero-baseline.js";
import type { ParsedArgs } from "./cli.js";
import { collectCurrentById, totalCurrentCount } from "./current-collector.js";
import {
  assertCheckBaselineComparisonClean,
  buildEnvelope,
  loadRuleDocsById,
  validateEnvelope,
} from "./diagnostics.js";
import { WorseBaselineError } from "./errors.js";
import { BASELINE_FILENAME, baselinePath } from "./paths.js";
import { buildRuleSourceHashesById } from "./rule-source.js";

function readBaseline(): string {
  if (!existsSync(baselinePath)) {
    throw new ConfigError(`${BASELINE_FILENAME} does not exist; run bun run lint:ratchet:update`);
  }
  return readFileSync(baselinePath, "utf8");
}

async function runCheckRegistry(): Promise<void> {
  await (await import("../lint-ratchet-check-registry.js")).runLintRatchetCheckRegistry();
}

async function assertRegistryPreflight(): Promise<void> {
  await (await import("../lint-ratchet-check-registry.js")).assertLintRatchetRegistryClean();
}

function runSummary(): void {
  process.stdout.write(runLintRatchetSummary({ baselinePath, registry: lintRatchets }));
}

async function runZeroBaseline(): Promise<void> {
  const result = await runLintRatchetZeroBaselineAuditResult({
    baselinePath,
    registry: lintRatchets,
  });
  process.stdout.write(result.report);
  if (result.undocumentedRows.length > 0) {
    console.error(formatUndocumentedZeroBaselineFailure(result.undocumentedRows));
    process.exitCode = 1;
  }
}

function runReport(): void {
  const artifactName = process.env[LINT_RATCHET_REPORT_ARTIFACT_URL_ENV];
  process.stdout.write(
    runLintRatchetReport(
      artifactName === undefined || artifactName.length === 0 ? {} : { artifactName },
    ),
  );
}

function parseCommittedBaseline(ruleSourceHashesById: LintRatchetRuleSourceHashesById) {
  const parsed = parseLintRatchetBaseline(readBaseline(), lintRatchets, ruleSourceHashesById);
  if (parsed.baseline === undefined) throw new ConfigError(parsed.failures.join("\n"));
  return parsed.baseline;
}

function parseCommittedBaselineStructure() {
  const parsed = parseLintRatchetBaselineStructure(readBaseline());
  if (parsed.baseline === undefined) throw new ConfigError(parsed.failures.join("\n"));
  return parsed.baseline;
}

async function validateRegistry(): Promise<void> {
  const ruleDocsById = await loadRuleDocsById();
  const failures = validateLintRatchetRegistry(lintRatchets, {
    localRuleIds: new Set(ruleDocsById.keys()),
    thirdPartyPlugins: lintRatchetThirdPartyPluginAllowlist,
  });
  if (failures.length > 0) {
    throw new ConfigError(`Invalid lint ratchet registry:\n${failures.join("\n")}`);
  }
}

async function runDefault(): Promise<void> {
  const ruleDocsById = await loadRuleDocsById();
  const ruleSourceHashesById = buildRuleSourceHashesById(lintRatchets);
  const baseline = parseCommittedBaseline(ruleSourceHashesById);
  const currentById = await collectCurrentById(ruleSourceHashesById);
  const comparison = compareCurrentToBaseline(baseline, lintRatchets, currentById);
  const envelope = buildEnvelope(
    comparison.regressions,
    comparison.improvements,
    ruleDocsById,
    lintRatchets,
  );
  validateEnvelope(envelope);
  emitHarnessDiagnosticsEnvelope(envelope);
  const changedCount = comparison.regressions.length + comparison.improvements.length;
  const label = changedCount > 0 ? "FAIL" : "OK";
  console.error(
    `lint:ratchet ${label} — ${String(totalCurrentCount(currentById))} current finding(s); ` +
      `${String(comparison.regressions.length)} regression(s); ${String(comparison.improvements.length)} improvement(s); ` +
      `blocking=${String(envelope.summary.blocking)} ` +
      `warning=${String(envelope.summary.warning)} info=${String(envelope.summary.info)}`,
  );
  if (changedCount > 0) process.exitCode = 1;
}

async function runUpdate(args: ParsedArgs): Promise<void> {
  const ruleSourceHashesById = buildRuleSourceHashesById(lintRatchets);
  const currentById = await collectCurrentById(ruleSourceHashesById);
  const generated = buildLintRatchetBaseline(lintRatchets, currentById, ruleSourceHashesById);
  const rendered = formatLintRatchetBaseline(generated);
  const parsedGenerated = parseLintRatchetBaseline(rendered, lintRatchets, ruleSourceHashesById);
  if (parsedGenerated.baseline === undefined) {
    throw new ConfigError(
      `generated baseline failed validation:\n${parsedGenerated.failures.join("\n")}`,
    );
  }

  if (existsSync(baselinePath)) {
    const committed = parseCommittedBaselineStructure();
    const decision = decideLintRatchetUpdate(committed, generated, lintRatchets, args);
    if (!decision.allowed) throw new WorseBaselineError(decision.failures.join("\n"));
    for (const warning of decision.warnings) {
      console.error(`⚠ ${warning}`);
    }
  }

  const currentText = existsSync(baselinePath) ? readFileSync(baselinePath, "utf8") : "";
  if (currentText === rendered) {
    console.error(
      `lint:ratchet:update OK — ${BASELINE_FILENAME} already matches ${String(totalCurrentCount(currentById))} current finding(s).`,
    );
    return;
  }
  writeFileSync(baselinePath, rendered);
  console.error(
    `lint:ratchet:update OK — wrote ${BASELINE_FILENAME} with ${String(totalCurrentCount(currentById))} current finding(s).`,
  );
}

async function runCheckBaseline(): Promise<void> {
  const ruleSourceHashesById = buildRuleSourceHashesById(lintRatchets);
  const baseline = parseCommittedBaseline(ruleSourceHashesById);
  const currentById = await collectCurrentById(ruleSourceHashesById);
  const comparison = compareCurrentToBaseline(baseline, lintRatchets, currentById);
  assertCheckBaselineComparisonClean(comparison);
  console.error(
    `lint:ratchet:check-baseline OK — ${String(totalCurrentCount(currentById))} current finding(s).`,
  );
}

export async function runLintRatchetCli(args: ParsedArgs): Promise<void> {
  if (args.mode === "report") {
    runReport();
    return;
  }
  if (args.mode === "check-registry") {
    await runCheckRegistry();
    return;
  }
  if (args.mode === "default") {
    await assertRegistryPreflight();
  } else {
    await validateRegistry();
  }
  if (args.mode === "summary") {
    runSummary();
    return;
  }
  if (args.mode === "zero-baseline") {
    await runZeroBaseline();
    return;
  }
  if (args.mode === "update") {
    await runUpdate(args);
    return;
  }
  if (args.mode === "check-baseline") {
    await runCheckBaseline();
    return;
  }
  await runDefault();
}
