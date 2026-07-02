import { isJsonValue } from "./baseline-hash.js";
import { collectCurrentForRatchet } from "./current-collector.js";
import { trackedFilesFromGit } from "./git-tracked-files.js";
import {
  buildLintRatchetBaseline,
  formatLintRatchetBaseline,
  type LintRatchetCurrentItem,
} from "./lint-ratchet-baseline.js";
import type { JsonValue, LintRatchetConfig, LintRatchetMetric } from "./lint-ratchet-config.js";
import { ConfigError } from "./lint-ratchet-metrics.js";
import { matchingTrackedFiles } from "./ratchet-globs.js";
import { buildRuleSourceHashesById } from "./rule-source.js";

const PROPOSE_RATCHET_ID = "ratchet/propose";
const CORE_RULE_PATTERN = /^[a-z][a-z0-9-]*$/u;
const LOCAL_RULE_PATTERN = /^local\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DEFAULT_PROPOSE_IGNORES = ["**/dist/**", "**/generated/**", "**/node_modules/**"] as const;
const TOP_FILE_LIMIT = 10;

interface ProposeOptions {
  readonly ruleId: string;
  readonly files: readonly string[];
  readonly ignores?: readonly string[];
  readonly metric?: string;
  readonly ruleOptionsJson?: string;
  readonly trackedFiles?: readonly string[];
}

interface ProposeTopFile {
  readonly path: string;
  readonly count: number;
}

interface ProposeSummary {
  readonly ruleId: string;
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly metric: LintRatchetMetric;
  readonly ruleOptions: readonly JsonValue[];
  readonly filesWithFindings: number;
  readonly totalFindings: number;
  readonly topFiles: readonly ProposeTopFile[];
  readonly baselineText: string;
}

interface ProposeRatchetParts {
  readonly ruleId: string;
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly metric: LintRatchetMetric;
  readonly ruleOptions: readonly JsonValue[];
}

export interface RunLintRatchetProposeCliOptions {
  readonly ruleId?: string;
  readonly files?: readonly string[];
  readonly ignores?: readonly string[];
  readonly metric?: string;
  readonly ruleOptionsJson?: string;
}

function parseProposeMetric(metric: string | undefined): LintRatchetMetric {
  if (
    metric === undefined ||
    metric === "message-count" ||
    metric === "effective-line-count" ||
    metric === "complexity-severity"
  ) {
    return metric ?? "message-count";
  }
  throw new ConfigError(
    `--metric must be one of message-count, effective-line-count, complexity-severity; got ${metric}`,
  );
}

function parseProposeRuleOptions(raw: string | undefined): readonly JsonValue[] {
  if (raw === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`--rule-options must be valid JSON: ${message}`);
  }
  if (!Array.isArray(parsed) || !parsed.every(isJsonValue)) {
    throw new ConfigError("--rule-options must be a JSON array of JSON values");
  }
  return parsed;
}

function buildCoreProposeRatchet(parts: ProposeRatchetParts): LintRatchetConfig {
  return {
    id: PROPOSE_RATCHET_ID,
    ruleId: parts.ruleId,
    source: { kind: "core" },
    parserProfile: "minimal-ts",
    files: parts.files,
    ignores: parts.ignores,
    ruleOptions: parts.ruleOptions,
    mode: "no-new",
    target: 0,
    metric: parts.metric,
    repairKind: "manual",
    principle: "Proposed dry-run ratchet baseline.",
  };
}

function buildLocalProposeRatchet(parts: ProposeRatchetParts): LintRatchetConfig {
  return {
    id: PROPOSE_RATCHET_ID,
    ruleId: parts.ruleId,
    files: parts.files,
    ignores: parts.ignores,
    ruleOptions: parts.ruleOptions,
    mode: "no-new",
    target: 0,
    metric: parts.metric,
    repairKind: "manual",
    principle: "Proposed dry-run ratchet baseline.",
  };
}

