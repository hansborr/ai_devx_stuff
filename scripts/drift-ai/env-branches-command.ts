import type { DriftAiCommandResult } from "./command-result.js";
import type { BufferGitRunner, StatRunner } from "./current-inventory.js";
import {
  buildEnvBranchesAdvisory,
  formatEnvBranchesAdvisoryJson,
  formatEnvBranchesAdvisoryText,
  isEnvDefineMatrixEmpty,
} from "./env-branches-advisory.js";
import { type ParsedEnvBranchesArgs, parseEnvBranchesArgs } from "./env-branches-args.js";
import { collectEnvDefineInventory } from "./env-define-evaluator.js";
import type { EnvDefineInventory } from "./env-define-types.js";
import type { GitRunner } from "./git-changed-scope.js";
import { prepareCurrentRun } from "./prepare-run.js";
import {
  currentPrototypeCliOptions,
  finishPrototypeCommand,
  renderPrototypeAdvisory,
  runPrototypeCommand,
} from "./prototype-command.js";
import type { ReportWriter } from "./report-output.js";

export type EnvBranchesRunOptions = {
  readonly argv: readonly string[];
  readonly git?: GitRunner;
  readonly gitBuffer?: BufferGitRunner;
  readonly stat?: StatRunner;
  readonly rootExists?: (absolutePath: string) => boolean;
  readonly writer?: ReportWriter;
};

export type EnvBranchesRunResult = DriftAiCommandResult;

const EMPTY_INVENTORY: EnvDefineInventory = { reads: [], conditions: [] };

export function runEnvBranches(options: EnvBranchesRunOptions): EnvBranchesRunResult {
  return runPrototypeCommand(options, {
    parse: parseEnvBranchesArgs,
    run: runParsedEnvBranches,
  });
}

function runParsedEnvBranches(
  options: EnvBranchesRunOptions,
  parsed: ParsedEnvBranchesArgs,
): EnvBranchesRunResult {
  const prepared = prepareCurrentRun(currentPrototypeCliOptions(parsed), options);
  const matrix = prepared.config.envDefine;
  // Skip the whole-repo source walk when no matrix is configured: every condition
  // would resolve to "unknown" and the advisory discloses the unmet prerequisite.
  const inventory = isEnvDefineMatrixEmpty(matrix)
    ? EMPTY_INVENTORY
    : collectEnvDefineInventory({
        repoRoot: prepared.repoRoot,
        roots: prepared.roots,
        sourceExtensions: prepared.sourceExtensions,
        ignore: prepared.config.ignore,
        matrix,
      });
  const advisory = buildEnvBranchesAdvisory(inventory, matrix, { top: parsed.top });
  return finishPrototypeCommand(
    parsed,
    renderPrototypeAdvisory(parsed.base.format, advisory, {
      json: formatEnvBranchesAdvisoryJson,
      text: formatEnvBranchesAdvisoryText,
    }),
    options.writer,
  );
}
