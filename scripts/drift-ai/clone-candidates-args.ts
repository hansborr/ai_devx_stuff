import { readPositiveInt, readRatio } from "./arg-readers.js";
import {
  CLONE_CANDIDATES_SUBCOMMAND,
  DEFAULT_CLONE_CANDIDATES_TOP,
} from "./clone-candidates-advisory.js";
import type { MinHashConfig } from "./minhash-lsh.js";
import { parseSubcommandArgs, type SubcommandBaseOptions } from "./subcommand-args.js";

const CLONE_CANDIDATES_USAGE = [
  "Usage:",
  `  bun run drift:ai ${CLONE_CANDIDATES_SUBCOMMAND} --root <path>`,
  `  bun run drift:ai ${CLONE_CANDIDATES_SUBCOMMAND} --top <N>`,
  `  bun run drift:ai ${CLONE_CANDIDATES_SUBCOMMAND} --min-lines <N> --min-tokens <N>`,
  `  bun run drift:ai ${CLONE_CANDIDATES_SUBCOMMAND} --similarity-threshold <ratio>`,
  `  bun run drift:ai ${CLONE_CANDIDATES_SUBCOMMAND} --max-functions <N> --max-candidate-pairs <N>`,
  `  bun run drift:ai ${CLONE_CANDIDATES_SUBCOMMAND} --format <text|json> [--output <path>]`,
  `  bun run drift:ai ${CLONE_CANDIDATES_SUBCOMMAND} --config <path>`,
  "",
  "Report-only prototype advisory (exit 0). Experimental MinHash/LSH function",
  "clone candidates; not findings, defects, or a default --check all surface.",
].join("\n");

export type ParsedCloneCandidatesArgs = {
  readonly base: SubcommandBaseOptions;
  readonly roots: readonly string[];
  readonly top: number;
  readonly minLines: number | null;
  readonly minTokens: number | null;
  readonly similarityThreshold: number | null;
  readonly maxFunctions: number | null;
  readonly minhash: Partial<MinHashConfig>;
};

type MutableMinHashConfig = {
  -readonly [K in keyof MinHashConfig]?: MinHashConfig[K];
};

export function parseCloneCandidatesArgs(argv: readonly string[]): ParsedCloneCandidatesArgs {
  const roots: string[] = [];
  let top = DEFAULT_CLONE_CANDIDATES_TOP;
  let minLines: number | null = null;
  let minTokens: number | null = null;
  let similarityThreshold: number | null = null;
  let maxFunctions: number | null = null;
  const minhash: MutableMinHashConfig = {};
  const base = parseSubcommandArgs(argv, {
    usage: CLONE_CANDIDATES_USAGE,
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
      "--min-lines": (value) => {
        minLines = readPositiveInt(value, "--min-lines");
      },
      "--min-tokens": (value) => {
        minTokens = readPositiveInt(value, "--min-tokens");
      },
      "--similarity-threshold": (value) => {
        similarityThreshold = readRatio(value, "--similarity-threshold");
      },
      "--max-functions": (value) => {
        maxFunctions = readPositiveInt(value, "--max-functions");
      },
      "--max-candidate-pairs": (value) => {
        minhash.maxCandidatePairs = readPositiveInt(value, "--max-candidate-pairs");
      },
      "--max-shingles-per-function": (value) => {
        minhash.maxShinglesPerDocument = readPositiveInt(value, "--max-shingles-per-function");
      },
      "--shingle-size": (value) => {
        minhash.shingleSize = readPositiveInt(value, "--shingle-size");
      },
      "--lsh-bands": (value) => {
        minhash.bands = readPositiveInt(value, "--lsh-bands");
      },
      "--lsh-rows-per-band": (value) => {
        minhash.rowsPerBand = readPositiveInt(value, "--lsh-rows-per-band");
      },
    },
  });
  return { base, roots, top, minLines, minTokens, similarityThreshold, maxFunctions, minhash };
}
