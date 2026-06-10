import { readNonEmpty, readPositiveInt, readRatio } from "./arg-readers.js";
import { DEFAULT_DOLOS_CANDIDATES_TOP, DOLOS_CANDIDATES_SUBCOMMAND } from "./dolos-advisory.js";
import { parseSubcommandArgs, type SubcommandBaseOptions } from "./subcommand-args.js";

// Dolos defaults. Threshold and language are Dolos' own scale (fragment-overlap
// similarity), deliberately NOT tied to the near-duplicates similarity threshold,
// which measures a different (ts-morph AST) signal. The cap defaults keep a
// foreign-repo run bounded; every cap is disclosed in the advisory header.
export const DEFAULT_DOLOS_LANGUAGE = "typescript";
export const DEFAULT_DOLOS_THRESHOLD = 0.3;
export const DEFAULT_DOLOS_MAX_FILES = 2000;
export const DEFAULT_DOLOS_MAX_CANDIDATE_PAIRS = 50_000;
export const DEFAULT_DOLOS_MAX_REPORTED_PAIRS = 200;

const DOLOS_CANDIDATES_USAGE = [
  "Usage:",
  `  bun run drift:ai ${DOLOS_CANDIDATES_SUBCOMMAND} --root <path>`,
  `  bun run drift:ai ${DOLOS_CANDIDATES_SUBCOMMAND} --top <N>`,
  `  bun run drift:ai ${DOLOS_CANDIDATES_SUBCOMMAND} --language <mode> --threshold <ratio>`,
  `  bun run drift:ai ${DOLOS_CANDIDATES_SUBCOMMAND} --max-files <N> --max-candidate-pairs <N> --max-reported-pairs <N>`,
  `  bun run drift:ai ${DOLOS_CANDIDATES_SUBCOMMAND} --dolos-bin <path>`,
  `  bun run drift:ai ${DOLOS_CANDIDATES_SUBCOMMAND} --format <text|json> [--output <path>]`,
  `  bun run drift:ai ${DOLOS_CANDIDATES_SUBCOMMAND} --config <path>`,
  "",
  "Report-only prototype advisory (exit 0). Experimental Dolos fragment-level clone",
  "candidates; not findings, defects, or a default --check all surface. Dolos is",
  "opt-in: a missing binary is reported as an unmet prerequisite, not a failure.",
].join("\n");

export type ParsedDolosCandidatesArgs = {
  readonly base: SubcommandBaseOptions;
  readonly roots: readonly string[];
  readonly top: number;
  readonly languageMode: string;
  readonly threshold: number;
  readonly maxFiles: number;
  readonly maxCandidatePairs: number;
  readonly maxReportedPairs: number;
  readonly command: string | null;
};

export function parseDolosCandidatesArgs(argv: readonly string[]): ParsedDolosCandidatesArgs {
  const roots: string[] = [];
  let top = DEFAULT_DOLOS_CANDIDATES_TOP;
  let languageMode = DEFAULT_DOLOS_LANGUAGE;
  let threshold = DEFAULT_DOLOS_THRESHOLD;
  let maxFiles = DEFAULT_DOLOS_MAX_FILES;
  let maxCandidatePairs = DEFAULT_DOLOS_MAX_CANDIDATE_PAIRS;
  let maxReportedPairs = DEFAULT_DOLOS_MAX_REPORTED_PAIRS;
  let command: string | null = null;
  const base = parseSubcommandArgs(argv, {
    usage: DOLOS_CANDIDATES_USAGE,
    acceptsConfig: true,
    pathValueOptions: {
      "--root": (value) => {
        roots.push(value);
      },
    },
    valueOptions: {
      "--top": (value) => {
        top = readPositiveInt(value, "--top");
      },
      "--language": (value) => {
        languageMode = readNonEmpty(value, "--language");
      },
      "--threshold": (value) => {
        threshold = readRatio(value, "--threshold");
      },
      "--max-files": (value) => {
        maxFiles = readPositiveInt(value, "--max-files");
      },
      "--max-candidate-pairs": (value) => {
        maxCandidatePairs = readPositiveInt(value, "--max-candidate-pairs");
      },
      "--max-reported-pairs": (value) => {
        maxReportedPairs = readPositiveInt(value, "--max-reported-pairs");
      },
      "--dolos-bin": (value) => {
        command = readNonEmpty(value, "--dolos-bin");
      },
    },
  });
  return {
    base,
    roots,
    top,
    languageMode,
    threshold,
    maxFiles,
    maxCandidatePairs,
    maxReportedPairs,
    command,
  };
}
