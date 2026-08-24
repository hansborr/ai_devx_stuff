import { z } from "zod";

import { positiveIntValue } from "./arg-readers.js";
import {
  COVERAGE_EVIDENCE_SUBCOMMAND,
  DEFAULT_COVERAGE_EVIDENCE_TOP,
} from "./coverage-evidence-advisory.js";
import {
  CONFIG_CLI_OPTION,
  configSchemaShape,
  parseSubcommandCli,
  SUBCOMMAND_BASE_CLI_OPTIONS,
  subcommandBaseFromOptions,
  type SubcommandBaseOptions,
  subcommandBaseSchemaShape,
} from "./subcommand-args.js";

const COVERAGE_EVIDENCE_USAGE = [
  "Usage:",
  `  bun run drift:ai ${COVERAGE_EVIDENCE_SUBCOMMAND} --config <path>`,
  `  bun run drift:ai ${COVERAGE_EVIDENCE_SUBCOMMAND} --top <N>`,
  `  bun run drift:ai ${COVERAGE_EVIDENCE_SUBCOMMAND} --format <text|json> [--output <path>]`,
  "",
  "Report-only prototype advisory (exit 0). Reads configured coverage artifacts",
  "from coverage.artifacts and reports raw hit evidence; not findings or gates.",
].join("\n");

export type ParsedCoverageEvidenceArgs = {
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
  "--top": positiveIntValue("--top").default(DEFAULT_COVERAGE_EVIDENCE_TOP),
});

export function parseCoverageEvidenceArgs(argv: readonly string[]): ParsedCoverageEvidenceArgs {
  const { options } = parseSubcommandCli({
    argv,
    usage: COVERAGE_EVIDENCE_USAGE,
    options: CLI_OPTIONS,
    schema: cliOptionsSchema,
  });
  return { base: subcommandBaseFromOptions(options), top: options["--top"] };
}
