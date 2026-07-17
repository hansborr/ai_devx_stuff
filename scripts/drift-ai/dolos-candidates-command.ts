import type { BufferGitRunner, StatRunner } from "./current-inventory.js";
import {
  buildDolosAdvisory,
  formatDolosAdvisoryJson,
  formatDolosAdvisoryText,
} from "./dolos-advisory.js";
import {
  type ParsedDolosCandidatesArgs,
  parseDolosCandidatesArgs,
} from "./dolos-candidates-args.js";
import { defaultDolosRunner, type DolosRunner, type DolosRunnerResult } from "./dolos-runner.js";
import type { GitRunner } from "./git-changed-scope.js";
import { nearDuplicateExcludeGlobs } from "./near-duplicates-check-config.js";
import { prepareCurrentRun } from "./prepare-run.js";
import {
  capturePrototypeScanSnapshot,
  completedScanProvenance,
  currentPrototypeCliOptions,
  finishPrototypeCommand,
  renderPrototypeAdvisory,
  runPrototypeCommand,
} from "./prototype-command.js";
import type { ReportWriter } from "./report-output.js";
import { triageGeneratedArtifactExclusions } from "./triage-packet-staleness.js";

export type DolosCandidatesRunOptions = {
  readonly argv: readonly string[];
  readonly git?: GitRunner;
  readonly gitBuffer?: BufferGitRunner;
  readonly stat?: StatRunner;
  readonly rootExists?: (absolutePath: string) => boolean;
  // Injectable Dolos runner so a CLI smoke test never needs the binary installed.
  readonly dolos?: DolosRunner;
  readonly writer?: ReportWriter;
};

export type DolosCandidatesRunResult = {
  readonly exitCode: number;
  readonly stdout: string;
};

export function runDolosCandidates(options: DolosCandidatesRunOptions): DolosCandidatesRunResult {
  return runPrototypeCommand(options, {
    parse: parseDolosCandidatesArgs,
    run: runParsedDolosCandidates,
  });
}

function runParsedDolosCandidates(
  options: DolosCandidatesRunOptions,
  parsed: ParsedDolosCandidatesArgs,
): DolosCandidatesRunResult {
  const prepared = prepareCurrentRun(currentPrototypeCliOptions(parsed), options);
  const excludedArtifacts = triageGeneratedArtifactExclusions(
    parsed.base.outputPath === null ? [] : [parsed.base.outputPath],
  );
  const beforeScan = capturePrototypeScanSnapshot(
    options.git,
    prepared.repoRoot,
    excludedArtifacts,
  );
  const result = runDolosEngine(options, prepared, parsed);
  const afterScan = capturePrototypeScanSnapshot(options.git, prepared.repoRoot, excludedArtifacts);
  const advisory = buildDolosAdvisory(result, {
    top: parsed.top,
    scanProvenance: completedScanProvenance(beforeScan, afterScan),
  });
  return finishPrototypeCommand(
    parsed,
    renderPrototypeAdvisory(parsed.base.format, advisory, {
      json: formatDolosAdvisoryJson,
      text: formatDolosAdvisoryText,
    }),
    options.writer,
  );
}

function runDolosEngine(
  options: DolosCandidatesRunOptions,
  prepared: ReturnType<typeof prepareCurrentRun>,
  parsed: ParsedDolosCandidatesArgs,
): DolosRunnerResult {
  // Feed Dolos the same filtered inventory the near-duplicates engines see so it
  // never reaches ignored, excluded, .d.ts, or unsupported-extension files.
  const nearConfig = prepared.config.checks["near-duplicates"];
  const runner = options.dolos ?? defaultDolosRunner(commandOption(parsed.command));
  return runner({
    repoRoot: prepared.repoRoot,
    roots: prepared.roots,
    sourceExtensions: prepared.sourceExtensions,
    ignore: prepared.config.ignore,
    excludeGlobs: nearDuplicateExcludeGlobs(prepared.config.ignore, nearConfig),
    languageMode: parsed.languageMode,
    threshold: parsed.threshold,
    maxFiles: parsed.maxFiles,
    maxCandidatePairs: parsed.maxCandidatePairs,
    maxReportedPairs: parsed.maxReportedPairs,
  });
}

function commandOption(command: string | null): { readonly command?: string } {
  return command === null ? {} : { command };
}
