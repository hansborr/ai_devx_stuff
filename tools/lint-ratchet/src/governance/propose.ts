import {
  buildLintRatchetBaseline,
  formatLintRatchetBaseline,
  type LintRatchetCurrentItem,
} from "@musi/lint-ratchet/kernel/baseline.js";
import { isJsonValue, normalizeStringList } from "@musi/lint-ratchet/kernel/baseline-hash.js";
import type {
  JsonValue,
  LintRatchetConfig,
  LintRatchetMetric,
} from "@musi/lint-ratchet/kernel/config-types.js";
import { collectCurrentForRatchet } from "@musi/lint-ratchet/kernel/current-collector.js";
import type { LintRatchetEngineBinding } from "@musi/lint-ratchet/kernel/engine-context.js";
import { trackedFilesFromGit } from "@musi/lint-ratchet/kernel/git-tracked-files.js";
import { ConfigError } from "@musi/lint-ratchet/kernel/metrics.js";
import { matchingTrackedFiles } from "@musi/lint-ratchet/kernel/ratchet-globs.js";
import {
  hasNormalizedPath,
  metricPairingFailures,
} from "@musi/lint-ratchet/kernel/registry-validation.js";
import { buildRuleSourceHashesById } from "@musi/lint-ratchet/kernel/rule-source.js";

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

export interface ProposeSummary {
  readonly ruleId: string;
  readonly sourceKind: "core" | "local";
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly metric: LintRatchetMetric;
  readonly ruleOptions: readonly JsonValue[];
  readonly filesWithFindings: number;
  readonly totalFindings: number;
  readonly topFiles: readonly ProposeTopFile[];
  readonly baselineText: string;
  // Repo-relative location of the registry the reader pastes the config into,
  // supplied by the adapter (the package never names an adapter path).
  readonly registryHint: string;
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

// The repo binding the propose collection needs: where the gate runs and the
// registry's third-party plugin allowlist. Injected so the operation reaches the
// repository (tracked files, rule sources) without importing a repo-bound
// `paths` module or the Musi registry. `registryHint` is the human location the
// preview tells the reader to paste the promotable config into — an adapter
// concern (a repo-relative source path), so the package never names one itself.
export interface LintRatchetProposeEngine {
  readonly repoRoot: string;
  readonly binding: LintRatchetEngineBinding;
  readonly registryHint: string;
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
    metric: parts.metric,
    repairKind: "manual",
    principle: "Proposed dry-run ratchet baseline.",
  };
}

function proposeSourceKind(ruleId: string): "core" | "local" {
  if (CORE_RULE_PATTERN.test(ruleId)) return "core";
  if (LOCAL_RULE_PATTERN.test(ruleId)) return "local";
  throw new ConfigError(
    `--propose currently supports core ESLint rule ids and local/<rule-name>; third-party rules require a future --plugin option: ${ruleId}`,
  );
}

function normalizedGlobs(values: readonly string[], label: "file" | "ignore"): readonly string[] {
  for (const value of values) {
    if (!hasNormalizedPath(value)) {
      throw new ConfigError(`--propose ${label} glob must be normalized: ${value || "(empty)"}`);
    }
  }
  return normalizeStringList([...new Set(values)]);
}

