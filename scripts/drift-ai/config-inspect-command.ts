// CLI runner for the read-only `drift:ai config` inspection subcommand. It
// resolves the target repo root from the subprocess cwd (git `--show-toplevel`),
// loads the effective config exactly as a scan would, and renders it through the
// inspection model. It runs no checks and writes no config file: discovery is
// anchored to the target, never the tools checkout.

import { DriftAiHelp } from "./cli-args.js";
import { loadDriftAiConfig } from "./config.js";
import {
  buildConfigInspection,
  CONFIG_INSPECT_SUBCOMMAND,
  type ConfigInspection,
  formatConfigInspectionJson,
  formatConfigInspectionText,
} from "./config-inspect.js";
import { DriftAiError } from "./errors.js";
import { defaultGitRunner, type GitRunner, resolveRepoRoot } from "./git-changed-scope.js";
import { defaultReportWriter, type ReportWriter } from "./report-output.js";
import {
  parseSubcommandArgs,
  type SubcommandBaseOptions,
  writeSubcommandOutput,
} from "./subcommand-args.js";

export type ConfigInspectRunOptions = {
  readonly argv: readonly string[];
  readonly git?: GitRunner;
  readonly writer?: ReportWriter;
};

export type ConfigInspectRunResult = {
  readonly exitCode: number;
  readonly stdout: string;
};

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

export function runConfigInspect(options: ConfigInspectRunOptions): ConfigInspectRunResult {
  let parsed: SubcommandBaseOptions;
  try {
    parsed = parseSubcommandArgs(options.argv, {
      usage: CONFIG_INSPECT_USAGE,
      acceptsConfig: true,
    });
  } catch (err) {
    return toResult(err);
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
    return toResult(err);
  }
}

function render(inspection: ConfigInspection, format: SubcommandBaseOptions["format"]): string {
  return format === "json"
    ? formatConfigInspectionJson(inspection)
    : formatConfigInspectionText(inspection);
}

function toResult(err: unknown): ConfigInspectRunResult {
  if (err instanceof DriftAiHelp) return { exitCode: 0, stdout: err.message };
  if (err instanceof DriftAiError) return { exitCode: 2, stdout: err.message };
  throw err;
}
