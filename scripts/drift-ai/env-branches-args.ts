import { readPositiveInt } from "./arg-readers.js";
import { DEFAULT_ENV_BRANCHES_TOP, ENV_BRANCHES_SUBCOMMAND } from "./env-branches-advisory.js";
import { parseSubcommandArgs, type SubcommandBaseOptions } from "./subcommand-args.js";

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

export function parseEnvBranchesArgs(argv: readonly string[]): ParsedEnvBranchesArgs {
  let top = DEFAULT_ENV_BRANCHES_TOP;
  const base = parseSubcommandArgs(argv, {
    usage: ENV_BRANCHES_USAGE,
    acceptsConfig: true,
    valueOptions: {
      "--top": (value) => {
        top = readPositiveInt(value, "--top");
      },
    },
  });
  return { base, top };
}
