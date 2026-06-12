import { existsSync, readFileSync } from "node:fs";

import { applyLintRatchetUpdate } from "./baseline-update-apply.js";
import type { ParsedArgs } from "./cli.js";
import { collectCurrentById, totalCurrentCount } from "./current-collector.js";
import {
  assertCheckBaselineComparisonClean,
  buildEnvelope,
  loadRuleDocsById,
  validateEnvelope,
} from "./diagnostics.js";
import {
  discoverEditCheckTargets,
  type EditCheckTarget,
  runEditCheckRegressions,
} from "./edit-check.js";
import {
  formatEditCheckChecked,
  formatEditCheckRegression,
  formatEditCheckTarget,
  parseEditCheckTargetLine,
} from "./edit-check-protocol.js";
import {
  buildLintRatchetBaseline,
  compareCurrentToBaseline,
  formatLintRatchetBaseline,
  type LintRatchetBaseline,
  type LintRatchetRuleSourceHashesById,
  parseLintRatchetBaseline,
  validateLintRatchetRegistry,
} from "./lint-ratchet-baseline.js";
import { lintRatchets, lintRatchetThirdPartyPluginAllowlist } from "./lint-ratchet-config.js";
import { runLintRatchetDebtLogReport } from "./lint-ratchet-debt-log.js";
import { ConfigError } from "./lint-ratchet-metrics.js";
import { emitHarnessDiagnosticsEnvelope } from "./lint-ratchet-output.js";
import { runLintRatchetReport } from "./lint-ratchet-report.js";
import { runLintRatchetSummary } from "./lint-ratchet-summary.js";
import {
  formatUndocumentedZeroBaselineFailure,
  runLintRatchetZeroBaselineAuditResult,
} from "./lint-ratchet-zero-baseline.js";
import { BASELINE_FILENAME, baselinePath } from "./paths.js";
import { formatRatchetCoverageRow, ratchetCoverageForPaths } from "./ratchet-coverage.js";
import { buildRuleSourceHashesById } from "./rule-source.js";

const DEFAULT_EDIT_CHECK_CONCURRENCY = 3;

export interface LintRatchetRuntimeOptions {
  readonly reportArtifactName?: string;
  readonly editCheckConcurrency?: number;
}

function readBaseline(): string {
  if (!existsSync(baselinePath)) {
    throw new ConfigError(`${BASELINE_FILENAME} does not exist; run bun run lint:ratchet:update`);
  }
  return readFileSync(baselinePath, "utf8");
}

async function runCheckRegistry(): Promise<void> {
  await (await import("./lint-ratchet-check-registry.js")).runLintRatchetCheckRegistry();
}

async function assertRegistryPreflight(): Promise<void> {
  await (await import("./lint-ratchet-check-registry.js")).assertLintRatchetRegistryClean();
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

function runReport(options: LintRatchetRuntimeOptions): void {
  const artifactName = options.reportArtifactName;
  process.stdout.write(
    runLintRatchetReport(
      artifactName === undefined || artifactName.length === 0 ? {} : { artifactName },
    ),
  );
}

function runDebtLogReport(): void {
  process.stdout.write(runLintRatchetDebtLogReport());
}

function parseCommittedBaseline(
  ruleSourceHashesById: LintRatchetRuleSourceHashesById,
): LintRatchetBaseline {
  const parsed = parseLintRatchetBaseline(readBaseline(), lintRatchets, ruleSourceHashesById);
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

  applyLintRatchetUpdate({
    generated,
    rendered,
    registry: lintRatchets,
    options: args,
    currentFindingCount: totalCurrentCount(currentById),
  });
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

function runEditCheckTargets(args: ParsedArgs): void {
  const targets = discoverEditCheckTargets(args.editCheckTargets ?? []);
  const lines = targets.map(formatEditCheckTarget);
  if (lines.length > 0) process.stdout.write(`${lines.join("\n")}\n`);
}

// Edit-time helper for the lint-coverage advisory hook: print which committed
// baseline ratchets track each edited path so the hook reuses the ratchet
// matcher instead of embedding its own. No ESLint, no registry validation.
function runEditRatchetCoverage(args: ParsedArgs): void {
  const rows = ratchetCoverageForPaths(args.editRatchetCoveragePaths ?? []);
  const lines = rows.map(formatRatchetCoverageRow);
  if (lines.length > 0) process.stdout.write(`${lines.join("\n")}\n`);
}

function editCheckConcurrency(options: LintRatchetRuntimeOptions): number {
  return options.editCheckConcurrency ?? DEFAULT_EDIT_CHECK_CONCURRENCY;
}

function parseTargetsFile(file: string): EditCheckTarget[] {
  const targets: EditCheckTarget[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.length === 0) continue;
    const target = parseEditCheckTargetLine(line);
    if (target !== undefined) targets.push(target);
  }
  return targets;
}

// Two-step contract: --edit-check-targets lists candidate ratchets (no ESLint)
// so the hook can throttle before linting; --edit-check then lints only the
// surviving targets written to <file> and prints fresh regressions.
async function runEditCheck(args: ParsedArgs, options: LintRatchetRuntimeOptions): Promise<void> {
  if (args.targetsFile === undefined || !existsSync(args.targetsFile)) return;
  const targets = parseTargetsFile(args.targetsFile);
  const result = await runEditCheckRegressions(targets, editCheckConcurrency(options));
  // `checked` rows let the hook distinguish a genuinely-linted-clean file from a
  // soft skip, so it only content-caches bytes ESLint actually inspected.
  const lines = [
    ...result.checked.map(formatEditCheckChecked),
    ...result.regressions.map(formatEditCheckRegression),
  ];
  if (lines.length > 0) process.stdout.write(`${lines.join("\n")}\n`);
}

// Modes that skip the registry preflight/validate gate entirely (pure reports
// and the edit-time check). Returns true when it handled the mode so the caller
// can return before the heavier validation path.
async function runUnvalidatedMode(
  args: ParsedArgs,
  options: LintRatchetRuntimeOptions,
): Promise<boolean> {
  if (args.mode === "report") {
    runReport(options);
    return true;
  }
  if (args.mode === "debt-log") {
    runDebtLogReport();
    return true;
  }
  if (args.mode === "edit-check-targets") {
    runEditCheckTargets(args);
    return true;
  }
  if (args.mode === "edit-check") {
    await runEditCheck(args, options);
    return true;
  }
  if (args.mode === "edit-ratchet-coverage") {
    runEditRatchetCoverage(args);
    return true;
  }
  if (args.mode === "check-registry") {
    await runCheckRegistry();
    return true;
  }
  return false;
}

async function runValidatedMode(args: ParsedArgs): Promise<void> {
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

export async function runLintRatchetCli(
  args: ParsedArgs,
  options: LintRatchetRuntimeOptions = {},
): Promise<void> {
  if (await runUnvalidatedMode(args, options)) return;
  if (args.mode === "default") {
    await assertRegistryPreflight();
  } else {
    await validateRegistry();
  }
  await runValidatedMode(args);
}
