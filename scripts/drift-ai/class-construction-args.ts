import { z } from "zod";

import { nonEmptyPathValue, positiveIntValue } from "./arg-readers.js";
import {
  CLASS_CONSTRUCTION_SUBCOMMAND,
  DEFAULT_CLASS_CONSTRUCTION_TOP,
} from "./class-construction-advisory.js";
import {
  CONFIG_CLI_OPTION,
  configSchemaShape,
  parseSubcommandCli,
  SUBCOMMAND_BASE_CLI_OPTIONS,
  subcommandBaseFromOptions,
  type SubcommandBaseOptions,
  subcommandBaseSchemaShape,
} from "./subcommand-args.js";

const CLASS_CONSTRUCTION_USAGE = [
  "Usage:",
  `  bun run drift:ai ${CLASS_CONSTRUCTION_SUBCOMMAND} --root <path>`,
  `  bun run drift:ai ${CLASS_CONSTRUCTION_SUBCOMMAND} --top <N>`,
  `  bun run drift:ai ${CLASS_CONSTRUCTION_SUBCOMMAND} --unused-exports-report <path>`,
  `  bun run drift:ai ${CLASS_CONSTRUCTION_SUBCOMMAND} --config <path>`,
  `  bun run drift:ai ${CLASS_CONSTRUCTION_SUBCOMMAND} --format <text|json> [--output <path>]`,
  "",
  "Report-only prototype advisory (exit 0). Experimental class-construction",
  "evidence for classes with no direct construction signal; not findings, defects,",
  "or a default --check all surface.",
].join("\n");

export type ParsedClassConstructionArgs = {
  readonly base: SubcommandBaseOptions;
  readonly roots: readonly string[];
  readonly top: number;
  readonly unusedExportsReportPath: string | null;
};

const CLI_OPTIONS = [
  ...SUBCOMMAND_BASE_CLI_OPTIONS,
  CONFIG_CLI_OPTION,
  { name: "--root", kind: "value", repeatable: true },
  { name: "--top", kind: "value" },
  { name: "--unused-exports-report", kind: "value" },
] as const;

const cliOptionsSchema = z.object({
  ...subcommandBaseSchemaShape,
  ...configSchemaShape,
  "--root": z.array(z.string()).default([]),
  "--top": positiveIntValue("--top").default(DEFAULT_CLASS_CONSTRUCTION_TOP),
  "--unused-exports-report": nonEmptyPathValue("--unused-exports-report").optional(),
});

export function parseClassConstructionArgs(argv: readonly string[]): ParsedClassConstructionArgs {
  const { options } = parseSubcommandCli({
    argv,
    usage: CLASS_CONSTRUCTION_USAGE,
    options: CLI_OPTIONS,
    schema: cliOptionsSchema,
  });
  return {
    base: subcommandBaseFromOptions(options),
    roots: options["--root"],
    top: options["--top"],
    unusedExportsReportPath: options["--unused-exports-report"] ?? null,
  };
}
