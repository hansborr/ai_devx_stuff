import { z } from "zod";

import { nonEmptyPathValue, positiveIntValue } from "./arg-readers.js";
import {
  COVERAGE_UNUSED_SUBCOMMAND,
  DEFAULT_COVERAGE_UNUSED_TOP,
} from "./coverage-unused-correlation-advisory.js";
import {
  CONFIG_CLI_OPTION,
  configSchemaShape,
  parseSubcommandCli,
  SUBCOMMAND_BASE_CLI_OPTIONS,
  subcommandBaseFromOptions,
  type SubcommandBaseOptions,
  subcommandBaseSchemaShape,
} from "./subcommand-args.js";

const COVERAGE_UNUSED_USAGE = [
  "Usage:",
  `  bun run drift:ai ${COVERAGE_UNUSED_SUBCOMMAND} --unused-exports-report <knip.json>`,
  `  bun run drift:ai ${COVERAGE_UNUSED_SUBCOMMAND} --config <path> --unused-exports-report <knip.json>`,
  `  bun run drift:ai ${COVERAGE_UNUSED_SUBCOMMAND} --top <N>`,
  `  bun run drift:ai ${COVERAGE_UNUSED_SUBCOMMAND} --format <text|json> [--output <path>]`,
  "",
  "Report-only prototype advisory (exit 0). Overlays a supplied knip unused-exports",
  "report (--reporter json) onto configured coverage.artifacts and reports where the",
  "two signals agree, conflict, or have no coverage. Never runs tests, knip, or a",
  "coverage gate; keeps 'uncovered' and 'unused' as separate signals, not a verdict.",
].join("\n");

export type ParsedCoverageUnusedArgs = {
  readonly base: SubcommandBaseOptions;
  readonly top: number;
  readonly reportPath: string | null;
};

const CLI_OPTIONS = [
  ...SUBCOMMAND_BASE_CLI_OPTIONS,
  CONFIG_CLI_OPTION,
  { name: "--top", kind: "value" },
  { name: "--unused-exports-report", kind: "value" },
] as const;

const cliOptionsSchema = z.object({
  ...subcommandBaseSchemaShape,
  ...configSchemaShape,
  "--top": positiveIntValue("--top").default(DEFAULT_COVERAGE_UNUSED_TOP),
  "--unused-exports-report": nonEmptyPathValue("--unused-exports-report").optional(),
});

export function parseCoverageUnusedArgs(argv: readonly string[]): ParsedCoverageUnusedArgs {
  const { options } = parseSubcommandCli({
    argv,
    usage: COVERAGE_UNUSED_USAGE,
    options: CLI_OPTIONS,
    schema: cliOptionsSchema,
  });
  return {
    base: subcommandBaseFromOptions(options),
    top: options["--top"],
    reportPath: options["--unused-exports-report"] ?? null,
  };
}
