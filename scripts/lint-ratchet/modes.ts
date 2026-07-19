import { existsSync, readFileSync } from "node:fs";

import { runBaselineDebtAccountingCheck } from "@musi/lint-ratchet/governance/baseline-debt-accounting-git.js";
import type { ApplyLintRatchetUpdateOptions } from "@musi/lint-ratchet/governance/baseline-update-apply.js";
import { runLintRatchetDebtLogReport } from "@musi/lint-ratchet/governance/debt-log.js";
import {
  discoverEditCheckTargets,
  type EditCheckTarget,
  type LintRatchetEditCheckEngine,
  runEditCheckRegressions,
} from "@musi/lint-ratchet/governance/edit-check.js";
import {
  formatEditCheckChecked,
  formatEditCheckRegression,
  formatEditCheckTarget,
  parseEditCheckTargetLine,
} from "@musi/lint-ratchet/governance/edit-check-protocol.js";
import { BaselineParseError, MissingBaselineError } from "@musi/lint-ratchet/governance/errors.js";
import {
  type LintRatchetGateResult,
  runLintRatchetGate,
  runLintRatchetUpdate,
} from "@musi/lint-ratchet/governance/operations.js";
import {
  type LintRatchetProposeEngine,
  runLintRatchetProposeCli,
} from "@musi/lint-ratchet/governance/propose.js";
import {
  formatRatchetCoverageRow,
  ratchetCoverageForPaths,
} from "@musi/lint-ratchet/governance/ratchet-coverage.js";
import { resolveRetireRequest } from "@musi/lint-ratchet/governance/retire-update.js";
import { runLintRatchetSummaryCli } from "@musi/lint-ratchet/governance/summary.js";
import {
  formatUndocumentedZeroBaselineFailure,
  runLintRatchetZeroBaselineAuditResult,
} from "@musi/lint-ratchet/governance/zero-baseline.js";
import { validateLintRatchetRegistry } from "@musi/lint-ratchet/kernel/baseline.js";
import { ConfigError } from "@musi/lint-ratchet/kernel/metrics-types.js";

import type { ParsedArgs } from "./cli.js";
import { runDefault } from "./default-mode.js";
import { assertCheckBaselineComparisonClean, loadRuleDocsById } from "./diagnostics.js";
import { musiLintRatchetBinding, musiLintRatchetContext } from "./engine-binding.js";
import { lintRatchets, lintRatchetThirdPartyPluginAllowlist } from "./lint-ratchet-config.js";
import { baselinePath } from "./paths.js";
import { runLintRatchetReport } from "./report.js";

const DEFAULT_EDIT_CHECK_CONCURRENCY = 3;

// The Musi engine bundles the governance operations take: the edit-time check
// needs the repo root, committed baseline, registry, and plugin allowlist; the
// propose collection needs the repo root and allowlist. Built once from the
// adapter's resolved context + registry so the operations reach the repository
// without importing `paths` or the Musi registry themselves.
const musiEditCheckEngine: LintRatchetEditCheckEngine = {
  repoRoot: musiLintRatchetContext.repoRoot,
  baselinePath: musiLintRatchetContext.baselinePath,
  registry: lintRatchets,
  binding: musiLintRatchetBinding,
};

const musiProposeEngine: LintRatchetProposeEngine = {
  repoRoot: musiLintRatchetContext.repoRoot,
  binding: musiLintRatchetBinding,
  registryHint: "scripts/lint-ratchet/lint-ratchet-config.ts",
};

export interface LintRatchetRuntimeOptions {
  readonly reportArtifactName?: string;
  readonly editCheckConcurrency?: number;
  readonly collectConcurrency?: number;
}

async function runCheckRegistry(): Promise<void> {
  await (await import("./check-registry.js")).runLintRatchetCheckRegistry();
}

async function assertRegistryPreflight(): Promise<void> {
  await (await import("./check-registry.js")).assertLintRatchetRegistryClean();
}

