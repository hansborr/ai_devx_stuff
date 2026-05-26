import { DriftAiHelp, parseArgs } from "./cli-args.js";
import { defaultFileReader, type FileReader } from "./comments.js";
import { type BufferGitRunner, type StatRunner } from "./current-inventory.js";
import { defaultJscpdRunner, JSCPD_SUPPORTED_EXTENSIONS, type JscpdRunner } from "./duplicates.js";
import { DriftAiError } from "./errors.js";
import { defaultDirectoryListing, type DirectoryListing } from "./ghost-files.js";
import { defaultGitRunner, type GitRunner, resolveRepoRoot } from "./git-changed-scope.js";
import { formatHarnessFreshnessText, runHarnessFreshnessCheck } from "./harness-freshness.js";
import {
  optionsForReport,
  prepareChangedRun,
  prepareCurrentRun,
  type PreparedRun,
} from "./prepare-run.js";
import { buildReport, type CheckContext } from "./report-builder.js";
import { formatJson, formatText } from "./report-format.js";
import { defaultReportWriter, type ReportWriter, writeReportOutputs } from "./report-output.js";
import { defaultSuppressionsGitRunner, type SuppressionsGitRunner } from "./suppressions.js";
import type { CliOptions, DriftCheckId, DriftReport } from "./types.js";

export type RunOptions = {
  readonly argv: readonly string[];
  readonly git?: GitRunner;
  readonly gitBuffer?: BufferGitRunner;
  readonly stat?: StatRunner;
  readonly rootExists?: (absolutePath: string) => boolean;
  readonly jscpd?: JscpdRunner;
  readonly listDirectory?: DirectoryListing;
  readonly readFile?: FileReader;
  readonly suppressionsGit?: SuppressionsGitRunner;
  readonly warnStderr?: (message: string) => void;
  readonly writer?: (path: string, contents: string) => void;
};

export type RunResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly report?: DriftReport;
};

function resolveRunContext(
  prepared: PreparedRun,
  options: RunOptions,
): {
  readonly checkContext: CheckContext;
  readonly warnStderr: (message: string) => void;
  readonly writer: ReportWriter;
} {
  const jscpd = options.jscpd ?? defaultJscpdRunner({ repoRoot: prepared.repoRoot });
  const listDirectory = options.listDirectory ?? defaultDirectoryListing(prepared.repoRoot);
  const readFile = options.readFile ?? defaultFileReader(prepared.repoRoot);
  const suppressionsGit =
    options.suppressionsGit ??
    (options.git === undefined
      ? defaultSuppressionsGitRunner
      : suppressionsGitRunnerFromStringGit(options.git));
  const warnStderr = options.warnStderr ?? defaultWarnStderr;
  const writer = options.writer ?? defaultReportWriter;
  return {
    checkContext: {
      detectorScope: prepared.detectorScope,
      jscpd,
      listDirectory,
      ...(prepared.inventoryByDir === undefined ? {} : { inventoryByDir: prepared.inventoryByDir }),
      readFile,
      suppressionsGit,
      repoRoot: prepared.repoRoot,
      ...(prepared.suppressionDiffRef === null
        ? {}
        : { suppressionDiffRef: prepared.suppressionDiffRef }),
      config: prepared.config,
      roots: prepared.roots,
      sourceExtensions: prepared.sourceExtensions,
      warnStderr,
    },
    warnStderr,
    writer,
  };
}

export function runDriftAi(options: RunOptions): RunResult {
  if (options.argv[0] === "harness-freshness") {
    return runHarnessFreshnessSubcommand(options);
  }

  let parsed: CliOptions;
  try {
    parsed = parseArgs(options.argv);
  } catch (err) {
    if (err instanceof DriftAiHelp) return { exitCode: 0, stdout: err.message };
    if (err instanceof DriftAiError) return { exitCode: 2, stdout: err.message };
    throw err;
  }

  let prepared: PreparedRun;
  try {
    prepared =
      parsed.scopeMode === "current"
        ? prepareCurrentRun(parsed, options)
        : prepareChangedRun(parsed, options);
  } catch (err) {
    if (err instanceof DriftAiError) return { exitCode: 2, stdout: err.message };
    throw err;
  }

  const resolved = resolveRunContext(prepared, options);
  const reportOptions = optionsForReport(parsed, prepared);
  warnForUnsupportedDuplicateExtensions(
    prepared.config.additionalSourceExtensions,
    parsed.checks,
    resolved.warnStderr,
  );
  const report = buildReport(
    reportOptions,
    prepared.resolvedRef,
    prepared.detectorScope,
    resolved.checkContext,
  );
  const rendered = parsed.format === "json" ? formatJson(report) : formatText(report);
  const stdout = writeReportOutputs(parsed, rendered, report, resolved.writer, resolved.warnStderr);
  return { exitCode: 0, stdout, report };
}

function runHarnessFreshnessSubcommand(options: RunOptions): RunResult {
  const extraArgs = options.argv.slice(1);
  if (extraArgs.includes("--help") || extraArgs.includes("-h")) {
    return {
      exitCode: 0,
      stdout: [
        "Usage:",
        "  bun run drift:ai harness-freshness",
        "",
        "Report-only. Checks docs/ai-harness.md against docs/guides and backtick paths.",
      ].join("\n"),
    };
  }
  if (extraArgs.length > 0) {
    return {
      exitCode: 2,
      stdout: `Unknown argument for harness-freshness: ${extraArgs[0] ?? ""}`,
    };
  }
  const git = options.git ?? defaultGitRunner();
  const repoRoot = resolveRepoRoot(git);
  const findings = runHarnessFreshnessCheck({ repoRoot });
  return {
    exitCode: 0,
    stdout: formatHarnessFreshnessText(findings),
  };
}

function suppressionsGitRunnerFromStringGit(git: GitRunner): SuppressionsGitRunner {
  return (_repoRoot, ref) => git(["diff", ref]);
}

function defaultWarnStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

function warnForUnsupportedDuplicateExtensions(
  additionalSourceExtensions: readonly string[],
  checks: readonly DriftCheckId[],
  warnStderr: (message: string) => void,
): void {
  if (!checks.includes("duplicates")) return;
  const unsupported = additionalSourceExtensions.filter(
    (extension) => !JSCPD_SUPPORTED_EXTENSIONS.has(extension),
  );
  if (unsupported.length === 0) return;
  warnStderr(
    `drift:ai: configured additionalSourceExtensions [${unsupported.join(", ")}] are not covered by jscpd; duplicates will not flag them.`,
  );
}
