import { existsSync, readFileSync } from "node:fs";

import { ESLint } from "eslint";

import {
  type LintRatchetBaseline,
  type LintRatchetRuleSourceHashesById,
  parseLintRatchetBaseline,
} from "./baseline.js";
import { isJsonValue, isRecord, normalizeRuleOptions } from "./baseline-hash.js";
import { trackedFilesFromGit } from "./git-tracked-files.js";
import { type JsonValue, type LintRatchetConfig } from "./lint-ratchet-config.js";
import { ConfigError } from "./metrics.js";
import { BASELINE_FILENAME, repoRoot } from "./paths.js";
import { matchingTrackedFiles } from "./ratchet-globs.js";
export { matchingTrackedFiles } from "./ratchet-globs.js";

const ESLINT_ERROR_SEVERITY = 2;
import { buildRuleSourceHashesById } from "./rule-source.js";
import type { LintRatchetZeroBaselineDisposition } from "./zero-baseline-types.js";

export type NormalLintFileStatus =
  | "error"
  | "error-different-options"
  | "ignored"
  | "off"
  | "warn"
  | "warn-different-options";

export type NormalLintFloorStatus =
  | "empty-scope"
  | "mixed"
  | "normal-error"
  | "normal-error-different-options"
  | "normal-ignored"
  | "normal-off"
  | "normal-warn"
  | "normal-warn-different-options";

export interface ZeroBaselineAuditRow {
  readonly id: string;
  readonly ruleId: string;
  readonly matchedFileCount: number;
  readonly normalLintStatus: NormalLintFloorStatus;
  readonly disposition?: LintRatchetZeroBaselineDisposition;
}

export type NormalLintStatusForFile = (
  ratchet: LintRatchetConfig,
  path: string,
) => Promise<NormalLintFileStatus>;

export interface NormalLintConfigResolver {
  isPathIgnored(path: string): Promise<boolean>;
  calculateConfigForFile(path: string): Promise<unknown>;
}

export interface LintRatchetZeroBaselineAuditResult {
  readonly report: string;
  readonly rows: readonly ZeroBaselineAuditRow[];
  readonly undocumentedRows: readonly ZeroBaselineAuditRow[];
}

interface AuditZeroBaselineRatchetsOptions {
  readonly baseline: LintRatchetBaseline;
  readonly normalLintStatusForFile: NormalLintStatusForFile;
  readonly registry: readonly LintRatchetConfig[];
  readonly trackedFiles: readonly string[];
}

interface RunLintRatchetZeroBaselineAuditOptions {
  readonly baselinePath: string;
  readonly registry: readonly LintRatchetConfig[];
  readonly ruleSourceHashesById?: LintRatchetRuleSourceHashesById;
}

interface ParsedNormalRuleConfig {
  readonly severity: "error" | "off" | "warn";
  readonly options?: readonly JsonValue[];
}

function totalBaselineFindings(test: LintRatchetBaseline["tests"][string]): number {
  return Object.values(test.items).reduce((total, item) => total + item.count, 0);
}

function zeroBaselineRatchets(
  baseline: LintRatchetBaseline,
  registry: readonly LintRatchetConfig[],
): readonly LintRatchetConfig[] {
  return registry.filter((ratchet) => {
    const test = baseline.tests[ratchet.id];
    return test !== undefined && totalBaselineFindings(test) === 0;
  });
}

function parseSeverity(value: unknown): ParsedNormalRuleConfig["severity"] {
  if (value === "error" || value === ESLINT_ERROR_SEVERITY) return "error";
  if (value === "warn" || value === 1) return "warn";
  return "off";
}

function parseNormalRuleConfig(value: unknown): ParsedNormalRuleConfig {
  if (!Array.isArray(value)) return { severity: parseSeverity(value), options: [] };
  const options = value.slice(1);
  return {
    severity: parseSeverity(value[0]),
    ...(options.every((option) => isJsonValue(option)) ? { options } : {}),
  };
}

