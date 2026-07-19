import { DriftAiHelp } from "./cli-args.js";
import { type DriftAiConfig, loadDriftAiConfig } from "./config.js";
import { DriftAiError } from "./errors.js";
import { defaultGitRunner, type GitRunner, resolveRepoRoot } from "./git-changed-scope.js";
import { defaultReportWriter, type ReportWriter } from "./report-output.js";
import type { SubcommandBaseOptions, SubcommandFormat } from "./subcommand-args.js";
import { writeSubcommandOutput } from "./subcommand-args.js";
import { type CliOptions, DEFAULT_BASE } from "./types.js";

export type PrototypeCommandRunOptions = {
  readonly argv: readonly string[];
};

export type PrototypeCommandRunResult = {
  readonly exitCode: number;
  readonly stdout: string;
};

export type PrototypeCommandDescriptor<Options extends PrototypeCommandRunOptions, ParsedArgs> = {
  readonly parse: (argv: readonly string[]) => ParsedArgs;
  readonly run: (options: Options, parsed: ParsedArgs) => PrototypeCommandRunResult;
};

export type PrototypeParsedBase = {
  readonly base: SubcommandBaseOptions;
};

export type PrototypeCurrentRunArgs = PrototypeParsedBase & {
  readonly roots?: readonly string[];
};

export type PrototypeConfigContext = {
  readonly repoRoot: string;
  readonly config: DriftAiConfig;
  readonly configPath: string | null;
};

export type PrototypeAdvisoryFormatters<Advisory> = {
  readonly json: (advisory: Advisory) => string;
  readonly text: (advisory: Advisory) => string;
};

export function runPrototypeCommand<Options extends PrototypeCommandRunOptions, ParsedArgs>(
  options: Options,
  descriptor: PrototypeCommandDescriptor<Options, ParsedArgs>,
): PrototypeCommandRunResult {
  try {
    return descriptor.run(options, descriptor.parse(options.argv));
  } catch (err) {
    if (err instanceof DriftAiHelp) return { exitCode: 0, stdout: err.message };
    if (err instanceof DriftAiError) return { exitCode: 2, stdout: err.message };
    throw err;
  }
}

export function currentPrototypeCliOptions(parsed: PrototypeCurrentRunArgs): CliOptions {
  return {
    scopeMode: "current",
    base: DEFAULT_BASE,
    baseExplicit: false,
    checks: [],
    format: parsed.base.format,
    roots: parsed.roots ?? [],
    ...(parsed.base.configPath === null ? {} : { configPath: parsed.base.configPath }),
    includeScope: false,
    failOnFindings: false,
    failOnRuntimeCycles: false,
  };
}

export function resolvePrototypeConfig(
  options: { readonly git?: GitRunner },
  configPath: string | null,
): PrototypeConfigContext {
  const git = options.git ?? defaultGitRunner();
  const repoRoot = resolveRepoRoot(git);
  const loaded = loadDriftAiConfig({
    repoRoot,
    ...(configPath === null ? {} : { configPath }),
  });
  return { repoRoot, config: loaded.config, configPath: loaded.configPath };
}

export function renderPrototypeAdvisory<Advisory>(
  format: SubcommandFormat,
  advisory: Advisory,
  formatters: PrototypeAdvisoryFormatters<Advisory>,
): string {
  return format === "json" ? formatters.json(advisory) : formatters.text(advisory);
}

export function finishPrototypeCommand(
  parsed: PrototypeParsedBase,
  rendered: string,
  writer: ReportWriter = defaultReportWriter,
): PrototypeCommandRunResult {
  return { exitCode: 0, stdout: writeSubcommandOutput(parsed.base, rendered, writer) };
}
