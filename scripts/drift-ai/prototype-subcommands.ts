import type { PathProbe } from "./adapter-support.js";
import { runBirthSizeDelta } from "./birth-size-delta-command.js";
import type { BoundedHistoryGitRunner } from "./bounded-full-history.js";
import { runClassConstruction } from "./class-construction-command.js";
import { runCloneCandidates } from "./clone-candidates-command.js";
import { runCoverageEvidence } from "./coverage-evidence-command.js";
import { runCoverageUnusedCorrelation } from "./coverage-unused-correlation-command.js";
import type { BufferGitRunner, StatRunner } from "./current-inventory.js";
import { runDolosCandidates } from "./dolos-candidates-command.js";
import type { DolosRunner } from "./dolos-runner.js";
import { runEnvBranches } from "./env-branches-command.js";
import type { GitRunner } from "./git-changed-scope.js";
import type { NearDuplicateRunner } from "./near-duplicates-runner.js";
import { runOwnership } from "./ownership-command.js";
import {
  PROTOTYPE_SUBCOMMAND_DEFINITIONS,
  type PrototypeSubcommandId,
} from "./prototype-subcommand-definitions.js";
export { PROTOTYPE_SUBCOMMAND_IDS } from "./prototype-subcommand-definitions.js";
import type { ReportWriter } from "./report-output.js";
import { runSemgrepCandidates } from "./semgrep-candidates-command.js";
import type { SemgrepRunner } from "./semgrep-runner.js";
import { runTestOrphaning } from "./test-orphaning-command.js";

export type PrototypeSubcommandOptions = {
  readonly argv: readonly string[];
  readonly git?: GitRunner;
  readonly gitBuffer?: BufferGitRunner;
  readonly stat?: StatRunner;
  readonly rootExists?: (absolutePath: string) => boolean;
  readonly nearDuplicates?: NearDuplicateRunner;
  readonly dolos?: DolosRunner;
  readonly semgrep?: SemgrepRunner;
  readonly boundedGit?: BoundedHistoryGitRunner;
  readonly readFile?: (filePath: string) => string | undefined;
  readonly pathExists?: PathProbe;
  readonly writer?: ReportWriter;
};

export type PrototypeSubcommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
};

type PrototypeSubcommandHandler = (
  options: PrototypeSubcommandOptions,
) => PrototypeSubcommandResult;

const PROTOTYPE_SUBCOMMAND_HANDLERS = {
  "env-branches": runEnvBranches,
  "coverage-evidence": runCoverageEvidence,
  "coverage-unused-exports": runCoverageUnusedCorrelation,
  "clone-candidates": runCloneCandidates,
  "dolos-candidates": runDolosCandidates,
  "semgrep-candidates": runSemgrepCandidates,
  ownership: runOwnership,
  "test-orphaning": runTestOrphaning,
  "birth-size-delta": runBirthSizeDelta,
  "class-construction": runClassConstruction,
} satisfies Record<PrototypeSubcommandId, PrototypeSubcommandHandler>;

const PROTOTYPE_SUBCOMMANDS: ReadonlyMap<string, PrototypeSubcommandHandler> = new Map(
  PROTOTYPE_SUBCOMMAND_DEFINITIONS.map((definition) => [
    definition.id,
    PROTOTYPE_SUBCOMMAND_HANDLERS[definition.id],
  ]),
);

export function runPrototypeSubcommand(
  options: PrototypeSubcommandOptions,
): PrototypeSubcommandResult | undefined {
  const subcommand = options.argv[0];
  if (subcommand === undefined) return undefined;
  const handler = PROTOTYPE_SUBCOMMANDS.get(subcommand);
  if (handler === undefined) return undefined;
  return handler({ ...options, argv: options.argv.slice(1) });
}
