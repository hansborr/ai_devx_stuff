import type { ESLintFileResult, ESLintMessage } from "./eslint-runner.js";
import { runEslint, runEslintForFiles } from "./eslint-runner.js";
import type {
  LintRatchetCurrentById,
  LintRatchetCurrentItem,
  LintRatchetRuleSourceHashesById,
} from "./lint-ratchet-baseline.js";
import { type LintRatchetConfig, lintRatchets } from "./lint-ratchet-config.js";
import {
  ConfigError,
  type LintRatchetComplexityFunction,
  parseComplexitySeverityMessage,
} from "./lint-ratchet-metrics.js";
import { relativePath } from "./paths.js";

const ESLINT_SEVERITY_ERROR = 2;
const MAX_LINES_MESSAGE_PATTERN =
  /This file has (?<lines>\d+) effective lines, above the \d+ line limit/u;

interface MetricFinding {
  readonly lines?: number;
  readonly complexity?: LintRatchetComplexityFunction;
  readonly message?: string;
  readonly messageId?: string;
}

interface CurrentItemParts {
  readonly count: number;
  readonly firstLine?: number;
  readonly lines?: number;
  readonly perFunction?: readonly LintRatchetComplexityFunction[];
  readonly firstMessage?: string;
  readonly firstMessageId?: string;
}

function minDefined(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.min(left, right);
}

function makeCurrentItem(parts: CurrentItemParts): LintRatchetCurrentItem {
  return {
    count: parts.count,
    ...(parts.firstLine === undefined ? {} : { firstLine: parts.firstLine }),
    ...(parts.lines === undefined ? {} : { lines: parts.lines }),
    ...(parts.perFunction === undefined ? {} : { perFunction: parts.perFunction }),
    ...(parts.firstMessage === undefined ? {} : { firstMessage: parts.firstMessage }),
    ...(parts.firstMessageId === undefined ? {} : { firstMessageId: parts.firstMessageId }),
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

function mergeFirstMessageContext(
  previous: LintRatchetCurrentItem | undefined,
  metric: MetricFinding,
): Pick<CurrentItemParts, "firstMessage" | "firstMessageId"> {
  if (previous?.firstMessage !== undefined) {
    return { firstMessage: previous.firstMessage, firstMessageId: previous.firstMessageId };
  }
  return { firstMessage: metric.message, firstMessageId: metric.messageId };
}

function addFinding(
  items: Map<string, LintRatchetCurrentItem>,
  path: string,
  line: number | undefined,
  metric: MetricFinding,
): void {
  const previous = items.get(path);
  const messageContext = mergeFirstMessageContext(previous, metric);
  items.set(
    path,
    makeCurrentItem({
      count: (previous?.count ?? 0) + 1,
      firstLine: minDefined(previous?.firstLine, line),
      lines: mergeLines(previous, metric),
      perFunction: mergePerFunction(previous, metric),
      firstMessage: messageContext.firstMessage,
      firstMessageId: messageContext.firstMessageId,
    }),
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
  switch (ratchet.metric) {
    case "message-count":
      return { message: message.message, messageId: message.messageId };
    case "effective-line-count":
      return { lines: effectiveLineCountFor(ratchet, path, message) };
    case "complexity-severity":
      if (ratchet.ruleId !== "complexity") {
        throw new ConfigError(`ratchet ${ratchet.id}: complexity-severity requires complexity`);
      }
      return { complexity: parseComplexitySeverityMessage(ratchet.id, path, message) };
    default:
      return {};
  }
}

export function itemsFromResults(
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
