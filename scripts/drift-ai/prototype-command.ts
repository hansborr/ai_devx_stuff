import { captureGitStateFingerprint, gitRepoRootArgs, gitStatusPorcelainArgs } from "../lib/git.js";
import { DriftAiHelp } from "./cli-args.js";
import { type DriftAiConfig, loadDriftAiConfig } from "./config.js";
import { DriftAiError } from "./errors.js";
import { defaultGitRunner, type GitRunner, resolveRepoRoot } from "./git-changed-scope.js";
import type { PrototypeScanProvenance } from "./prototype-advisory.js";
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

export type PrototypeScanSnapshot = {
  readonly provenance: Pick<PrototypeScanProvenance, "gitHead" | "gitDirty" | "stateFingerprint">;
  readonly stateToken: string | null;
};

export function capturePrototypeScanSnapshot(
  injectedGit: GitRunner | undefined,
  repoRoot: string,
  excludedPaths: readonly string[],
): PrototypeScanSnapshot {
  const git = injectedGit ?? defaultGitRunner();
  const gitHead = runGitProbe(git, gitRepoRootArgs(repoRoot, ["rev-parse", "HEAD"]));
  const status = runGitProbe(
    git,
    gitRepoRootArgs(repoRoot, gitStatusPorcelainArgs(repoRoot, excludedPaths)),
  );
  const stateFingerprint = captureGitStateFingerprint(git, repoRoot, excludedPaths);
  const normalizedHead = gitHead === null || gitHead.length === 0 ? null : gitHead;
  const baseStateToken =
    normalizedHead === null || status === null ? null : `${normalizedHead}\0${status}`;
  return {
    provenance: {
      gitHead: normalizedHead,
      gitDirty: status === null ? null : status.length > 0,
      stateFingerprint,
    },
    stateToken:
      baseStateToken === null || stateFingerprint === null
        ? null
        : `${baseStateToken}\0${stateFingerprint}`,
  };
}

export function completedScanProvenance(
  before: PrototypeScanSnapshot,
  after: PrototypeScanSnapshot,
): PrototypeScanProvenance {
  return {
    ...before.provenance,
    changedDuringScan:
      before.stateToken === null || after.stateToken === null
        ? null
        : before.stateToken !== after.stateToken,
  };
}

function runGitProbe(git: GitRunner, args: readonly string[]): string | null {
  try {
    const output = git(args).trim();
    return output.length > 0 ? output : "";
  } catch {
    return null;
  }
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
