import type {
  LintRatchetCurrentById,
  LintRatchetCurrentItem,
  LintRatchetRuleSourceHashesById,
} from "../lint-ratchet-baseline.js";
import { lintRatchets, type LintRatchetConfig } from "../lint-ratchet-config.js";
import {
  ConfigError,
  type LintRatchetComplexityFunction,
  parseComplexitySeverityMessage,
} from "../lint-ratchet-metrics.js";
import type { ESLintFileResult, ESLintMessage } from "./eslint-runner.js";
import { runEslint, runEslintForFiles } from "./eslint-runner.js";
import { relativePath } from "./paths.js";

const ESLINT_SEVERITY_ERROR = 2;
const MAX_LINES_MESSAGE_PATTERN =
  /This file has (?<lines>\d+) effective lines, above the (?<max>\d+) line limit/u;

interface MetricFinding {
  readonly lines?: number;
  readonly complexity?: LintRatchetComplexityFunction;
}

function minDefined(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.min(left, right);
}

function makeCurrentItem(
  count: number,
  firstLine: number | undefined,
  lines: number | undefined,
  perFunction: readonly LintRatchetComplexityFunction[] | undefined,
): LintRatchetCurrentItem {
  return {
    count,
    ...(firstLine === undefined ? {} : { firstLine }),
    ...(lines === undefined ? {} : { lines }),
    ...(perFunction === undefined ? {} : { perFunction }),
  };
}

function mergeLines(
  previous: LintRatchetCurrentItem | undefined,
  metric: MetricFinding,
): number | undefined {
  if (metric.lines === undefined) return previous?.lines;
  if (previous?.lines === undefined) return metric.lines;
  return Math.max(previous.lines, metric.lines);
}

function mergePerFunction(
  previous: LintRatchetCurrentItem | undefined,
  metric: MetricFinding,
): readonly LintRatchetComplexityFunction[] | undefined {
  return metric.complexity === undefined
    ? previous?.perFunction
    : [...(previous?.perFunction ?? []), metric.complexity];
}

function addFinding(
  items: Map<string, LintRatchetCurrentItem>,
  path: string,
  line: number | undefined,
  metric: MetricFinding,
): void {
  const previous = items.get(path);
  items.set(
    path,
    makeCurrentItem(
      (previous?.count ?? 0) + 1,
      minDefined(previous?.firstLine, line),
      mergeLines(previous, metric),
      mergePerFunction(previous, metric),
    ),
  );
}

function effectiveLineCountFor(
  ratchet: LintRatchetConfig,
  path: string,
  message: ESLintMessage,
): number | undefined {
  if (ratchet.metric !== "effective-line-count") return undefined;
  if (ratchet.ruleId !== "local/max-lines") {
    throw new ConfigError(`ratchet ${ratchet.id}: effective-line-count requires local/max-lines`);
  }
  const lines = MAX_LINES_MESSAGE_PATTERN.exec(message.message)?.groups?.lines;
  if (lines === undefined) {
    throw new ConfigError(
      `ratchet ${ratchet.id}: could not parse effective line count for ${path}: ${message.message}`,
    );
  }
  return Number(lines);
}

function metricFindingFor(
  ratchet: LintRatchetConfig,
  path: string,
  message: ESLintMessage,
): MetricFinding {
  if (ratchet.metric === "effective-line-count") {
    return { lines: effectiveLineCountFor(ratchet, path, message) };
  }
  if (ratchet.metric !== "complexity-severity") return {};
  if (ratchet.ruleId !== "complexity") {
    throw new ConfigError(`ratchet ${ratchet.id}: complexity-severity requires complexity`);
  }
  return { complexity: parseComplexitySeverityMessage(ratchet.id, path, message) };
}

function itemsFromResults(
  ratchet: LintRatchetConfig,
  results: readonly ESLintFileResult[],
): Map<string, LintRatchetCurrentItem> {
  const items = new Map<string, LintRatchetCurrentItem>();
  for (const result of results) {
    const path = relativePath(result.filePath);
    for (const message of result.messages) {
      if (
        message.ruleId === null &&
        (message.fatal === true || message.severity === ESLINT_SEVERITY_ERROR)
      ) {
        throw new ConfigError(`ESLint could not parse ${path}: ${message.message}`);
      }
      if (message.ruleId !== ratchet.ruleId) continue;
      addFinding(items, path, message.line, metricFindingFor(ratchet, path, message));
    }
  }
  return items;
}

export async function collectCurrentById(
  ruleSourceHashesById: LintRatchetRuleSourceHashesById,
): Promise<LintRatchetCurrentById> {
  const currentById = new Map<string, ReadonlyMap<string, LintRatchetCurrentItem>>();
  for (const ratchet of lintRatchets) {
    const ruleSourceHash = ruleSourceHashesById.get(ratchet.id);
    if (ruleSourceHash === undefined) {
      throw new ConfigError(`lint:ratchet: missing rule source hash for ${ratchet.id}`);
    }
    currentById.set(
      ratchet.id,
      itemsFromResults(ratchet, await runEslint(ratchet, ruleSourceHash)),
    );
  }
  return currentById;
}

// Narrow single-ratchet collection for the edit-time check: lints an explicit
// file set via the cache-safe positional runner and reuses the same message
// filtering, fatal-parse handling, and metric parsing as the full sweep.
export async function collectCurrentForRatchet(
  ratchet: LintRatchetConfig,
  ruleSourceHash: string,
  files: readonly string[],
): Promise<ReadonlyMap<string, LintRatchetCurrentItem>> {
  return itemsFromResults(ratchet, await runEslintForFiles(ratchet, ruleSourceHash, files));
}

export function totalCurrentCount(currentById: LintRatchetCurrentById): number {
  let total = 0;
  for (const items of currentById.values()) {
    for (const item of items.values()) total += item.count;
  }
  return total;
}