async function runZeroBaseline(): Promise<void> {
  const result = await runLintRatchetZeroBaselineAuditResult({
    baselinePath,
    repoRoot: musiLintRatchetContext.repoRoot,
    binding: musiLintRatchetBinding,
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
  process.stdout.write(
    runLintRatchetDebtLogReport({
      repoRoot: musiLintRatchetContext.repoRoot,
      debtLogPath: musiLintRatchetContext.debtLogPath,
    }),
  );
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

// Forward the harness-supplied collect concurrency to a package operation; an
// absent option defers to the collector's own default.
function collectConcurrencyOption(
  options: LintRatchetRuntimeOptions,
): { readonly collectConcurrency: number } | Record<string, never> {
  return options.collectConcurrency === undefined
    ? {}
    : { collectConcurrency: options.collectConcurrency };
}

async function updateOptions(args: ParsedArgs): Promise<ApplyLintRatchetUpdateOptions> {
  const retire =
    args.retireRatchetId === undefined
      ? undefined
      : await resolveRetireRequest(musiLintRatchetContext, args.retireRatchetId, lintRatchets, {
          ...(args.acceptDifferentOptions === true ? { acceptDifferentOptions: true } : {}),
          ...(args.reason === undefined ? {} : { reason: args.reason }),
        });
  return {
    allowWorse: args.allowWorse,
    ...(args.reason === undefined ? {} : { reason: args.reason }),
    ...(args.migrationReason === undefined ? {} : { migrationReason: args.migrationReason }),
    ...(retire === undefined ? {} : { retire }),
  };
}

// The gate/update orchestration (hashes → collect → build/compare → round-trip
// validation → gated apply) lives in the package operations; this adapter only
// supplies the Musi engine + registry and renders the results.
async function runUpdate(args: ParsedArgs, options: LintRatchetRuntimeOptions): Promise<void> {
  await runLintRatchetUpdate({
    context: musiLintRatchetContext,
    binding: musiLintRatchetBinding,
    registry: lintRatchets,
    options: await updateOptions(args),
    ...collectConcurrencyOption(options),
  });
}

// Adapter-owned rendering for the packaged gate's typed baseline failures: the
// recovery command is Musi's runner invocation (the package deliberately does
// not know it), and parse WARN lines still print before an unparseable
// baseline aborts — the pre-extraction parseCommittedBaseline contract.
async function runMusiGate(options: LintRatchetRuntimeOptions): Promise<LintRatchetGateResult> {
  try {
    return await runLintRatchetGate({
      context: musiLintRatchetContext,
      binding: musiLintRatchetBinding,
      registry: lintRatchets,
      ...collectConcurrencyOption(options),
    });
  } catch (error) {
    if (error instanceof MissingBaselineError) {
      throw new ConfigError(
        `${error.relativeBaselinePath} does not exist; run bun run lint:ratchet:update`,
      );
    }
    if (error instanceof BaselineParseError) {
      for (const warning of error.warnings) console.error(`lint:ratchet WARN - ${warning}`);
      throw new ConfigError(error.failures.join("\n"));
    }
    throw error;
  }
}

async function runCheckBaseline(options: LintRatchetRuntimeOptions): Promise<void> {
  const result = await runMusiGate(options);
  for (const warning of result.baselineWarnings) console.error(`lint:ratchet WARN - ${warning}`);
  assertCheckBaselineComparisonClean(result.comparison);
  console.error(
    `lint:ratchet:check-baseline OK — ${String(result.currentFindingCount)} current finding(s).`,
  );
}

function runEditCheckTargets(args: ParsedArgs): void {
  const targets = discoverEditCheckTargets(musiEditCheckEngine, args.editCheckTargets ?? []);
  const lines = targets.map(formatEditCheckTarget);
  if (lines.length > 0) process.stdout.write(`${lines.join("\n")}\n`);
}

// Edit-time helper for the lint-coverage advisory hook: print which committed
// baseline ratchets track each edited path so the hook reuses the ratchet
// matcher instead of embedding its own. No ESLint, no registry validation.
function runEditRatchetCoverage(args: ParsedArgs): void {
  const rows = ratchetCoverageForPaths(musiLintRatchetContext, args.editRatchetCoveragePaths ?? []);
  const lines = rows.map(formatRatchetCoverageRow);
  if (lines.length > 0) process.stdout.write(`${lines.join("\n")}\n`);
}

async function runPropose(args: ParsedArgs): Promise<void> {
  await runLintRatchetProposeCli(
    {
      ruleId: args.proposeRuleId,
      files: args.proposeFiles,
      ...(args.proposeIgnores === undefined ? {} : { ignores: args.proposeIgnores }),
      ...(args.proposeMetric === undefined ? {} : { metric: args.proposeMetric }),
      ...(args.proposeRuleOptionsJson === undefined
        ? {}
        : { ruleOptionsJson: args.proposeRuleOptionsJson }),
    },
    musiProposeEngine,
  );
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

/**
 * Resolve the edit-check targets file to read, or undefined to skip. A missing
 * `--targets-file` flag is a fine contract (silent skip), but when the flag WAS
 * passed and the file is absent — a hook wiring typo (wrong temp path/variable)
 * — emit a breadcrumb instead of a permanently green advisory nobody can see
 * stopped running. Advisory, so it still skips (exit unchanged); an existing but
 * empty file legitimately yields zero targets silently downstream.
 */
export function editCheckTargetsFileToRead(
  targetsFile: string | undefined,
  fileExists: (path: string) => boolean = existsSync,
  notify: (message: string) => void = (message) => process.stderr.write(`${message}\n`),
): string | undefined {
  if (targetsFile === undefined) return undefined;
  if (!fileExists(targetsFile)) {
    notify(`lint:ratchet: --edit-check targets file not found: ${targetsFile}; skipping`);
    return undefined;
  }
  return targetsFile;
}

// Two-step contract: --edit-check-targets lists candidate ratchets (no ESLint)
// so the hook can throttle before linting; --edit-check then lints only the
// surviving targets written to <file> and prints fresh regressions.
async function runEditCheck(args: ParsedArgs, options: LintRatchetRuntimeOptions): Promise<void> {
  const targetsFile = editCheckTargetsFileToRead(args.targetsFile);
  if (targetsFile === undefined) return;
  const targets = parseTargetsFile(targetsFile);
  const result = await runEditCheckRegressions(
    musiEditCheckEngine,
    targets,
    editCheckConcurrency(options),
  );
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
    (await import("@musi/lint-ratchet/governance/trend.js")).runLintRatchetTrendCli({
      context: musiLintRatchetContext,
      ratchets: lintRatchets,
      since: args.trendSince,
      max: args.trendMax,
      includeRetired: args.trendAll,
    });
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
    runBaselineDebtAccountingCheck(musiLintRatchetContext, undefined, {
      ...(args.debtAccountingStaged === true ? { currentSource: "index" } : {}),
      ...(args.debtAccountingBaseRef === undefined
        ? {}
        : { baseRefCandidates: [args.debtAccountingBaseRef] }),
    });
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
    await (await import("./check-registry.js")).assertLintRatchetUpdateRegistryClean();
  } else {
    await validateRegistry();
  }
  await runValidatedMode(args, options);
}
