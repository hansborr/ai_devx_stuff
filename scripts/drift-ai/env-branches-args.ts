import { z } from "zod";

import { positiveIntValue } from "./arg-readers.js";
import { DEFAULT_ENV_BRANCHES_TOP, ENV_BRANCHES_SUBCOMMAND } from "./env-branches-advisory.js";
import {
  CONFIG_CLI_OPTION,
  configSchemaShape,
  parseSubcommandCli,
  SUBCOMMAND_BASE_CLI_OPTIONS,
  subcommandBaseFromOptions,
  type SubcommandBaseOptions,
  subcommandBaseSchemaShape,
} from "./subcommand-args.js";

const ENV_BRANCHES_USAGE = [
  "Usage:",
  `  bun run drift:ai ${ENV_BRANCHES_SUBCOMMAND} --config <path>`,
  `  bun run drift:ai ${ENV_BRANCHES_SUBCOMMAND} --top <N>`,
  `  bun run drift:ai ${ENV_BRANCHES_SUBCOMMAND} --format <text|json> [--output <path>]`,
  "",
  "Report-only prototype advisory (exit 0). Reads the configured envDefine matrix and",
  "predicts which env/define guard conditions fold to a constant branch; not findings",
  "or gates. With no envDefine config the matrix prerequisite is disclosed as unmet.",
].join("\n");

export type ParsedEnvBranchesArgs = {
  readonly base: SubcommandBaseOptions;
  readonly top: number;
};

const CLI_OPTIONS = [
  ...SUBCOMMAND_BASE_CLI_OPTIONS,
  CONFIG_CLI_OPTION,
  { name: "--top", kind: "value" },
] as const;

const cliOptionsSchema = z.object({
  ...subcommandBaseSchemaShape,
  ...configSchemaShape,
  "--top": positiveIntValue("--top").default(DEFAULT_ENV_BRANCHES_TOP),
});

export function parseEnvBranchesArgs(argv: readonly string[]): ParsedEnvBranchesArgs {
  const { options } = parseSubcommandCli({
    argv,
    usage: ENV_BRANCHES_USAGE,
    options: CLI_OPTIONS,
    schema: cliOptionsSchema,
  });
  return { base: subcommandBaseFromOptions(options), top: options["--top"] };
}
