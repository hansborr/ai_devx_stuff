import { z } from "zod";

import { nonEmptyValue, positiveIntValue, ratioValue } from "./arg-readers.js";
import { DEFAULT_DOLOS_CANDIDATES_TOP, DOLOS_CANDIDATES_SUBCOMMAND } from "./dolos-advisory.js";
import {
  CONFIG_CLI_OPTION,
  configSchemaShape,
  parseSubcommandCli,
  SUBCOMMAND_BASE_CLI_OPTIONS,
  subcommandBaseFromOptions,
  type SubcommandBaseOptions,
  subcommandBaseSchemaShape,
} from "./subcommand-args.js";

// Dolos defaults. Threshold and language are Dolos' own scale (fragment-overlap
// similarity), deliberately NOT tied to the near-duplicates similarity threshold,
// which measures a different (ts-morph AST) signal. The cap defaults keep a
// foreign-repo run bounded; every cap is disclosed in the advisory header.
const DEFAULT_DOLOS_LANGUAGE = "typescript";
const DEFAULT_DOLOS_THRESHOLD = 0.3;
const DEFAULT_DOLOS_MAX_FILES = 2000;
const DEFAULT_DOLOS_MAX_CANDIDATE_PAIRS = 50_000;
const DEFAULT_DOLOS_MAX_REPORTED_PAIRS = 200;

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

const CLI_OPTIONS = [
  ...SUBCOMMAND_BASE_CLI_OPTIONS,
  CONFIG_CLI_OPTION,
  { name: "--root", kind: "value", repeatable: true },
  { name: "--top", kind: "value" },
  { name: "--language", kind: "value" },
  { name: "--threshold", kind: "value" },
  { name: "--max-files", kind: "value" },
  { name: "--max-candidate-pairs", kind: "value" },
  { name: "--max-reported-pairs", kind: "value" },
  { name: "--dolos-bin", kind: "value" },
] as const;

const cliOptionsSchema = z.object({
  ...subcommandBaseSchemaShape,
  ...configSchemaShape,
  "--root": z.array(z.string()).default([]),
  "--top": positiveIntValue("--top").default(DEFAULT_DOLOS_CANDIDATES_TOP),
  "--language": nonEmptyValue("--language").default(DEFAULT_DOLOS_LANGUAGE),
  "--threshold": ratioValue("--threshold").default(DEFAULT_DOLOS_THRESHOLD),
  "--max-files": positiveIntValue("--max-files").default(DEFAULT_DOLOS_MAX_FILES),
  "--max-candidate-pairs": positiveIntValue("--max-candidate-pairs").default(
    DEFAULT_DOLOS_MAX_CANDIDATE_PAIRS,
  ),
  "--max-reported-pairs": positiveIntValue("--max-reported-pairs").default(
    DEFAULT_DOLOS_MAX_REPORTED_PAIRS,
  ),
  "--dolos-bin": nonEmptyValue("--dolos-bin").optional(),
});

export function parseDolosCandidatesArgs(argv: readonly string[]): ParsedDolosCandidatesArgs {
  const { options } = parseSubcommandCli({
    argv,
    usage: DOLOS_CANDIDATES_USAGE,
    options: CLI_OPTIONS,
    schema: cliOptionsSchema,
  });
  return {
    base: subcommandBaseFromOptions(options),
    roots: options["--root"],
    top: options["--top"],
    languageMode: options["--language"],
    threshold: options["--threshold"],
    maxFiles: options["--max-files"],
    maxCandidatePairs: options["--max-candidate-pairs"],
    maxReportedPairs: options["--max-reported-pairs"],
    command: options["--dolos-bin"] ?? null,
  };
}
