import { z } from "zod";

import { positiveIntValue } from "./arg-readers.js";
import {
  BOUNDED_HISTORY_CLI_OPTIONS,
  boundedHistoryArgsFromOptions,
  boundedHistorySchemaShape,
} from "./bounded-history-options.js";
import { DriftAiError } from "./errors.js";
import {
  CONFIG_CLI_OPTION,
  configSchemaShape,
  parseSubcommandCli,
  SUBCOMMAND_BASE_CLI_OPTIONS,
  subcommandBaseFromOptions,
  type SubcommandBaseOptions,
  subcommandBaseSchemaShape,
} from "./subcommand-args.js";
import {
  DEFAULT_MIN_SOURCE_COMMITS,
  DEFAULT_TEST_MAPPING_PATTERNS,
  DEFAULT_TEST_ORPHANING_TOP,
  TEST_ORPHANING_SUBCOMMAND,
} from "./test-orphaning-types.js";

const TEST_ORPHANING_USAGE = [
  "Usage:",
  `  bun run drift:ai ${TEST_ORPHANING_SUBCOMMAND}`,
  `  bun run drift:ai ${TEST_ORPHANING_SUBCOMMAND} --top <N>`,
  `  bun run drift:ai ${TEST_ORPHANING_SUBCOMMAND} --min-source-commits <N>`,
  `  bun run drift:ai ${TEST_ORPHANING_SUBCOMMAND} --test-pattern '{dir}/{name}.test{ext}'`,
  `  bun run drift:ai ${TEST_ORPHANING_SUBCOMMAND} --since <git-date>`,
  `  bun run drift:ai ${TEST_ORPHANING_SUBCOMMAND} --max-commits <N> --max-files <N>`,
  `  bun run drift:ai ${TEST_ORPHANING_SUBCOMMAND} --max-output-bytes <N> --timeout-ms <N>`,
  `  bun run drift:ai ${TEST_ORPHANING_SUBCOMMAND} --config <path>`,
  `  bun run drift:ai ${TEST_ORPHANING_SUBCOMMAND} --format <text|json> [--output <path>]`,
  "",
  "Report-only prototype advisory (exit 0). Source/test orphaning leads from bounded",
  "full git history: source files that churned without their inferred tests moving with",
  "them. Not findings, defects, or a default --check all surface.",
  "",
  "--test-pattern adds a source->test mapping template ({dir}, {name}, {ext}); supplied",
  "patterns are appended to the sibling and __tests__ defaults.",
].join("\n");

export type ParsedTestOrphaningArgs = {
  readonly base: SubcommandBaseOptions;
  readonly top: number;
  readonly minSourceCommits: number;
  readonly mappingPatterns: readonly string[];
  readonly since: string | null;
  readonly maxCommits: number | null;
  readonly maxFiles: number | null;
  readonly maxOutputBytes: number | null;
  readonly timeoutMs: number | null;
};

const CLI_OPTIONS = [
  ...SUBCOMMAND_BASE_CLI_OPTIONS,
  CONFIG_CLI_OPTION,
  { name: "--top", kind: "value" },
  { name: "--min-source-commits", kind: "value" },
  { name: "--test-pattern", kind: "value", repeatable: true },
  ...BOUNDED_HISTORY_CLI_OPTIONS,
] as const;

const cliOptionsSchema = z.object({
  ...subcommandBaseSchemaShape,
  ...configSchemaShape,
  "--top": positiveIntValue("--top").default(DEFAULT_TEST_ORPHANING_TOP),
  "--min-source-commits": positiveIntValue("--min-source-commits").default(
    DEFAULT_MIN_SOURCE_COMMITS,
  ),
  "--test-pattern": z
    .array(z.string().transform((value) => parseTemplate(value, "--test-pattern")))
    .default([]),
  ...boundedHistorySchemaShape,
});

export function parseTestOrphaningArgs(argv: readonly string[]): ParsedTestOrphaningArgs {
  const { options } = parseSubcommandCli({
    argv,
    usage: TEST_ORPHANING_USAGE,
    options: CLI_OPTIONS,
    schema: cliOptionsSchema,
  });
  const extraPatterns = options["--test-pattern"];
  return {
    base: subcommandBaseFromOptions(options),
    top: options["--top"],
    minSourceCommits: options["--min-source-commits"],
    mappingPatterns:
      extraPatterns.length === 0
        ? DEFAULT_TEST_MAPPING_PATTERNS
        : [...DEFAULT_TEST_MAPPING_PATTERNS, ...extraPatterns],
    ...boundedHistoryArgsFromOptions(options),
  };
}

// A mapping template must place the source basename via {name}; without it the
// candidate path cannot vary per source and the pattern is meaningless.
function parseTemplate(value: string, flag: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new DriftAiError(`${flag} requires a non-empty template.`);
  if (!trimmed.includes("{name}")) {
    throw new DriftAiError(
      `${flag} template must include the {name} placeholder (got '${value}').`,
    );
  }
  return trimmed;
}
