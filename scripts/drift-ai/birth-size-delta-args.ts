import { readNonEmpty, readPositiveInt } from "./arg-readers.js";
import {
  BIRTH_SIZE_DELTA_SUBCOMMAND,
  DEFAULT_BIRTH_SIZE_DELTA_BLOB_TIMEOUT_MS,
  DEFAULT_BIRTH_SIZE_DELTA_MAX_BLOB_BYTES,
  DEFAULT_BIRTH_SIZE_DELTA_MAX_BLOB_READS,
  DEFAULT_BIRTH_SIZE_DELTA_TOP,
} from "./birth-size-delta-advisory.js";
import { parseSubcommandArgs, type SubcommandBaseOptions } from "./subcommand-args.js";

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

export function parseBirthSizeDeltaArgs(argv: readonly string[]): ParsedBirthSizeDeltaArgs {
  let top = DEFAULT_BIRTH_SIZE_DELTA_TOP;
  let since: string | null = null;
  let maxCommits: number | null = null;
  let maxFiles: number | null = null;
  let maxOutputBytes: number | null = null;
  let timeoutMs: number | null = null;
  let maxBlobReads = DEFAULT_BIRTH_SIZE_DELTA_MAX_BLOB_READS;
  let maxBlobBytes = DEFAULT_BIRTH_SIZE_DELTA_MAX_BLOB_BYTES;
  let blobTimeoutMs = DEFAULT_BIRTH_SIZE_DELTA_BLOB_TIMEOUT_MS;
  const base = parseSubcommandArgs(argv, {
    usage: BIRTH_SIZE_DELTA_USAGE,
    acceptsConfig: true,
    valueOptions: {
      "--top": (value) => {
        top = readPositiveInt(value, "--top");
      },
      "--since": (value) => {
        since = readNonEmpty(value, "--since");
      },
      "--max-commits": (value) => {
        maxCommits = readPositiveInt(value, "--max-commits");
      },
      "--max-blob-reads": (value) => {
        maxBlobReads = readPositiveInt(value, "--max-blob-reads");
      },
      "--max-blob-bytes": (value) => {
        maxBlobBytes = readPositiveInt(value, "--max-blob-bytes");
      },
      "--blob-timeout-ms": (value) => {
        blobTimeoutMs = readPositiveInt(value, "--blob-timeout-ms");
      },
      "--max-files": (value) => {
        maxFiles = readPositiveInt(value, "--max-files");
      },
      "--max-output-bytes": (value) => {
        maxOutputBytes = readPositiveInt(value, "--max-output-bytes");
      },
      "--timeout-ms": (value) => {
        timeoutMs = readPositiveInt(value, "--timeout-ms");
      },
    },
  });
  return {
    base,
    top,
    since,
    maxCommits,
    maxFiles,
    maxOutputBytes,
    timeoutMs,
    maxBlobReads,
    maxBlobBytes,
    blobTimeoutMs,
  };
}
