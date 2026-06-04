import type { PathProbe } from "./adapter-support.js";
import type { CheckRunInput } from "./check-plugin.js";
import { DriftAiHelp, parseArgs } from "./cli-args.js";
import { runColdspots } from "./coldspots.js";
import type { FileReader } from "./comments.js";
import { type BufferGitRunner, type StatRunner } from "./current-inventory.js";
import { writeDriftDiagnosticsSidecar } from "./diagnostics-projection.js";
import type { JscpdRunner } from "./duplicates-runner.js";
import { DriftAiError } from "./errors.js";
import type { DirectoryListing } from "./ghost-files.js";
import { defaultGitRunner, type GitRunner, resolveRepoRoot } from "./git-changed-scope.js";
import {
  formatHarnessFreshnessJson,
  formatHarnessFreshnessText,
  runHarnessFreshnessCheck,
} from "./harness-freshness.js";
import { runHotspots } from "./hotspots.js";
import type { ModuleGraphRunner } from "./import-cycles-graph.js";
import type { KnipRunner } from "./knip-runner.js";
import type { NearDuplicateRunner } from "./near-duplicates-runner.js";
import {
  optionsForReport,
  prepareChangedRun,
  prepareCurrentRun,
  type PreparedRun,
} from "./prepare-run.js";
import { buildReport } from "./report-builder.js";
import { formatJson, formatText } from "./report-format.js";
import { defaultReportWriter, type ReportWriter, writeReportOutputs } from "./report-output.js";
import {
  parseSubcommandArgs,
  type SubcommandBaseOptions,
  writeSubcommandOutput,
} from "./subcommand-args.js";
import type { SuppressionsGitRunner } from "./suppressions.js";
import type { CliOptions, DriftReport } from "./types.js";

export type RunOptions = {
  readonly argv: readonly string[];
  readonly git?: GitRunner;
  readonly gitBuffer?: BufferGitRunner;
  readonly stat?: StatRunner;
  readonly rootExists?: (absolutePath: string) => boolean;
  readonly jscpd?: JscpdRunner;
  readonly knip?: KnipRunner;
  readonly moduleGraph?: ModuleGraphRunner;
  readonly nearDuplicates?: NearDuplicateRunner;
  readonly listDirectory?: DirectoryListing;
  readonly readFile?: FileReader;
  readonly suppressionsGit?: SuppressionsGitRunner;
  readonly pathExists?: PathProbe;
  // Absolute-path existence probe for external-tool executable resolution
  // (jscpd/knip bin lookup); overridable so tool-unavailable paths stay testable.
  readonly binExists?: (absolutePath: string) => boolean;
  readonly warnStderr?: (message: string) => void;
  readonly writer?: (path: string, contents: string) => void;
};

export type RunResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly report?: DriftReport;
};

// Assemble the central run state plus the service-resolution env. The env carries
// only repo root, the injected-override seam, and parsed CLI; each plugin resolves
// its own adapter dependencies from it (see defineCheckPlugin.resolveServices), so
// the runner no longer imports or wires any per-check tool runner directly.
function resolveRunContext(
  prepared: PreparedRun,
  parsed: CliOptions,
  options: RunOptions,
): {
  readonly input: CheckRunInput;
  readonly warnStderr: (message: string) => void;
  readonly writer: ReportWriter;
} {
  const warnStderr = options.warnStderr ?? defaultWarnStderr;
  const writer = options.writer ?? defaultReportWriter;
  return {
    input: {
      detectorScope: prepared.detectorScope,
      inventoryByDir: prepared.inventoryByDir ?? null,
      repoRoot: prepared.repoRoot,
      suppressionDiffRef: prepared.suppressionDiffRef,
      config: prepared.config,
      roots: prepared.roots,
      sourceExtensions: prepared.sourceExtensions,
      warnStderr,
      env: {
        repoRoot: prepared.repoRoot,
        overrides: options,
        cli: parsed,
      },
    },
    warnStderr,
    writer,
  };
}

// drift:ai surfaces exactly two sentinel errors to the CLI: DriftAiHelp is a
// successful help request (exit 0) and DriftAiError is a usage/config problem
// (exit 2). Anything else is an unexpected bug and propagates. Centralizing the
// mapping keeps arg parsing, run preparation, and the harness-freshness
// subcommand from each re-deriving (and drifting on) these exit codes.
function toExitResult(err: unknown): RunResult {
  if (err instanceof DriftAiHelp) return { exitCode: 0, stdout: err.message };
  if (err instanceof DriftAiError) return { exitCode: 2, stdout: err.message };
  throw err;
}

