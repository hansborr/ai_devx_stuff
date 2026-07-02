import { existsSync, readFileSync } from "node:fs";

import { runBaselineDebtAccountingCheck } from "./baseline-debt-accounting-git.js";
import {
  applyLintRatchetUpdate,
  type ApplyLintRatchetUpdateOptions,
} from "./baseline-update-apply.js";
import type { ParsedArgs } from "./cli.js";
import {
  collectCurrentById,
  DEFAULT_COLLECT_CONCURRENCY,
  totalCurrentCount,
} from "./current-collector.js";
import { runDefault } from "./default-mode.js";
import { assertCheckBaselineComparisonClean, loadRuleDocsById } from "./diagnostics.js";
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
import { runLintRatchetReport } from "./lint-ratchet-report.js";
import { runLintRatchetSummaryCli } from "./lint-ratchet-summary.js";
import {
  formatUndocumentedZeroBaselineFailure,
  runLintRatchetZeroBaselineAuditResult,
} from "./lint-ratchet-zero-baseline.js";
import { BASELINE_FILENAME, baselinePath } from "./paths.js";
import { runLintRatchetProposeCli } from "./propose.js";
import { formatRatchetCoverageRow, ratchetCoverageForPaths } from "./ratchet-coverage.js";
import { resolveRetireRequest } from "./retire-update.js";
import { buildRuleSourceHashesById } from "./rule-source.js";
import { baselineRatchets } from "./runtime-config.js";

const DEFAULT_EDIT_CHECK_CONCURRENCY = 3;

export interface LintRatchetRuntimeOptions {
  readonly reportArtifactName?: string;
  readonly editCheckConcurrency?: number;
  readonly collectConcurrency?: number;
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

function collectConcurrency(options: LintRatchetRuntimeOptions): number {
  return options.collectConcurrency ?? DEFAULT_COLLECT_CONCURRENCY;
}

async function updateOptions(args: ParsedArgs): Promise<ApplyLintRatchetUpdateOptions> {
  const retire =
    args.retireRatchetId === undefined
      ? undefined
      : await resolveRetireRequest(args.retireRatchetId, lintRatchets);
  return {
    allowWorse: args.allowWorse,
    ...(args.reason === undefined ? {} : { reason: args.reason }),
    ...(retire === undefined ? {} : { retire }),
  };
}

async function runUpdate(args: ParsedArgs, options: LintRatchetRuntimeOptions): Promise<void> {
  const ruleSourceHashesById = buildRuleSourceHashesById(lintRatchets);
  const currentById = await collectCurrentById(ruleSourceHashesById, collectConcurrency(options));
  const enforcedRatchets = baselineRatchets(lintRatchets);
  const generated = buildLintRatchetBaseline(enforcedRatchets, currentById, ruleSourceHashesById);
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
    registry: enforcedRatchets,
    options: await updateOptions(args),
    currentFindingCount: totalCurrentCount(currentById),
  });
}

async function runCheckBaseline(options: LintRatchetRuntimeOptions): Promise<void> {
  const ruleSourceHashesById = buildRuleSourceHashesById(lintRatchets);
  const enforcedRatchets = baselineRatchets(lintRatchets);
  const baseline = parseCommittedBaseline(ruleSourceHashesById);
  const currentById = await collectCurrentById(ruleSourceHashesById, collectConcurrency(options));
  const comparison = compareCurrentToBaseline(baseline, enforcedRatchets, currentById);
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

async function runPropose(args: ParsedArgs): Promise<void> {
  await runLintRatchetProposeCli({
    ruleId: args.proposeRuleId,
    files: args.proposeFiles,
    ...(args.proposeIgnores === undefined ? {} : { ignores: args.proposeIgnores }),
    ...(args.proposeMetric === undefined ? {} : { metric: args.proposeMetric }),
    ...(args.proposeRuleOptionsJson === undefined
      ? {}
      : { ruleOptionsJson: args.proposeRuleOptionsJson }),
  });
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
  if (args.mode === "trend") {
    (await import("./lint-ratchet-trend.js")).runLintRatchetTrendCli(
      args.trendSince,
      args.trendMax,
    );
    return true;
  }
  if (args.mode === "propose") {
    await runPropose(args);
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

async function runValidatedMode(
  args: ParsedArgs,
  options: LintRatchetRuntimeOptions,
): Promise<void> {
  if (args.mode === "summary") {
    runLintRatchetSummaryCli(baselinePath, lintRatchets, args.summaryByDirectoryDepth);
    return;
  }
  if (args.mode === "zero-baseline") {
    await runZeroBaseline();
    return;
  }
  if (args.mode === "update") {
    await runUpdate(args, options);
    return;
  }
  if (args.mode === "check-baseline") {
    await runCheckBaseline(options);
    return;
  }
  if (args.mode === "check-debt-accounting") {
    runBaselineDebtAccountingCheck();
    return;
  }
  await runDefault(options);
}

export async function runLintRatchetCli(
  args: ParsedArgs,
  options: LintRatchetRuntimeOptions = {},
): Promise<void> {
  if (await runUnvalidatedMode(args, options)) return;
  if (args.mode === "default" || args.mode === "check-baseline") {
    await assertRegistryPreflight();
  } else if (args.mode === "update") {
    await (await import("./lint-ratchet-check-registry.js")).assertLintRatchetUpdateRegistryClean();
  } else {
    await validateRegistry();
  }
  await runValidatedMode(args, options);
}
