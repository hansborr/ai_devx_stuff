import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { matchesRatchet } from "@musi/lint-ratchet/kernel/ratchet-globs.js";

import { configSurfaceEntries as defaultConfigSurfaceEntries } from "../eslint-config/config-surfaces.js";
import {
  collectEslintReachFindings,
  createEslintReachChecker,
} from "./lint-coverage-map-check-eslint-reach.js";
import {
  collectConfigSurfaceCoverageFindings,
  collectConflictingCoverageFindings,
  collectRowFindings,
  collectStalePathFindings,
  collectUnaccountedFileFindings,
  formatFindings,
} from "./lint-coverage-map-check-findings.js";
import {
  createWorktreeExists,
  loadMapText,
  loadTrackedFiles,
  repoRoot,
} from "./lint-coverage-map-check-io.js";
import {
  extractPathPatterns,
  parseRows,
  trackedFileIsInScope,
} from "./lint-coverage-map-check-patterns.js";
import {
  collectRatchetMembershipFindings,
  collectStatusConsistencyFindings,
} from "./lint-coverage-map-check-row-consistency.js";
import { buildSuggestions } from "./lint-coverage-map-check-suggest.js";
import type {
  CheckFinding,
  LintCoverageMapCheckOptions,
  LintCoverageMapCheckResult,
  PathPattern,
} from "./lint-coverage-map-check-types.js";
import { lintRatchets } from "./lint-ratchet/lint-ratchet-config.js";

export type { LintCoverageMapCheckOptions, LintCoverageMapCheckResult };

const PROCESS_ARGV_USER_ARGS_START = 2;
const ratchetScopeById = new Map(lintRatchets.map((ratchet) => [ratchet.id, ratchet] as const));

function defaultRatchetMembership(ratchetId: string): ((file: string) => boolean) | undefined {
  const scope = ratchetScopeById.get(ratchetId);
  return scope === undefined ? undefined : (file: string) => matchesRatchet(scope, file);
}

const manifestConfigSurfaceEntries =
  defaultConfigSurfaceEntries as LintCoverageMapCheckOptions["configSurfaceEntries"]; // type-assertion-boundary: interop - JS config-surface loader validates manifest entries before export.
const EMPTY_CONFIG_SURFACE_ENTRIES: NonNullable<
  LintCoverageMapCheckOptions["configSurfaceEntries"]
> = [];

function configSurfaceEntriesForOptions(
  options: LintCoverageMapCheckOptions,
): NonNullable<LintCoverageMapCheckOptions["configSurfaceEntries"]> {
  if (options.configSurfaceEntries !== undefined) return options.configSurfaceEntries;
  if (options.cwd === undefined && options.mapText === undefined && options.mapPath === undefined) {
    return manifestConfigSurfaceEntries ?? EMPTY_CONFIG_SURFACE_ENTRIES;
  }
  return EMPTY_CONFIG_SURFACE_ENTRIES;
}

export async function runLintCoverageMapCheck(
  options: LintCoverageMapCheckOptions = {},
): Promise<LintCoverageMapCheckResult> {
  const cwd = options.cwd ?? repoRoot;
  const mapText = loadMapText(options, cwd);
  const trackedFiles = [...(options.trackedFiles ?? loadTrackedFiles(cwd))].sort();
  const ratchetIds = options.ratchetIds ?? new Set(lintRatchets.map((ratchet) => ratchet.id));
  const ratchetMembership = options.ratchetMembership ?? defaultRatchetMembership;
  const worktreeExists = options.worktreeExists ?? createWorktreeExists(cwd);
  const rows = parseRows(mapText);
  const pathPatterns = rows.flatMap(extractPathPatterns);
  const configSurfaceEntries = configSurfaceEntriesForOptions(options);
  const findings: CheckFinding[] = [
    ...collectStalePathFindings(pathPatterns, trackedFiles, worktreeExists),
    ...collectRowFindings(rows, ratchetIds),
    ...collectStatusConsistencyFindings(rows),
    ...collectRatchetMembershipFindings({
      extractPathPatterns,
      ratchetMembership,
      rows,
      trackedFiles,
    }),
    ...collectConflictingCoverageFindings(
      trackedFiles,
      rows,
      extractPathPatterns,
      trackedFileIsInScope,
    ),
    ...collectConfigSurfaceCoverageFindings({
      configSurfaceEntries,
      extractPathPatterns,
      rows,
      trackedFileIsInScope,
      trackedFiles,
    }),
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
    const suggestions =
      options.suggest === true
        ? await buildSuggestionLines(findings, pathPatterns, cwd, options.eslintReachChecker)
        : [];
    const stderr =
      formatFindings(findings) + (suggestions.length > 0 ? suggestions.join("\n") : "");
    return { exitCode: 1, stdout: "", stderr, findings };
  }
  return {
    exitCode: 0,
    stdout: `lint-coverage-map-check OK — ${String(rows.length)} row(s), ${String(pathPatterns.length)} path pattern(s), ${String(trackedFiles.length)} tracked file(s) checked.\n`,
    stderr: "",
    findings,
  };
}

async function buildSuggestionLines(
  findings: readonly CheckFinding[],
  pathPatterns: readonly PathPattern[],
  cwd: string,
  eslintReachChecker: LintCoverageMapCheckOptions["eslintReachChecker"],
): Promise<string[]> {
  const unaccountedFiles = findings
    .filter((finding) => finding.kind === "unaccounted-file")
    .map((finding) => finding.value);
  if (unaccountedFiles.length === 0) return [];
  const isEslintReachable = eslintReachChecker ?? createEslintReachChecker(cwd);
  return await buildSuggestions({
    unaccountedFiles,
    pathPatterns,
    isEslintReachable,
    isRatchetCovered: (file) => lintRatchets.some((ratchet) => matchesRatchet(ratchet, file)),
  });
}

function parseCliArgs(args: readonly string[]): LintCoverageMapCheckOptions | undefined {
  const allowed = new Set(["--staged", "--check-eslint-reach", "--suggest"]);
  const flags = args.filter((arg) => arg !== "--");
  if (flags.every((arg) => allowed.has(arg))) {
    const staged = flags.includes("--staged");
    return {
      staged,
      checkEslintReach: flags.includes("--check-eslint-reach") && !staged,
      suggest: flags.includes("--suggest"),
    };
  }
  process.stderr.write(
    "usage: lint-coverage-map-check.ts [--check-eslint-reach] [--staged] [--suggest]\n",
  );
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