export function runDriftAi(options: RunOptions): RunResult {
  const subcommand = runSubcommand(options);
  if (subcommand !== undefined) return subcommand;

  let parsed: CliOptions;
  try {
    parsed = parseArgs(options.argv);
  } catch (err) {
    return toExitResult(err);
  }

  let prepared: PreparedRun;
  try {
    prepared =
      parsed.scopeMode === "current"
        ? prepareCurrentRun(parsed, options)
        : prepareChangedRun(parsed, options);
  } catch (err) {
    return toExitResult(err);
  }

  const resolved = resolveRunContext(prepared, parsed, options);
  const reportOptions = optionsForReport(parsed, prepared);
  const report = buildReport(
    reportOptions,
    prepared.resolvedRef,
    prepared.detectorScope,
    resolved.input,
  );
  const rendered =
    parsed.format === "json"
      ? formatJson(report, { includeScope: parsed.includeScope })
      : formatText(report);
  const stdout = writeReportOutputs(parsed, rendered, report, resolved.writer, resolved.warnStderr);
  // Opt-in HarnessDiagnostics sidecar: native stdout/report files above are
  // untouched; a bad output path or failed write is a CLI/tool error (exit 2),
  // not a drift finding. A non-diagnostics run never reaches the projection.
  try {
    writeDriftDiagnosticsSidecar(report);
  } catch (err) {
    return toExitResult(err);
  }
  // Report-only by default (exit 0). --fail-on-findings opts into exit 1 when the
  // run produced findings; usage/config errors already returned exit 2 above.
  const exitCode = parsed.failOnFindings && report.findings.length > 0 ? 1 : 0;
  return { exitCode, stdout, report };
}

// Subcommands sit outside the CHECK_RUNNERS registry. `harness-freshness` is a
// Musi-only findings check; `hotspots` and `coldspots` are brand-firewalled
// advisories (sibling subcommands over the same windowed git collector, viewed from
// opposite ends — velocity vs stillness). All use the shared subcommand arg parser
// for `--format`/`--output`; only `hotspots`/`coldspots` opt into `--config`
// (harness-freshness does not read config, so it rejects the flag).
function runSubcommand(options: RunOptions): RunResult | undefined {
  if (options.argv[0] === "harness-freshness") return runHarnessFreshnessSubcommand(options);
  if (options.argv[0] === "hotspots") {
    return runHotspots({
      argv: options.argv.slice(1),
      ...(options.git === undefined ? {} : { git: options.git }),
      ...(options.writer === undefined ? {} : { writer: options.writer }),
    });
  }
  if (options.argv[0] === "coldspots") {
    return runColdspots({
      argv: options.argv.slice(1),
      ...(options.git === undefined ? {} : { git: options.git }),
      ...(options.writer === undefined ? {} : { writer: options.writer }),
    });
  }
  return undefined;
}

const HARNESS_FRESHNESS_USAGE = [
  "Usage:",
  "  bun run drift:ai harness-freshness",
  "  bun run drift:ai harness-freshness --format <text|json> [--output <path>]",
  "",
  "Report-only. Checks docs/ai-harness.md against docs/guides and backtick paths.",
].join("\n");

function runHarnessFreshnessSubcommand(options: RunOptions): RunResult {
  let parsed: SubcommandBaseOptions;
  try {
    parsed = parseSubcommandArgs(options.argv.slice(1), { usage: HARNESS_FRESHNESS_USAGE });
  } catch (err) {
    return toExitResult(err);
  }
  const git = options.git ?? defaultGitRunner();
  const repoRoot = resolveRepoRoot(git);
  const findings = runHarnessFreshnessCheck({ repoRoot });
  const rendered =
    parsed.format === "json"
      ? formatHarnessFreshnessJson(findings)
      : formatHarnessFreshnessText(findings);
  const writer = options.writer ?? defaultReportWriter;
  return { exitCode: 0, stdout: writeSubcommandOutput(parsed, rendered, writer) };
}

function defaultWarnStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}
