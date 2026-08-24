import {
  type BoundedHistoryGitRunner,
  defaultBoundedHistoryGitRunner,
} from "./bounded-full-history.js";
import { collectConfiguredBoundedFullHistory } from "./bounded-history-options.js";
import type { DriftAiCommandResult } from "./command-result.js";
import type { DriftAiIgnoreConfig } from "./config.js";
import type { GitRunner } from "./git-changed-scope.js";
import {
  buildOwnershipAdvisory,
  formatIdentity,
  formatOwnershipAdvisoryJson,
  formatOwnershipAdvisoryText,
  type MailmapIdentityResolver,
  type OwnershipIdentity,
  parseIdentity,
} from "./ownership-advisory.js";
import { type ParsedOwnershipArgs, parseOwnershipArgs } from "./ownership-args.js";
import {
  finishPrototypeCommand,
  renderPrototypeAdvisory,
  resolvePrototypeConfig,
  runPrototypeCommand,
} from "./prototype-command.js";
import type { ReportWriter } from "./report-output.js";

export type OwnershipRunOptions = {
  readonly argv: readonly string[];
  readonly git?: GitRunner;
  readonly boundedGit?: BoundedHistoryGitRunner;
  readonly writer?: ReportWriter;
};

export type OwnershipRunResult = DriftAiCommandResult;

export function runOwnership(options: OwnershipRunOptions): OwnershipRunResult {
  return runPrototypeCommand(options, {
    parse: parseOwnershipArgs,
    run: runParsedOwnership,
  });
}

function runParsedOwnership(
  options: OwnershipRunOptions,
  parsed: ParsedOwnershipArgs,
): OwnershipRunResult {
  const context = resolveRunContext(options, parsed);
  const history = collectOwnershipHistory(parsed, context);
  const advisory = buildOwnershipAdvisory({
    history,
    top: parsed.top,
    agentIdentityPatterns: parsed.agentIdentityPatterns,
    mailmapIdentity: gitMailmapResolver(context.boundedGit),
  });
  return finishPrototypeCommand(
    parsed,
    renderPrototypeAdvisory(parsed.base.format, advisory, {
      json: formatOwnershipAdvisoryJson,
      text: formatOwnershipAdvisoryText,
    }),
    options.writer,
  );
}

type OwnershipRunContext = {
  readonly boundedGit: BoundedHistoryGitRunner;
  readonly ignore: DriftAiIgnoreConfig;
};

function resolveRunContext(
  options: OwnershipRunOptions,
  parsed: ParsedOwnershipArgs,
): OwnershipRunContext {
  const resolved = resolvePrototypeConfig(options, parsed.base.configPath);
  return {
    boundedGit: options.boundedGit ?? defaultBoundedHistoryGitRunner(resolved.repoRoot),
    ignore: resolved.config.ignore,
  };
}

function collectOwnershipHistory(
  parsed: ParsedOwnershipArgs,
  context: OwnershipRunContext,
): ReturnType<typeof collectConfiguredBoundedFullHistory> {
  return collectConfiguredBoundedFullHistory(parsed, context);
}

function gitMailmapResolver(git: BoundedHistoryGitRunner): MailmapIdentityResolver {
  const cache = new Map<string, OwnershipIdentity>();
  return (identity) => {
    const key = formatIdentity(identity);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    let resolved = identity;
    try {
      const output = git(["check-mailmap", key]).trim();
      if (output.length > 0) resolved = parseIdentity(output);
    } catch {
      resolved = identity;
    }
    cache.set(key, resolved);
    return resolved;
  };
}
