import { z } from "zod";

import { positiveIntValue } from "./arg-readers.js";
import {
  BOUNDED_HISTORY_CLI_OPTIONS,
  boundedHistoryArgsFromOptions,
  boundedHistorySchemaShape,
} from "./bounded-history-options.js";
import { DriftAiError } from "./errors.js";
import {
  DEFAULT_AGENT_IDENTITY_PATTERNS,
  DEFAULT_OWNERSHIP_TOP,
  OWNERSHIP_SUBCOMMAND,
} from "./ownership-advisory.js";
import {
  CONFIG_CLI_OPTION,
  configSchemaShape,
  parseSubcommandCli,
  SUBCOMMAND_BASE_CLI_OPTIONS,
  subcommandBaseFromOptions,
  type SubcommandBaseOptions,
  subcommandBaseSchemaShape,
} from "./subcommand-args.js";

const OWNERSHIP_USAGE = [
  "Usage:",
  `  bun run drift:ai ${OWNERSHIP_SUBCOMMAND}`,
  `  bun run drift:ai ${OWNERSHIP_SUBCOMMAND} --top <N>`,
  `  bun run drift:ai ${OWNERSHIP_SUBCOMMAND} --since <git-date>`,
  `  bun run drift:ai ${OWNERSHIP_SUBCOMMAND} --max-commits <N> --max-files <N>`,
  `  bun run drift:ai ${OWNERSHIP_SUBCOMMAND} --max-output-bytes <N> --timeout-ms <N>`,
  `  bun run drift:ai ${OWNERSHIP_SUBCOMMAND} --agent-identity-pattern <regex>`,
  `  bun run drift:ai ${OWNERSHIP_SUBCOMMAND} --config <path>`,
  `  bun run drift:ai ${OWNERSHIP_SUBCOMMAND} --format <text|json> [--output <path>]`,
  "",
  "Report-only prototype advisory (exit 0). File-level ownership / DOA archaeology",
  "from bounded full git history; not findings, defects, or a default --check all surface.",
].join("\n");

export type ParsedOwnershipArgs = {
  readonly base: SubcommandBaseOptions;
  readonly top: number;
  readonly since: string | null;
  readonly maxCommits: number | null;
  readonly maxFiles: number | null;
  readonly maxOutputBytes: number | null;
  readonly timeoutMs: number | null;
  readonly agentIdentityPatterns: readonly string[];
};

const CLI_OPTIONS = [
  ...SUBCOMMAND_BASE_CLI_OPTIONS,
  CONFIG_CLI_OPTION,
  { name: "--top", kind: "value" },
  ...BOUNDED_HISTORY_CLI_OPTIONS,
  { name: "--agent-identity-pattern", kind: "value", repeatable: true },
] as const;

const cliOptionsSchema = z.object({
  ...subcommandBaseSchemaShape,
  ...configSchemaShape,
  "--top": positiveIntValue("--top").default(DEFAULT_OWNERSHIP_TOP),
  ...boundedHistorySchemaShape,
  "--agent-identity-pattern": z
    .array(z.string().transform((value) => parseRegexPattern(value, "--agent-identity-pattern")))
    .default([]),
});

export function parseOwnershipArgs(argv: readonly string[]): ParsedOwnershipArgs {
  const { options } = parseSubcommandCli({
    argv,
    usage: OWNERSHIP_USAGE,
    options: CLI_OPTIONS,
    schema: cliOptionsSchema,
  });
  const extraAgentPatterns = options["--agent-identity-pattern"];
  return {
    base: subcommandBaseFromOptions(options),
    top: options["--top"],
    ...boundedHistoryArgsFromOptions(options),
    agentIdentityPatterns:
      extraAgentPatterns.length === 0
        ? DEFAULT_AGENT_IDENTITY_PATTERNS
        : [...DEFAULT_AGENT_IDENTITY_PATTERNS, ...extraAgentPatterns],
  };
}

function parseRegexPattern(value: string, flag: string): string {
  try {
    new RegExp(value, "iu");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new DriftAiError(`${flag} must be a valid regular expression: ${detail}`);
  }
  return value;
}
