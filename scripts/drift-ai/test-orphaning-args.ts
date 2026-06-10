import { readNonEmpty, readPositiveInt } from "./arg-readers.js";
import { DriftAiError } from "./errors.js";
import { parseSubcommandArgs, type SubcommandBaseOptions } from "./subcommand-args.js";
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

export function parseTestOrphaningArgs(argv: readonly string[]): ParsedTestOrphaningArgs {
  let top = DEFAULT_TEST_ORPHANING_TOP;
  let minSourceCommits = DEFAULT_MIN_SOURCE_COMMITS;
  let since: string | null = null;
  let maxCommits: number | null = null;
  let maxFiles: number | null = null;
  let maxOutputBytes: number | null = null;
  let timeoutMs: number | null = null;
  const extraPatterns: string[] = [];
  const base = parseSubcommandArgs(argv, {
    usage: TEST_ORPHANING_USAGE,
    acceptsConfig: true,
    valueOptions: {
      "--top": (value) => {
        top = readPositiveInt(value, "--top");
      },
      "--min-source-commits": (value) => {
        minSourceCommits = readPositiveInt(value, "--min-source-commits");
      },
      "--test-pattern": (value) => {
        extraPatterns.push(parseTemplate(value, "--test-pattern"));
      },
      "--since": (value) => {
        since = readNonEmpty(value, "--since");
      },
      "--max-commits": (value) => {
        maxCommits = readPositiveInt(value, "--max-commits");
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
    minSourceCommits,
    mappingPatterns:
      extraPatterns.length === 0
        ? DEFAULT_TEST_MAPPING_PATTERNS
        : [...DEFAULT_TEST_MAPPING_PATTERNS, ...extraPatterns],
    since,
    maxCommits,
    maxFiles,
    maxOutputBytes,
    timeoutMs,
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
