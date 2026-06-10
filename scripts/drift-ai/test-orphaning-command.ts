import {
  type BoundedHistoryGitRunner,
  defaultBoundedHistoryGitRunner,
} from "./bounded-full-history.js";
import { collectConfiguredBoundedFullHistory } from "./bounded-history-options.js";
import type { DriftAiIgnoreConfig } from "./config.js";
import type { GitRunner } from "./git-changed-scope.js";
import {
  finishPrototypeCommand,
  renderPrototypeAdvisory,
  resolvePrototypeConfig,
  runPrototypeCommand,
} from "./prototype-command.js";
import type { ReportWriter } from "./report-output.js";
import {
  buildTestOrphaningAdvisory,
  formatTestOrphaningAdvisoryJson,
  formatTestOrphaningAdvisoryText,
} from "./test-orphaning-advisory.js";
import { type ParsedTestOrphaningArgs, parseTestOrphaningArgs } from "./test-orphaning-args.js";

export type TestOrphaningRunOptions = {
  readonly argv: readonly string[];
  readonly git?: GitRunner;
  readonly boundedGit?: BoundedHistoryGitRunner;
  readonly writer?: ReportWriter;
};

export type TestOrphaningRunResult = {
  readonly exitCode: number;
  readonly stdout: string;
};

export function runTestOrphaning(options: TestOrphaningRunOptions): TestOrphaningRunResult {
  return runPrototypeCommand(options, {
    parse: parseTestOrphaningArgs,
    run: runParsedTestOrphaning,
  });
}

function runParsedTestOrphaning(
  options: TestOrphaningRunOptions,
  parsed: ParsedTestOrphaningArgs,
): TestOrphaningRunResult {
  const context = resolveRunContext(options, parsed);
  const history = collectTestOrphaningHistory(parsed, context);
  const advisory = buildTestOrphaningAdvisory({
    history,
    top: parsed.top,
    minSourceCommits: parsed.minSourceCommits,
    mappingPatterns: parsed.mappingPatterns,
  });
  return finishPrototypeCommand(
    parsed,
    renderPrototypeAdvisory(parsed.base.format, advisory, {
      json: formatTestOrphaningAdvisoryJson,
      text: formatTestOrphaningAdvisoryText,
    }),
    options.writer,
  );
}

type TestOrphaningRunContext = {
  readonly boundedGit: BoundedHistoryGitRunner;
  readonly ignore: DriftAiIgnoreConfig;
};

function resolveRunContext(
  options: TestOrphaningRunOptions,
  parsed: ParsedTestOrphaningArgs,
): TestOrphaningRunContext {
  const resolved = resolvePrototypeConfig(options, parsed.base.configPath);
  return {
    boundedGit: options.boundedGit ?? defaultBoundedHistoryGitRunner(resolved.repoRoot),
    ignore: resolved.config.ignore,
  };
}

function collectTestOrphaningHistory(
  parsed: ParsedTestOrphaningArgs,
  context: TestOrphaningRunContext,
): ReturnType<typeof collectConfiguredBoundedFullHistory> {
  return collectConfiguredBoundedFullHistory(parsed, context);
}
