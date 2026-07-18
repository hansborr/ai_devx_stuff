import { readFile } from "node:fs/promises";

import { writeFileAtomically, writePostMergeTruthUpMarker } from "../kernel/atomic-write.js";

const USAGE_ERROR_EXIT_CODE = 2;

type MergeDriverResult = {
  readonly mergedText?: string;
  readonly failures: readonly string[];
  readonly postMergeTruthUpRequired: boolean;
};

export type MergeDriverCliConfig = {
  readonly usage: string;
  readonly unresolvedFailureLabel: string;
  readonly fatalFailureLabel: string;
  readonly markerMessage: string;
  readonly merge: (input: {
    readonly baseText: string;
    readonly currentText: string;
    readonly otherText: string;
  }) => MergeDriverResult;
};

type MergeDriverCliOperations = {
  readonly readText?: (path: string) => Promise<string>;
  readonly writeMarker?: typeof writePostMergeTruthUpMarker;
  readonly writeBaseline?: typeof writeFileAtomically;
};

type RequiredMergeDriverCliOperations = Required<MergeDriverCliOperations>;

type MergeDriverCliArgs = {
  readonly basePath: string;
  readonly currentPath: string;
  readonly otherPath: string;
  readonly displayPath: string;
  readonly markerPath: string | undefined;
  readonly preMergeHeadSha: string | undefined;
};

export async function runMergeDriverCli(
  argv: readonly string[],
  config: MergeDriverCliConfig,
  operations: MergeDriverCliOperations = {},
): Promise<number> {
  const args = parseArgs(argv, config.usage);
  if (args === null) return USAGE_ERROR_EXIT_CODE;
  const io = completeOperations(operations);
  const [baseText, currentText, otherText] = await Promise.all([
    io.readText(args.basePath),
    io.readText(args.currentPath),
    io.readText(args.otherPath),
  ]);
  const result = config.merge({ baseText, currentText, otherText });
  if (result.mergedText === undefined) return reportUnresolved(config, args, result.failures);

  await io.writeMarker(
    args.markerPath,
    args.preMergeHeadSha,
    result.postMergeTruthUpRequired,
    config.markerMessage,
  );
  await io.writeBaseline(args.currentPath, result.mergedText);
  return 0;
}

export function runMergeDriverCliMain(argv: readonly string[], config: MergeDriverCliConfig): void {
  runMergeDriverCli(argv, config)
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${config.fatalFailureLabel}: ${message}`);
      process.exitCode = 1;
    });
}

async function readUtf8File(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function parseArgs(argv: readonly string[], usage: string): MergeDriverCliArgs | null {
  const [basePath, currentPath, otherPath, path, markerPath, preMergeHeadSha, unexpected] = argv;
  if (
    basePath === undefined ||
    currentPath === undefined ||
    otherPath === undefined ||
    unexpected !== undefined
  ) {
    console.error(usage);
    return null;
  }
  return {
    basePath,
    currentPath,
    otherPath,
    displayPath: path ?? currentPath,
    markerPath,
    preMergeHeadSha,
  };
}

function completeOperations(
  operations: MergeDriverCliOperations,
): RequiredMergeDriverCliOperations {
  return {
    readText: operations.readText ?? readUtf8File,
    writeMarker: operations.writeMarker ?? writePostMergeTruthUpMarker,
    writeBaseline: operations.writeBaseline ?? writeFileAtomically,
  };
}

function reportUnresolved(
  config: MergeDriverCliConfig,
  args: MergeDriverCliArgs,
  failures: readonly string[],
): number {
  console.error(`${config.unresolvedFailureLabel} ${args.displayPath}:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  return 1;
}
