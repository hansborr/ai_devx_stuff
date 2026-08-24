import {
  buildCloneCandidateAdvisory,
  CLONE_CANDIDATES_SUBCOMMAND,
  type CloneCandidateAdvisory,
  type CloneCandidateAdvisorySection,
  formatCloneCandidateAdvisoryJson,
  formatCloneCandidateAdvisoryText,
} from "./clone-candidates-advisory.js";
import {
  parseCloneCandidatesArgs,
  type ParsedCloneCandidatesArgs,
} from "./clone-candidates-args.js";
import type { DriftAiCommandResult } from "./command-result.js";
import type { BufferGitRunner, StatRunner } from "./current-inventory.js";
import type { GitRunner } from "./git-changed-scope.js";
import type { MinHashConfig } from "./minhash-lsh.js";
import { NEAR_DUPLICATE_TOOL, type ResolvedCompareConfig } from "./near-duplicates.js";
import { nearDuplicateExcludeGlobs } from "./near-duplicates-check-config.js";
import { defaultNearDuplicateRunner, type NearDuplicateRunner } from "./near-duplicates-runner.js";
import { prepareCurrentRun } from "./prepare-run.js";
import { buildPrototypeAdvisory } from "./prototype-advisory.js";
import {
  currentPrototypeCliOptions,
  finishPrototypeCommand,
  renderPrototypeAdvisory,
  runPrototypeCommand,
} from "./prototype-command.js";
import type { ReportWriter } from "./report-output.js";

export type CloneCandidatesRunOptions = {
  readonly argv: readonly string[];
  readonly git?: GitRunner;
  readonly gitBuffer?: BufferGitRunner;
  readonly stat?: StatRunner;
  readonly rootExists?: (absolutePath: string) => boolean;
  readonly nearDuplicates?: NearDuplicateRunner;
  readonly writer?: ReportWriter;
};

export type CloneCandidatesRunResult = DriftAiCommandResult;

export function runCloneCandidates(options: CloneCandidatesRunOptions): CloneCandidatesRunResult {
  return runPrototypeCommand(options, {
    parse: parseCloneCandidatesArgs,
    run: runParsedCloneCandidates,
  });
}

function runParsedCloneCandidates(
  options: CloneCandidatesRunOptions,
  parsed: ParsedCloneCandidatesArgs,
): CloneCandidatesRunResult {
  const prepared = prepareCurrentRun(currentPrototypeCliOptions(parsed), options);
  const config = resolveCloneCandidateConfig(parsed, prepared.config.checks["near-duplicates"]);
  const result = runFunctionInventory(options, prepared, config);
  const advisory = advisoryForResult(result, parsed, config, prepared.config.checks);
  return finishPrototypeCommand(
    parsed,
    renderPrototypeAdvisory(parsed.base.format, advisory, {
      json: formatCloneCandidateAdvisoryJson,
      text: formatCloneCandidateAdvisoryText,
    }),
    options.writer,
  );
}

function resolveCloneCandidateConfig(
  parsed: ParsedCloneCandidatesArgs,
  nearConfig: ReturnType<typeof prepareCurrentRun>["config"]["checks"]["near-duplicates"],
): ResolvedCompareConfig {
  return {
    minLines: parsed.minLines ?? nearConfig.minLines,
    minTokens: parsed.minTokens ?? nearConfig.minTokens,
    similarityThreshold: parsed.similarityThreshold ?? nearConfig.similarityThreshold,
    tokenBandRatio: nearConfig.tokenBandRatio,
  };
}

function runFunctionInventory(
  options: CloneCandidatesRunOptions,
  prepared: ReturnType<typeof prepareCurrentRun>,
  config: ResolvedCompareConfig,
): ReturnType<NearDuplicateRunner> {
  const nearConfig = prepared.config.checks["near-duplicates"];
  const runner = options.nearDuplicates ?? defaultNearDuplicateRunner();
  return runner({
    repoRoot: prepared.repoRoot,
    roots: prepared.roots,
    sourceExtensions: prepared.sourceExtensions,
    ignore: prepared.config.ignore,
    excludeGlobs: nearDuplicateExcludeGlobs(prepared.config.ignore, nearConfig),
    engine: NEAR_DUPLICATE_TOOL,
    minLines: config.minLines,
    minTokens: config.minTokens,
    similarityThreshold: config.similarityThreshold,
    includeExactTokens: false,
  });
}

function advisoryForResult(
  result: ReturnType<NearDuplicateRunner>,
  parsed: ParsedCloneCandidatesArgs,
  config: ResolvedCompareConfig,
  checksConfig: ReturnType<typeof prepareCurrentRun>["config"]["checks"],
): CloneCandidateAdvisory {
  if (!result.ok) return unavailableAdvisory(result.error);
  if (result.engine !== NEAR_DUPLICATE_TOOL)
    return unavailableAdvisory("runner returned a non-ts-morph result");
  return buildCloneCandidateAdvisory({
    functions: result.functions,
    top: parsed.top,
    minLines: config.minLines,
    minTokens: config.minTokens,
    similarityThreshold: config.similarityThreshold,
    tokenBandRatio: config.tokenBandRatio,
    siblingAllowedPairs: checksConfig["ghost-files"].currentAllowedPairs,
    ...(parsed.maxFunctions === null ? {} : { maxFunctions: parsed.maxFunctions }),
    ...minhashOption(parsed.minhash),
  });
}

function minhashOption(
  minhash: Partial<MinHashConfig>,
): { readonly minhash: Partial<MinHashConfig> } | Record<string, never> {
  return Object.keys(minhash).length === 0 ? {} : { minhash };
}

function unavailableAdvisory(reason: string): CloneCandidateAdvisory {
  return buildPrototypeAdvisory<CloneCandidateAdvisorySection>({
    subcommand: CLONE_CANDIDATES_SUBCOMMAND,
    prerequisites: [
      {
        name: "ts-morph function inventory",
        satisfied: false,
        detail: reason,
      },
    ],
    degradations: ["function inventory unavailable; no clone candidate rows computed"],
    sections: [
      {
        candidateKind: "MinHash/LSH function clone candidates",
        totalCandidates: 0,
        emptyReason: "function inventory prerequisite was unmet.",
        entries: [],
      },
    ],
  });
}
