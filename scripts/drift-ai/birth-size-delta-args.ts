import { z } from "zod";

import { positiveIntValue } from "./arg-readers.js";
import {
  BIRTH_SIZE_DELTA_SUBCOMMAND,
  DEFAULT_BIRTH_SIZE_DELTA_BLOB_TIMEOUT_MS,
  DEFAULT_BIRTH_SIZE_DELTA_MAX_BLOB_BYTES,
  DEFAULT_BIRTH_SIZE_DELTA_MAX_BLOB_READS,
  DEFAULT_BIRTH_SIZE_DELTA_TOP,
} from "./birth-size-delta-advisory.js";
import {
  BOUNDED_HISTORY_CLI_OPTIONS,
  boundedHistoryArgsFromOptions,
  boundedHistorySchemaShape,
} from "./bounded-history-options.js";
import {
  CONFIG_CLI_OPTION,
  configSchemaShape,
  parseSubcommandCli,
  SUBCOMMAND_BASE_CLI_OPTIONS,
  subcommandBaseFromOptions,
  type SubcommandBaseOptions,
  subcommandBaseSchemaShape,
} from "./subcommand-args.js";

const BIRTH_SIZE_DELTA_USAGE = [
  "Usage:",
  `  bun run drift:ai ${BIRTH_SIZE_DELTA_SUBCOMMAND}`,
  `  bun run drift:ai ${BIRTH_SIZE_DELTA_SUBCOMMAND} --top <N>`,
  `  bun run drift:ai ${BIRTH_SIZE_DELTA_SUBCOMMAND} --max-blob-reads <N>`,
  `  bun run drift:ai ${BIRTH_SIZE_DELTA_SUBCOMMAND} --max-blob-bytes <N> --blob-timeout-ms <N>`,
  `  bun run drift:ai ${BIRTH_SIZE_DELTA_SUBCOMMAND} --since <git-date>`,
  `  bun run drift:ai ${BIRTH_SIZE_DELTA_SUBCOMMAND} --max-commits <N> --max-files <N>`,
  `  bun run drift:ai ${BIRTH_SIZE_DELTA_SUBCOMMAND} --max-output-bytes <N> --timeout-ms <N>`,
  `  bun run drift:ai ${BIRTH_SIZE_DELTA_SUBCOMMAND} --config <path>`,
  `  bun run drift:ai ${BIRTH_SIZE_DELTA_SUBCOMMAND} --format <text|json> [--output <path>]`,
  "",
  "Report-only prototype advisory (exit 0). Compares each current source file's",
  "current blob to its observed path-birth blob using bytes, effective LOC, and a",
  "branch-points complexity overlay (not ESLint cyclomatic complexity).",
].join("\n");

export type ParsedBirthSizeDeltaArgs = {
  readonly base: SubcommandBaseOptions;
  readonly top: number;
  readonly since: string | null;
  readonly maxCommits: number | null;
  readonly maxFiles: number | null;
  readonly maxOutputBytes: number | null;
  readonly timeoutMs: number | null;
  readonly maxBlobReads: number;
  readonly maxBlobBytes: number;
  readonly blobTimeoutMs: number;
};

const CLI_OPTIONS = [
  ...SUBCOMMAND_BASE_CLI_OPTIONS,
  CONFIG_CLI_OPTION,
  { name: "--top", kind: "value" },
  ...BOUNDED_HISTORY_CLI_OPTIONS,
  { name: "--max-blob-reads", kind: "value" },
  { name: "--max-blob-bytes", kind: "value" },
  { name: "--blob-timeout-ms", kind: "value" },
] as const;

const cliOptionsSchema = z.object({
  ...subcommandBaseSchemaShape,
  ...configSchemaShape,
  "--top": positiveIntValue("--top").default(DEFAULT_BIRTH_SIZE_DELTA_TOP),
  ...boundedHistorySchemaShape,
  "--max-blob-reads": positiveIntValue("--max-blob-reads").default(
    DEFAULT_BIRTH_SIZE_DELTA_MAX_BLOB_READS,
  ),
  "--max-blob-bytes": positiveIntValue("--max-blob-bytes").default(
    DEFAULT_BIRTH_SIZE_DELTA_MAX_BLOB_BYTES,
  ),
  "--blob-timeout-ms": positiveIntValue("--blob-timeout-ms").default(
    DEFAULT_BIRTH_SIZE_DELTA_BLOB_TIMEOUT_MS,
  ),
});

export function parseBirthSizeDeltaArgs(argv: readonly string[]): ParsedBirthSizeDeltaArgs {
  const { options } = parseSubcommandCli({
    argv,
    usage: BIRTH_SIZE_DELTA_USAGE,
    options: CLI_OPTIONS,
    schema: cliOptionsSchema,
  });
  return {
    base: subcommandBaseFromOptions(options),
    top: options["--top"],
    ...boundedHistoryArgsFromOptions(options),
    maxBlobReads: options["--max-blob-reads"],
    maxBlobBytes: options["--max-blob-bytes"],
    blobTimeoutMs: options["--blob-timeout-ms"],
  };
}
