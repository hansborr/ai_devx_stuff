import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { runBaselineDebtAccountingCheck } from "@musi/lint-ratchet/governance/baseline-debt-accounting-git.js";
import type { ApplyLintRatchetUpdateOptions } from "@musi/lint-ratchet/governance/baseline-update-apply.js";
import { runLintRatchetDebtLogReport } from "@musi/lint-ratchet/governance/debt-log.js";
import {
  discoverEditCheckTargets,
  type EditCheckRegression,
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

import type { RuleDocsEntry } from "../lib/lint-rule-docs.js";
import type {
  CommandHandlerArgs,
  LintRatchetRuntimeOptions,
  PreflightHandler,
  PreflightTier,
} from "./cli-handler-types.js";
import { runDefault } from "./default-mode.js";
import { assertCheckBaselineComparisonClean, loadRuleDocsById } from "./diagnostics.js";
import {
  musiLintRatchetBinding,
  musiLintRatchetContext,
  musiLintRatchetWorkflowVocabulary,
} from "./engine-binding.js";
import { lintRatchets, lintRatchetThirdPartyPluginAllowlist } from "./lint-ratchet-config.js";
import { baselinePath } from "./paths.js";
import { runLintRatchetReport } from "./report.js";
import { assertToolchainFreshForBaselineUpdate } from "./toolchain-freshness.js";

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
  workflowVocabulary: musiLintRatchetWorkflowVocabulary,
};

const musiProposeEngine: LintRatchetProposeEngine = {
  repoRoot: musiLintRatchetContext.repoRoot,
  binding: musiLintRatchetBinding,
  registryHint: "scripts/lint-ratchet/lint-ratchet-config.ts",
  workflowVocabulary: musiLintRatchetWorkflowVocabulary,
};

export type { LintRatchetRuntimeOptions } from "./cli-handler-types.js";

export async function runCheckRegistry(): Promise<void> {
  await (await import("./check-registry.js")).runLintRatchetCheckRegistry();
}

async function assertRegistryPreflight(): Promise<void> {
  await (await import("./check-registry.js")).assertLintRatchetRegistryClean();
}

export async function runZeroBaseline(): Promise<void> {
  const result = await runLintRatchetZeroBaselineAuditResult({
    baselinePath,
    repoRoot: musiLintRatchetContext.repoRoot,
    binding: musiLintRatchetBinding,
    registry: lintRatchets,
    workflowVocabulary: musiLintRatchetWorkflowVocabulary,
  });
  process.stdout.write(result.report);
  if (result.undocumentedRows.length > 0) {
    console.error(formatUndocumentedZeroBaselineFailure(result.undocumentedRows));
    process.exitCode = 1;
  }
}

export function runReport(_args: CommandHandlerArgs, options: LintRatchetRuntimeOptions): void {
  const artifactName = options.reportArtifactName;
  process.stdout.write(
    runLintRatchetReport(
      artifactName === undefined || artifactName.length === 0 ? {} : { artifactName },
    ),
  );
}

export function runDebtLogReport(): void {
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
    exitPathExists: (exitPath) => existsSync(resolve(musiLintRatchetContext.repoRoot, exitPath)),
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

async function updateOptions(args: CommandHandlerArgs): Promise<ApplyLintRatchetUpdateOptions> {
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
export async function runUpdate(
  args: CommandHandlerArgs,
  options: LintRatchetRuntimeOptions,
): Promise<void> {
  assertToolchainFreshForBaselineUpdate(
    musiLintRatchetContext.repoRoot,
    musiLintRatchetWorkflowVocabulary.updateCommand,
  );
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
        `${error.relativeBaselinePath} does not exist; run ${musiLintRatchetWorkflowVocabulary.updateCommand}`,
      );
    }
    if (error instanceof BaselineParseError) {
      for (const warning of error.warnings) console.error(`lint:ratchet WARN - ${warning}`);
      throw new ConfigError(error.failures.join("\n"));
    }
    throw error;
  }
}

export async function runCheckBaselineMode(
  _args: CommandHandlerArgs,
  options: LintRatchetRuntimeOptions,
): Promise<void> {
  const result = await runMusiGate(options);
  for (const warning of result.baselineWarnings) console.error(`lint:ratchet WARN - ${warning}`);
  assertCheckBaselineComparisonClean(result.comparison);
  console.error(
    `lint:ratchet:check-baseline OK — ${String(result.currentFindingCount)} current finding(s).`,
  );
}

export function runEditCheckTargets(args: CommandHandlerArgs): void {
  const targets = discoverEditCheckTargets(musiEditCheckEngine, args.editCheckTargets ?? []);
  const lines = targets.map(formatEditCheckTarget);
  if (lines.length > 0) process.stdout.write(`${lines.join("\n")}\n`);
}

// Edit-time helper for the lint-coverage advisory hook: print which committed
// baseline ratchets track each edited path so the hook reuses the ratchet
// matcher instead of embedding its own. No ESLint, no registry validation.
export function runEditRatchetCoverage(args: CommandHandlerArgs): void {
  const rows = ratchetCoverageForPaths(musiLintRatchetContext, args.editRatchetCoveragePaths ?? []);
  const lines = rows.map(formatRatchetCoverageRow);
  if (lines.length > 0) process.stdout.write(`${lines.join("\n")}\n`);
}

