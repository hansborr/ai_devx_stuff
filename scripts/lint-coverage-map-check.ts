import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { collectEslintReachFindings } from "./lint-coverage-map-check-eslint-reach.js";
import {
  collectRowFindings,
  collectStalePathFindings,
  collectUnaccountedFileFindings,
  formatFindings,
} from "./lint-coverage-map-check-findings.js";
import { loadMapText, loadTrackedFiles, repoRoot } from "./lint-coverage-map-check-io.js";
import {
  extractPathPatterns,
  parseRows,
  trackedFileIsInScope,
} from "./lint-coverage-map-check-patterns.js";
import type {
  CheckFinding,
  LintCoverageMapCheckOptions,
  LintCoverageMapCheckResult,
} from "./lint-coverage-map-check-types.js";
import { lintRatchets } from "./lint-ratchet/lint-ratchet-config.js";

export type { LintCoverageMapCheckOptions, LintCoverageMapCheckResult };

const PROCESS_ARGV_USER_ARGS_START = 2;

export async function runLintCoverageMapCheck(
  options: LintCoverageMapCheckOptions = {},
): Promise<LintCoverageMapCheckResult> {
  const cwd = options.cwd ?? repoRoot;
  const mapText = loadMapText(options, cwd);
  const trackedFiles = [...(options.trackedFiles ?? loadTrackedFiles(cwd))].sort();
  const ratchetIds = options.ratchetIds ?? new Set(lintRatchets.map((ratchet) => ratchet.id));
  const rows = parseRows(mapText);
  const pathPatterns = rows.flatMap(extractPathPatterns);
  const findings: CheckFinding[] = [
    ...collectStalePathFindings(pathPatterns, trackedFiles),
    ...collectRowFindings(rows, ratchetIds),
    ...collectUnaccountedFileFindings(trackedFiles, pathPatterns, trackedFileIsInScope),
    ...(await collectEslintReachFindings({
      checkEslintReach: options.checkEslintReach,
      cwd,
      extractPathPatterns,
      reachChecker: options.eslintReachChecker,
      rows,
      staged: options.staged,
      trackedFileIsInScope,
      trackedFiles,
    })),
  ];

  if (findings.length > 0) {
    return { exitCode: 1, stdout: "", stderr: formatFindings(findings), findings };
  }
  return {
    exitCode: 0,
    stdout: `lint-coverage-map-check OK — ${String(rows.length)} row(s), ${String(pathPatterns.length)} path pattern(s), ${String(trackedFiles.length)} tracked file(s) checked.\n`,
    stderr: "",
    findings,
  };
}

function parseCliArgs(args: readonly string[]): LintCoverageMapCheckOptions | undefined {
  const flags = args.filter((arg) => arg !== "--");
  if (flags.every((arg) => arg === "--staged" || arg === "--check-eslint-reach")) {
    const staged = flags.includes("--staged");
    return { staged, checkEslintReach: flags.includes("--check-eslint-reach") && !staged };
  }
  process.stderr.write("usage: lint-coverage-map-check.ts [--check-eslint-reach] [--staged]\n");
  return undefined;
}

const invokedPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (fileURLToPath(import.meta.url) === invokedPath) {
  const options = parseCliArgs(process.argv.slice(PROCESS_ARGV_USER_ARGS_START));
  if (options === undefined) {
    process.exitCode = 2;
  } else {
    const result = await runLintCoverageMapCheck(options);
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  }
}