export function buildProposeRatchet(options: ProposeOptions): LintRatchetConfig {
  const files = normalizedGlobs(options.files, "file");
  const ignores = normalizedGlobs(
    [...DEFAULT_PROPOSE_IGNORES, ...(options.ignores ?? [])],
    "ignore",
  );
  const metric = parseProposeMetric(options.metric);
  const ruleOptions = parseProposeRuleOptions(options.ruleOptionsJson);
  const sourceKind = proposeSourceKind(options.ruleId);
  // Fail at preview on the same metric/ruleId pairings the registry rejects at
  // promotion, so the preview a copier assembles can actually become a ratchet.
  const pairingFailures = metricPairingFailures(
    PROPOSE_RATCHET_ID,
    options.ruleId,
    metric,
    sourceKind,
  );
  if (pairingFailures.length > 0) throw new ConfigError(pairingFailures.join("\n"));
  const parts: ProposeRatchetParts = {
    ruleId: options.ruleId,
    files,
    ignores,
    metric,
    ruleOptions,
  };
  return sourceKind === "core" ? buildCoreProposeRatchet(parts) : buildLocalProposeRatchet(parts);
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

// A full copy-paste registry entry, so an adopter does not have to guess the
// fields the preview silently fixed (parserProfile, mode, metric, repairKind)
// or the required-but-unshown `principle`. Mirrors the fields the registry
// requires — no `target` (retired from the surface).
function formatPromotableConfig(summary: ProposeSummary): readonly string[] {
  const lines = [
    "  {",
    '    id: "ratchet/<name>",',
    `    ruleId: ${JSON.stringify(summary.ruleId)},`,
  ];
  if (summary.sourceKind === "core") lines.push('    source: { kind: "core" },');
  lines.push(
    '    parserProfile: "minimal-ts",',
    `    files: ${JSON.stringify(summary.files)},`,
    `    ignores: ${JSON.stringify(summary.ignores)},`,
    `    ruleOptions: ${JSON.stringify(summary.ruleOptions)},`,
    '    mode: "no-new",',
    `    metric: ${JSON.stringify(summary.metric)},`,
    '    repairKind: "manual",',
    '    principle: "<why this floor exists — required, non-empty>",',
    "  },",
  );
  return lines;
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
    `promotable config (paste into the lintRatchets array in ${summary.registryHint}, fill in id/principle, then run bun run lint:ratchet:update):`,
    ...formatPromotableConfig(summary),
    "note: ratchet/propose id, configHash, and ruleSourceHash are preview-only.",
    "",
  ].join("\n");
}

export async function runLintRatchetPropose(
  options: ProposeOptions,
  engine: LintRatchetProposeEngine,
): Promise<ProposeSummary> {
  const ratchet = buildProposeRatchet(options);
  const ruleSourceHashesById = buildRuleSourceHashesById([ratchet], engine.binding);
  const ruleSourceHash = ruleSourceHashesById.get(ratchet.id);
  if (ruleSourceHash === undefined) {
    throw new ConfigError(`lint:ratchet: missing rule source hash for ${ratchet.id}`);
  }
  const trackedFiles =
    options.trackedFiles ??
    trackedFilesFromGit("collecting lint ratchet propose files", engine.repoRoot);
  const items = await collectCurrentForRatchet(
    ratchet,
    ruleSourceHash,
    matchingTrackedFiles(ratchet, trackedFiles),
    engine.binding,
  );
  const currentById = new Map([[ratchet.id, items]]);
  const baseline = buildLintRatchetBaseline([ratchet], currentById, ruleSourceHashesById);
  return {
    ruleId: options.ruleId,
    sourceKind: ratchet.source?.kind === "core" ? "core" : "local",
    files: ratchet.files,
    ignores: ratchet.ignores,
    metric: ratchet.metric,
    ruleOptions: ratchet.ruleOptions,
    filesWithFindings: items.size,
    totalFindings: countItems(items),
    topFiles: topFiles(items),
    baselineText: formatLintRatchetBaseline(baseline),
    registryHint: engine.registryHint,
  };
}

export function formatLintRatchetPropose(summary: ProposeSummary): string {
  return formatProposeSummary(summary);
}

export async function runLintRatchetProposeCli(
  options: RunLintRatchetProposeCliOptions,
  engine: LintRatchetProposeEngine,
): Promise<void> {
  const { ruleId, files, ignores, metric, ruleOptionsJson } = options;
  if (ruleId === undefined || files === undefined) {
    throw new ConfigError("--propose requires <ruleId> <glob...>");
  }
  const summary = await runLintRatchetPropose(
    {
      ruleId,
      files,
      ...(ignores === undefined ? {} : { ignores }),
      ...(metric === undefined ? {} : { metric }),
      ...(ruleOptionsJson === undefined ? {} : { ruleOptionsJson }),
    },
    engine,
  );
  process.stdout.write(formatLintRatchetPropose(summary));
  console.error(
    `lint:ratchet:propose ${summary.ruleId} OK — ${String(summary.totalFindings)} current finding(s); ` +
      `${String(summary.filesWithFindings)} file(s) with findings.`,
  );
}