function buildProposeRatchet(options: ProposeOptions): LintRatchetConfig {
  const ignores = [...DEFAULT_PROPOSE_IGNORES, ...(options.ignores ?? [])];
  const metric = parseProposeMetric(options.metric);
  const ruleOptions = parseProposeRuleOptions(options.ruleOptionsJson);
  const parts: ProposeRatchetParts = {
    ruleId: options.ruleId,
    files: options.files,
    ignores,
    metric,
    ruleOptions,
  };
  if (CORE_RULE_PATTERN.test(options.ruleId)) {
    return buildCoreProposeRatchet(parts);
  }
  if (LOCAL_RULE_PATTERN.test(options.ruleId)) {
    return buildLocalProposeRatchet(parts);
  }
  throw new ConfigError(
    `--propose currently supports core ESLint rule ids and local/<rule-name>; third-party rules require a future --plugin option: ${options.ruleId}`,
  );
}

function countItems(items: ReadonlyMap<string, LintRatchetCurrentItem>): number {
  let total = 0;
  for (const item of items.values()) total += item.count;
  return total;
}

function topFiles(items: ReadonlyMap<string, LintRatchetCurrentItem>): readonly ProposeTopFile[] {
  return [...items.entries()]
    .map(([path, item]) => ({ path, count: item.count }))
    .sort((left, right) => right.count - left.count || left.path.localeCompare(right.path))
    .slice(0, TOP_FILE_LIMIT);
}

function formatTopFiles(files: readonly ProposeTopFile[]): readonly string[] {
  if (files.length === 0) return ["  (none)"];
  return files.map((file) => `  ${file.path}: ${String(file.count)}`);
}

function formatProposeSummary(summary: ProposeSummary): string {
  return [
    `lint:ratchet:propose ${summary.ruleId}`,
    `file globs: ${summary.files.join(", ")}`,
    `ignore globs: ${summary.ignores.join(", ")}`,
    `metric: ${summary.metric}`,
    `rule options: ${JSON.stringify(summary.ruleOptions)}`,
    `files with findings: ${String(summary.filesWithFindings)}`,
    `total findings: ${String(summary.totalFindings)}`,
    "top files:",
    ...formatTopFiles(summary.topFiles),
    "would-be baseline:",
    summary.baselineText.trimEnd(),
    "note: ratchet/propose id, configHash, and ruleSourceHash are preview-only; copy the rule config fields into scripts/lint-ratchet/lint-ratchet-config.ts and run bun run lint:ratchet:update for a real baseline.",
    "",
  ].join("\n");
}

export async function runLintRatchetPropose(options: ProposeOptions): Promise<ProposeSummary> {
  const ratchet = buildProposeRatchet(options);
  const ruleSourceHashesById = buildRuleSourceHashesById([ratchet]);
  const ruleSourceHash = ruleSourceHashesById.get(ratchet.id);
  if (ruleSourceHash === undefined) {
    throw new ConfigError(`lint:ratchet: missing rule source hash for ${ratchet.id}`);
  }
  const trackedFiles =
    options.trackedFiles ?? trackedFilesFromGit("collecting lint ratchet propose files");
  const items = await collectCurrentForRatchet(
    ratchet,
    ruleSourceHash,
    matchingTrackedFiles(ratchet, trackedFiles),
  );
  const currentById = new Map([[ratchet.id, items]]);
  const baseline = buildLintRatchetBaseline([ratchet], currentById, ruleSourceHashesById);
  return {
    ruleId: options.ruleId,
    files: ratchet.files,
    ignores: ratchet.ignores,
    metric: ratchet.metric,
    ruleOptions: ratchet.ruleOptions,
    filesWithFindings: items.size,
    totalFindings: countItems(items),
    topFiles: topFiles(items),
    baselineText: formatLintRatchetBaseline(baseline),
  };
}

export function formatLintRatchetPropose(summary: ProposeSummary): string {
  return formatProposeSummary(summary);
}

export async function runLintRatchetProposeCli(
  options: RunLintRatchetProposeCliOptions,
): Promise<void> {
  const { ruleId, files, ignores, metric, ruleOptionsJson } = options;
  if (ruleId === undefined || files === undefined) {
    throw new ConfigError("--propose requires <ruleId> <glob...>");
  }
  const summary = await runLintRatchetPropose({
    ruleId,
    files,
    ...(ignores === undefined ? {} : { ignores }),
    ...(metric === undefined ? {} : { metric }),
    ...(ruleOptionsJson === undefined ? {} : { ruleOptionsJson }),
  });
  process.stdout.write(formatLintRatchetPropose(summary));
  console.error(
    `lint:ratchet:propose ${summary.ruleId} OK — ${String(summary.totalFindings)} current finding(s); ` +
      `${String(summary.filesWithFindings)} file(s) with findings.`,
  );
}