function hasMatchingOptions(
  ratchet: LintRatchetConfig,
  normalOptions: readonly JsonValue[] | undefined,
): boolean {
  if (normalOptions === undefined) return false;
  return (
    JSON.stringify(normalizeRuleOptions(normalOptions)) ===
    JSON.stringify(normalizeRuleOptions(ratchet.ruleOptions))
  );
}

function statusForNormalRuleConfig(
  ratchet: LintRatchetConfig,
  value: unknown,
): NormalLintFileStatus {
  const normalRule = parseNormalRuleConfig(value);
  if (normalRule.severity === "off") return "off";
  const optionsMatch = hasMatchingOptions(ratchet, normalRule.options);
  if (normalRule.severity === "warn") {
    return optionsMatch ? "warn" : "warn-different-options";
  }
  return optionsMatch ? "error" : "error-different-options";
}

function ruleConfigValue(config: unknown, ruleId: string): unknown {
  if (!isRecord(config)) return undefined;
  const rules = config.rules;
  if (!isRecord(rules)) return undefined;
  return rules[ruleId];
}

export function aggregateNormalLintStatus(
  fileStatuses: readonly NormalLintFileStatus[],
): NormalLintFloorStatus {
  if (fileStatuses.length === 0) return "empty-scope";
  const uniqueStatuses = new Set(fileStatuses);
  if (uniqueStatuses.size !== 1) return "mixed";
  const status = fileStatuses[0];
  if (status === "error") return "normal-error";
  if (status === "error-different-options") return "normal-error-different-options";
  if (status === "warn") return "normal-warn";
  if (status === "warn-different-options") return "normal-warn-different-options";
  if (status === "ignored") return "normal-ignored";
  return "normal-off";
}

async function auditRatchet(
  ratchet: LintRatchetConfig,
  options: AuditZeroBaselineRatchetsOptions,
): Promise<ZeroBaselineAuditRow> {
  const matchedFiles = matchingTrackedFiles(ratchet, options.trackedFiles);
  const fileStatuses = await Promise.all(
    matchedFiles.map(async (path) => options.normalLintStatusForFile(ratchet, path)),
  );
  return {
    id: ratchet.id,
    ruleId: ratchet.ruleId,
    matchedFileCount: matchedFiles.length,
    normalLintStatus: aggregateNormalLintStatus(fileStatuses),
    ...(ratchet.zeroBaselineDisposition === undefined
      ? {}
      : { disposition: ratchet.zeroBaselineDisposition }),
  };
}