export async function runPropose(args: CommandHandlerArgs): Promise<void> {
  await runLintRatchetProposeCli(
    {
      ruleId: args.proposeRuleId,
      files: args.proposeFiles,
      ...(args.proposeIgnores === undefined ? {} : { ignores: args.proposeIgnores }),
      ...(args.proposeMetric === undefined ? {} : { metric: args.proposeMetric }),
      ...(args.proposeRuleOptionsJson === undefined
        ? {}
        : { ruleOptionsJson: args.proposeRuleOptionsJson }),
      ...(args.proposePluginModule === undefined ? {} : { pluginModule: args.proposePluginModule }),
      ...(args.proposePluginExport === undefined ? {} : { pluginExport: args.proposePluginExport }),
      ...(args.proposeParserProfile === undefined
        ? {}
        : { parserProfile: args.proposeParserProfile }),
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

/**
 * Repair command worth naming in an edit-time advisory bullet: only rules whose
 * docs declare a mechanical repair (a codemod command, or ESLint autofix via
 * `bun run lint:fix`) get one. Manual and suggestion rules keep their prose
 * guidance on the envelope path (`bun run lint:agent:local-rules:changed`), and
 * rules without a docs entry (non-local ratchets) get nothing. Mirrors the
 * codemod/autofix branches of the envelope's howToFix composition.
 */
export function editCheckRepairCommandFor(entry: RuleDocsEntry | undefined): string | undefined {
  if (entry === undefined) return undefined;
  if (entry.repairKind === "codemod") return entry.repairCommand;
  if (entry.repairKind === "autofix") return "bun run lint:fix";
  return undefined;
}

/**
 * Enrich engine regressions with the repo's rule-docs repair metadata so the
 * advisory hook can name the exact repair command without shelling out to a
 * second bun process (the hook path is latency- and throttle-sensitive). Docs
 * load only when a regression exists — the common clean edit stays free of
 * docs IO — and a load failure degrades to unenriched rows with a stderr
 * breadcrumb rather than failing the advisory check.
 */
export async function withEditCheckRepairCommands(
  regressions: readonly EditCheckRegression[],
  loadDocs: () => Promise<ReadonlyMap<string, RuleDocsEntry>> = loadRuleDocsById,
  notify: (message: string) => void = (message) => process.stderr.write(`${message}\n`),
): Promise<readonly EditCheckRegression[]> {
  if (regressions.length === 0) return regressions;
  let ruleDocsById: ReadonlyMap<string, RuleDocsEntry>;
  try {
    ruleDocsById = await loadDocs();
  } catch (error) {
    notify(
      `lint:ratchet --edit-check: rule docs unavailable; omitting repair commands (${String(error)})`,
    );
    return regressions;
  }
  return regressions.map((regression) => {
    const repairCommand = editCheckRepairCommandFor(ruleDocsById.get(regression.ruleId));
    return repairCommand === undefined ? regression : { ...regression, repairCommand };
  });
}

// Two-step contract: --edit-check-targets lists candidate ratchets (no ESLint)
// so the hook can throttle before linting; --edit-check then lints only the
// surviving targets written to <file> and prints fresh regressions.
export async function runEditCheck(
  args: CommandHandlerArgs,
  options: LintRatchetRuntimeOptions,
): Promise<void> {
  const targetsFile = editCheckTargetsFileToRead(args.targetsFile);
  if (targetsFile === undefined) return;
  const targets = parseTargetsFile(targetsFile);
  const result = await runEditCheckRegressions(
    musiEditCheckEngine,
    targets,
    editCheckConcurrency(options),
  );
  const regressions = await withEditCheckRepairCommands(result.regressions);
  // `checked` rows let the hook distinguish a genuinely-linted-clean file from a
  // soft skip, so it only content-caches bytes ESLint actually inspected.
  const lines = [
    ...result.checked.map(formatEditCheckChecked),
    ...regressions.map(formatEditCheckRegression),
  ];
  if (lines.length > 0) process.stdout.write(`${lines.join("\n")}\n`);
}

export async function runDefaultMode(
  _args: CommandHandlerArgs,
  options: LintRatchetRuntimeOptions,
): Promise<void> {
  await runDefault(options);
}

export function runCheckDebtAccountingMode(
  args: CommandHandlerArgs,
  _options: LintRatchetRuntimeOptions,
): void {
  runBaselineDebtAccountingCheck(musiLintRatchetContext, undefined, {
    ...(args.debtAccountingStaged === true ? { currentSource: "index" } : {}),
    ...(args.debtAccountingBaseRef === undefined
      ? {}
      : { baseRefCandidates: [args.debtAccountingBaseRef] }),
  });
}

export function runSummaryMode(
  args: CommandHandlerArgs,
  _options: LintRatchetRuntimeOptions,
): void {
  runLintRatchetSummaryCli(
    baselinePath,
    lintRatchets,
    args.summaryByDirectoryDepth,
    musiLintRatchetWorkflowVocabulary,
  );
}

export async function runTrendMode(
  args: CommandHandlerArgs,
  _options: LintRatchetRuntimeOptions,
): Promise<void> {
  (await import("@musi/lint-ratchet/governance/trend.js")).runLintRatchetTrendCli({
    context: musiLintRatchetContext,
    ratchets: lintRatchets,
    since: args.trendSince,
    max: args.trendMax,
    includeRetired: args.trendAll,
  });
}

export const PREFLIGHT_HANDLERS: Readonly<Record<PreflightTier, PreflightHandler>> = {
  none: () => undefined,
  "registry-preflight": assertRegistryPreflight,
  "update-registry-clean": async () =>
    (await import("./check-registry.js")).assertLintRatchetUpdateRegistryClean(),
  "validate-registry": validateRegistry,
};
