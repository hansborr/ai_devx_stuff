// CLI runner for the read-only `drift:ai config` inspection subcommand. It
// resolves the target repo root from the subprocess cwd (git `--show-toplevel`),
// loads the effective config exactly as a scan would, and renders it through the
// inspection model. It runs no checks and writes no config file: discovery is
// anchored to the target, never the tools checkout.

import { z } from "zod";

import { type DriftAiCommandResult, sentinelToCommandResult } from "./command-result.js";
import { loadDriftAiConfig } from "./config.js";
import {
  buildConfigInspection,
  CONFIG_INSPECT_SUBCOMMAND,
  type ConfigInspection,
  formatConfigInspectionJson,
  formatConfigInspectionText,
} from "./config-inspect.js";
import { defaultGitRunner, type GitRunner, resolveRepoRoot } from "./git-changed-scope.js";
import { defaultReportWriter, type ReportWriter } from "./report-output.js";
import {
  CONFIG_CLI_OPTION,
  configSchemaShape,
  parseSubcommandCli,
  SUBCOMMAND_BASE_CLI_OPTIONS,
  subcommandBaseFromOptions,
  type SubcommandBaseOptions,
  subcommandBaseSchemaShape,
  writeSubcommandOutput,
} from "./subcommand-args.js";

export type ConfigInspectRunOptions = {
  readonly argv: readonly string[];
  readonly git?: GitRunner;
  readonly writer?: ReportWriter;
};

export type ConfigInspectRunResult = DriftAiCommandResult;

const CONFIG_INSPECT_USAGE = [
  "Usage:",
  `  bun run drift:ai ${CONFIG_INSPECT_SUBCOMMAND}`,
  `  bun run drift:ai ${CONFIG_INSPECT_SUBCOMMAND} --config <path>`,
  `  bun run drift:ai ${CONFIG_INSPECT_SUBCOMMAND} --format <text|json> [--output <path>]`,
  "",
  "Read-only. Shows the effective drift:ai config (source, repo root, roots,",
  "source extensions, default/implemented checks) for the target repo. It runs no",
  "checks and never writes or rewrites a config file.",
].join("\n");

const CLI_OPTIONS = [...SUBCOMMAND_BASE_CLI_OPTIONS, CONFIG_CLI_OPTION] as const;

const cliOptionsSchema = z.object({ ...subcommandBaseSchemaShape, ...configSchemaShape });

export function runConfigInspect(options: ConfigInspectRunOptions): ConfigInspectRunResult {
  let parsed: SubcommandBaseOptions;
  try {
    parsed = subcommandBaseFromOptions(
      parseSubcommandCli({
        argv: options.argv,
        usage: CONFIG_INSPECT_USAGE,
        options: CLI_OPTIONS,
        schema: cliOptionsSchema,
      }).options,
    );
  } catch (err) {
    return sentinelToCommandResult(err);
  }
  try {
    const git = options.git ?? defaultGitRunner();
    const repoRoot = resolveRepoRoot(git);
    const loaded = loadDriftAiConfig({
      repoRoot,
      ...(parsed.configPath === null ? {} : { configPath: parsed.configPath }),
    });
    const inspection = buildConfigInspection({
      repoRoot,
      config: loaded.config,
      explicitConfig: parsed.configPath !== null,
      loadedConfigPath: loaded.configPath,
    });
    const rendered = render(inspection, parsed.format);
    const writer = options.writer ?? defaultReportWriter;
    return { exitCode: 0, stdout: writeSubcommandOutput(parsed, rendered, writer) };
  } catch (err) {
    return sentinelToCommandResult(err);
  }
}

function render(inspection: ConfigInspection, format: SubcommandBaseOptions["format"]): string {
  return format === "json"
    ? formatConfigInspectionJson(inspection)
    : formatConfigInspectionText(inspection);
}
