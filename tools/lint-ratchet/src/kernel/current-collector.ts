import { createHash } from "node:crypto";
import { isAbsolute, relative } from "node:path";

import type {
  LintRatchetCurrentById,
  LintRatchetCurrentItem,
  LintRatchetRuleSourceHashesById,
} from "./baseline.js";
import type { LintRatchetConfig } from "./config-types.js";
import { collectRatchets } from "./current-collection-scheduler.js";
import type { LintRatchetEngineBinding } from "./engine-context.js";
import type { ESLintFileResult } from "./eslint-runner.js";
import { runEslintForFiles } from "./eslint-runner.js";
import { trackedFilesFromGit } from "./git-tracked-files.js";
import { messageIdentityForFinding, type MessageIdentityLocation } from "./message-identity.js";
import { type MetricFinding, metricStrategy } from "./metric-strategies.js";
import { ConfigError, type LintRatchetComplexityFunction } from "./metrics-types.js";

const ESLINT_SEVERITY_ERROR = 2;
export const DEFAULT_COLLECT_CONCURRENCY = 3;

interface CurrentItemParts {
  readonly count: number;
  readonly firstLine?: number;
  readonly lines?: number;
  readonly perFunction?: readonly LintRatchetComplexityFunction[];
  readonly firstMessage?: string;
  readonly firstMessageId?: string;
  readonly messagesFingerprint?: string;
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
    ...(parts.messagesFingerprint === undefined
      ? {}
      : { messagesFingerprint: parts.messagesFingerprint }),
  };
}

function messageFingerprintFor(identities: readonly string[]): string {
  const hash = createHash("sha256")
    .update(JSON.stringify([...identities].sort()))
    .digest("hex");
  return `sha256:${hash}`;
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

function recordMessageIdentity(
  ratchet: LintRatchetConfig,
  finding: {
    readonly identitiesByPath: Map<string, string[]>;
    readonly path: string;
    readonly metric: MetricFinding;
    readonly location: MessageIdentityLocation;
    readonly repoRootPath: string;
  },
): void {
  if (!metricStrategy(ratchet.metric).recordsMessageIdentity) return;
  const identity = messageIdentityForFinding(
    finding.metric.message,
    finding.metric.messageId,
    finding.location,
    finding.repoRootPath,
  );
  if (identity === undefined) return;
  const identities = finding.identitiesByPath.get(finding.path) ?? [];
  identities.push(identity);
  finding.identitiesByPath.set(finding.path, identities);
}

function addMessageFingerprints(
  items: Map<string, LintRatchetCurrentItem>,
  identitiesByPath: ReadonlyMap<string, readonly string[]>,
): void {
  for (const [path, identities] of identitiesByPath.entries()) {
    const item = items.get(path);
    if (item === undefined || identities.length === 0) continue;
    items.set(path, { ...item, messagesFingerprint: messageFingerprintFor(identities) });
  }
}

export function itemsFromResults(
  ratchet: LintRatchetConfig,
  results: readonly ESLintFileResult[],
  repoRootPath: string,
): Map<string, LintRatchetCurrentItem> {
  const items = new Map<string, LintRatchetCurrentItem>();
  const messageIdentitiesByPath = new Map<string, string[]>();
  for (const result of results) {
    const path = relativePathForRoot(result.filePath, repoRootPath);
    for (const message of result.messages) {
      if (
        message.ruleId === null &&
        (message.fatal === true || message.severity === ESLINT_SEVERITY_ERROR)
      ) {
        throw new ConfigError(`ESLint could not parse ${path}: ${message.message}`);
      }
      if (message.ruleId !== ratchet.ruleId) continue;
      const metric = metricStrategy(ratchet.metric).reduceMessage(ratchet, path, message);
      addFinding(items, path, message.line, metric);
      recordMessageIdentity(ratchet, {
        identitiesByPath: messageIdentitiesByPath,
        path,
        metric,
        location: { filePath: result.filePath, line: message.line, column: message.column },
        repoRootPath,
      });
    }
  }
  addMessageFingerprints(items, messageIdentitiesByPath);
  return items;
}

function relativePathForRoot(filePath: string, repoRootPath: string): string {
  if (!isAbsolute(filePath)) return filePath.replaceAll("\\", "/");
  const rel = relative(repoRootPath, filePath);
  return rel === "" ? filePath : rel.replaceAll("\\", "/");
}

export interface CollectCurrentByIdInput {
  readonly ruleSourceHashesById: LintRatchetRuleSourceHashesById;
  // The registry is injected here, at the outermost layer only; the scheduler
  // takes it as a parameter so it can be reused against any registry.
  readonly ratchets: readonly LintRatchetConfig[];
  readonly binding: LintRatchetEngineBinding;
  readonly concurrency?: number;
  readonly trackedFiles?: readonly string[];
}

export async function collectCurrentById(
  input: CollectCurrentByIdInput,
): Promise<LintRatchetCurrentById> {
  const { ruleSourceHashesById, ratchets, binding } = input;
  const concurrency = input.concurrency ?? DEFAULT_COLLECT_CONCURRENCY;
  const trackedFiles =
    input.trackedFiles ?? trackedFilesFromGit("collecting lint ratchet files", binding.repoRoot);
  const limit = Math.max(1, Math.min(concurrency, ratchets.length));
  const results = await collectRatchets(ratchets, ruleSourceHashesById, {
    limit,
    trackedFiles,
    binding,
  });

  const currentById = new Map<string, ReadonlyMap<string, LintRatchetCurrentItem>>();
  for (const result of results) {
    if (result === undefined) continue;
    currentById.set(result.id, itemsFromResults(result.ratchet, result.results, binding.repoRoot));
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
  binding: LintRatchetEngineBinding,
): Promise<ReadonlyMap<string, LintRatchetCurrentItem>> {
  return itemsFromResults(
    ratchet,
    await runEslintForFiles(ratchet, ruleSourceHash, files, binding),
    binding.repoRoot,
  );
}

export function totalCurrentCount(currentById: LintRatchetCurrentById): number {
  let total = 0;
  for (const items of currentById.values()) {
    for (const item of items.values()) total += item.count;
  }
  return total;
}