export async function auditZeroBaselineRatchets(
  options: AuditZeroBaselineRatchetsOptions,
): Promise<readonly ZeroBaselineAuditRow[]> {
  return Promise.all(
    zeroBaselineRatchets(options.baseline, options.registry).map(async (ratchet) =>
      auditRatchet(ratchet, options),
    ),
  );
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function lifecycleLabel(disposition: LintRatchetZeroBaselineDisposition | undefined): string {
  return disposition?.kind ?? "missing";
}

function nextAction(row: ZeroBaselineAuditRow): string {
  if (row.disposition !== undefined) {
    return row.disposition.exitPath ?? row.disposition.reason;
  }
  if (row.normalLintStatus === "normal-error") {
    return "Remove the ratchet, or document why it remains narrower than normal lint.";
  }
  if (
    row.normalLintStatus === "normal-warn" ||
    row.normalLintStatus === "normal-warn-different-options"
  ) {
    return "Promote normal lint to error, or document a temporary ratchet-only exit path.";
  }
  return "Promote to normal lint, narrow the ratchet, or add documented ratchet-only lifecycle metadata.";
}

function countRows(
  rows: readonly ZeroBaselineAuditRow[],
  predicate: (row: ZeroBaselineAuditRow) => boolean,
): number {
  return rows.filter(predicate).length;
}

export function undocumentedZeroBaselineRows(
  rows: readonly ZeroBaselineAuditRow[],
): readonly ZeroBaselineAuditRow[] {
  return rows.filter((row) => row.disposition === undefined);
}

export function formatUndocumentedZeroBaselineFailure(
  rows: readonly ZeroBaselineAuditRow[],
): string {
  const count = rows.length;
  const ratchetLabel = count === 1 ? "ratchet" : "ratchets";
  const verb = count === 1 ? "lacks" : "lack";
  return [
    `lint:ratchet:zero-baseline FAIL — ${String(count)} zero-baseline ${ratchetLabel} ${verb} zeroBaselineDisposition.`,
    "Undocumented ratchets:",
    ...rows.map((row) => `- ${row.id}`),
  ].join("\n");
}

export function formatZeroBaselineAudit(rows: readonly ZeroBaselineAuditRow[]): string {
  const documentedCount = countRows(rows, (row) => row.disposition !== undefined);
  const normalErrorCount = countRows(rows, (row) => row.normalLintStatus === "normal-error");
  const needsActionCount = undocumentedZeroBaselineRows(rows).length;
  const lines = [
    "# Lint Ratchet Zero-Baseline Audit",
    "",
    `Zero-baseline ratchets: ${String(rows.length)}`,
    `Normal-lint error coverage: ${String(normalErrorCount)}`,
    `Documented ratchet-only lifecycle: ${String(documentedCount)}`,
    `Needs lifecycle action: ${String(needsActionCount)}`,
    "",
    "| Ratchet | Rule | Files | Normal lint | Lifecycle | Next action |",
    "| --- | --- | ---: | --- | --- | --- |",
  ];
  for (const row of rows) {
    lines.push(
      `| ${[
        markdownCell(row.id),
        markdownCell(row.ruleId),
        String(row.matchedFileCount),
        row.normalLintStatus,
        lifecycleLabel(row.disposition),
        markdownCell(nextAction(row)),
      ].join(" | ")} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function createNormalLintStatusForFile(
  eslint: NormalLintConfigResolver,
): NormalLintStatusForFile {
  const ignoredByPath = new Map<string, Promise<boolean>>();
  const configByPath = new Map<string, Promise<unknown>>();

  async function isPathIgnored(path: string): Promise<boolean> {
    const cached = ignoredByPath.get(path);
    if (cached !== undefined) return cached;
    const resolved = eslint.isPathIgnored(path);
    ignoredByPath.set(path, resolved);
    return resolved;
  }

  async function configForFile(path: string): Promise<unknown> {
    const cached = configByPath.get(path);
    if (cached !== undefined) return cached;
    const resolved = eslint.calculateConfigForFile(path);
    configByPath.set(path, resolved);
    return resolved;
  }

  return async (ratchet, path) => {
    if (await isPathIgnored(path)) return "ignored";
    const config = await configForFile(path);
    return statusForNormalRuleConfig(ratchet, ruleConfigValue(config, ratchet.ruleId));
  };
}

function readBaselineText(baselinePath: string): string {
  if (!existsSync(baselinePath)) {
    throw new ConfigError(`${BASELINE_FILENAME} does not exist; run bun run lint:ratchet:update`);
  }
  return readFileSync(baselinePath, "utf8");
}

export async function runLintRatchetZeroBaselineAudit(
  options: RunLintRatchetZeroBaselineAuditOptions,
): Promise<string> {
  return (await runLintRatchetZeroBaselineAuditResult(options)).report;
}

export async function runLintRatchetZeroBaselineAuditResult(
  options: RunLintRatchetZeroBaselineAuditOptions,
): Promise<LintRatchetZeroBaselineAuditResult> {
  const baselineText = readBaselineText(options.baselinePath);
  const ruleSourceHashesById =
    options.ruleSourceHashesById ?? buildRuleSourceHashesById(options.registry);
  const parsed = parseLintRatchetBaseline(baselineText, options.registry, ruleSourceHashesById);
  if (parsed.baseline === undefined) {
    throw new ConfigError(parsed.failures.join("\n"));
  }
  const eslint = new ESLint({ cwd: repoRoot });
  const statusForFile = createNormalLintStatusForFile(eslint);
  const rows = await auditZeroBaselineRatchets({
    baseline: parsed.baseline,
    registry: options.registry,
    trackedFiles: trackedFilesFromGit("auditing zero-baseline lint ratchets"),
    normalLintStatusForFile: statusForFile,
  });
  return {
    report: formatZeroBaselineAudit(rows),
    rows,
    undocumentedRows: undocumentedZeroBaselineRows(rows),
  };
}
