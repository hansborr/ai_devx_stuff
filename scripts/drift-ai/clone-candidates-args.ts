import { z } from "zod";

import { positiveIntValue, ratioValue } from "./arg-readers.js";
import {
  CLONE_CANDIDATES_SUBCOMMAND,
  DEFAULT_CLONE_CANDIDATES_TOP,
} from "./clone-candidates-advisory.js";
import type { MinHashConfig } from "./minhash-lsh.js";
import {
  CONFIG_CLI_OPTION,
  configSchemaShape,
  parseSubcommandCli,
  SUBCOMMAND_BASE_CLI_OPTIONS,
  subcommandBaseFromOptions,
  type SubcommandBaseOptions,
  subcommandBaseSchemaShape,
} from "./subcommand-args.js";

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

const CLI_OPTIONS = [
  ...SUBCOMMAND_BASE_CLI_OPTIONS,
  CONFIG_CLI_OPTION,
  { name: "--root", kind: "value", repeatable: true },
  { name: "--top", kind: "value" },
  { name: "--min-lines", kind: "value" },
  { name: "--min-tokens", kind: "value" },
  { name: "--similarity-threshold", kind: "value" },
  { name: "--max-functions", kind: "value" },
  { name: "--max-candidate-pairs", kind: "value" },
  { name: "--max-shingles-per-function", kind: "value" },
  { name: "--shingle-size", kind: "value" },
  { name: "--lsh-bands", kind: "value" },
  { name: "--lsh-rows-per-band", kind: "value" },
] as const;

const cliOptionsSchema = z.object({
  ...subcommandBaseSchemaShape,
  ...configSchemaShape,
  "--root": z.array(z.string()).default([]),
  "--top": positiveIntValue("--top").default(DEFAULT_CLONE_CANDIDATES_TOP),
  "--min-lines": positiveIntValue("--min-lines").optional(),
  "--min-tokens": positiveIntValue("--min-tokens").optional(),
  "--similarity-threshold": ratioValue("--similarity-threshold").optional(),
  "--max-functions": positiveIntValue("--max-functions").optional(),
  "--max-candidate-pairs": positiveIntValue("--max-candidate-pairs").optional(),
  "--max-shingles-per-function": positiveIntValue("--max-shingles-per-function").optional(),
  "--shingle-size": positiveIntValue("--shingle-size").optional(),
  "--lsh-bands": positiveIntValue("--lsh-bands").optional(),
  "--lsh-rows-per-band": positiveIntValue("--lsh-rows-per-band").optional(),
});

type ParsedCloneCandidatesOptions = z.output<typeof cliOptionsSchema>;

// Hand-written assembly of the MinHash override subset: only flags the user
// passed land in the partial config (absent keys keep engine defaults).
function minhashOverrides(options: ParsedCloneCandidatesOptions): Partial<MinHashConfig> {
  const maxCandidatePairs = options["--max-candidate-pairs"];
  const maxShinglesPerDocument = options["--max-shingles-per-function"];
  const shingleSize = options["--shingle-size"];
  const bands = options["--lsh-bands"];
  const rowsPerBand = options["--lsh-rows-per-band"];
  return {
    ...(maxCandidatePairs === undefined ? {} : { maxCandidatePairs }),
    ...(maxShinglesPerDocument === undefined ? {} : { maxShinglesPerDocument }),
    ...(shingleSize === undefined ? {} : { shingleSize }),
    ...(bands === undefined ? {} : { bands }),
    ...(rowsPerBand === undefined ? {} : { rowsPerBand }),
  };
}

export function parseCloneCandidatesArgs(argv: readonly string[]): ParsedCloneCandidatesArgs {
  const { options } = parseSubcommandCli({
    argv,
    usage: CLONE_CANDIDATES_USAGE,
    options: CLI_OPTIONS,
    schema: cliOptionsSchema,
  });
  return {
    base: subcommandBaseFromOptions(options),
    roots: options["--root"],
    top: options["--top"],
    minLines: options["--min-lines"] ?? null,
    minTokens: options["--min-tokens"] ?? null,
    similarityThreshold: options["--similarity-threshold"] ?? null,
    maxFunctions: options["--max-functions"] ?? null,
    minhash: minhashOverrides(options),
  };
}
