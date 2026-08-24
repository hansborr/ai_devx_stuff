import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { matchesAny, matchesRatchet } from "@musi/lint-ratchet/kernel/ratchet-globs.js";
import { z } from "zod";

import { configSurfaceEntries as defaultConfigSurfaceEntries } from "../eslint-config/config-surfaces.js";
import { parseCli } from "./lib/cli.js";
import {
  collectEslintReachFindings,
  createEslintReachChecker,
} from "./lint-coverage-map-check-eslint-reach.js";
import {
  collectConfigSurfaceCoverageFindings,
  collectConflictingCoverageFindings,
  collectFilesCountFindings,
  collectStalePathFindings,
  collectUnaccountedFileFindings,
  collectUnknownRatchetFindings,
  formatFindings,
} from "./lint-coverage-map-check-findings.js";
import { createWorktreeExists, loadTrackedFiles, repoRoot } from "./lint-coverage-map-check-io.js";
import { collectRatchetMembershipFindings } from "./lint-coverage-map-check-row-consistency.js";
import { trackedFileIsInScope } from "./lint-coverage-map-check-scope.js";
import { buildSuggestions } from "./lint-coverage-map-check-suggest.js";
import type {
  CheckFinding,
  CoveragePattern,
  CoverageRow,
  LintCoverageMapCheckOptions,
  LintCoverageMapCheckResult,
} from "./lint-coverage-map-check-types.js";
import { coverageEntries as defaultCoverageEntries } from "./lint-coverage-map-manifest.js";
import type { CoverageEntry } from "./lint-coverage-map-manifest-schema.js";
import { lintRatchets } from "./lint-ratchet/lint-ratchet-config.js";

export type { LintCoverageMapCheckOptions, LintCoverageMapCheckResult };

const PROCESS_ARGV_USER_ARGS_START = 2;
const ratchetScopeById = new Map(lintRatchets.map((ratchet) => [ratchet.id, ratchet] as const));

function defaultRatchetMembership(ratchetId: string): ((file: string) => boolean) | undefined {
  const scope = ratchetScopeById.get(ratchetId);
  return scope === undefined ? undefined : (file: string) => matchesRatchet(scope, file);
}

// Every glob resolves through the canonical ratchet matcher (minimatch with
// `dot: true`), the same engine ESLint flat config and the ratchet registry use.
// There is no second dialect for the coverage map to disagree with.
function coverageRowFromEntry(entry: CoverageEntry): CoverageRow {
  return {
    id: entry.id,
    patterns: entry.globs.map(
      (glob): CoveragePattern => ({
        entryId: entry.id,
        glob,
        matcher: (file: string) => matchesAny(file, [glob]),
      }),
    ),
    ratchetProse: entry.ratchets ?? "",
    filesProse: entry.files,
    filesCountNote: entry.filesCountNote,
    statusParts: entry.status,
  };
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
  if (options.cwd === undefined && options.entries === undefined) {
    return manifestConfigSurfaceEntries ?? EMPTY_CONFIG_SURFACE_ENTRIES;
  }
  return EMPTY_CONFIG_SURFACE_ENTRIES;
}

interface ResolvedCheckInputs {
  readonly cwd: string;
  readonly trackedFiles: readonly string[];
  readonly ratchetIds: ReadonlySet<string>;
  readonly ratchetMembership: (ratchetId: string) => ((file: string) => boolean) | undefined;
  readonly worktreeExists: (relativePath: string) => boolean;
  readonly rows: readonly CoverageRow[];
}

function resolveCheckInputs(options: LintCoverageMapCheckOptions): ResolvedCheckInputs {
  const cwd = options.cwd ?? repoRoot;
  return {
    cwd,
    trackedFiles: [...(options.trackedFiles ?? loadTrackedFiles(cwd))].sort(),
    ratchetIds: options.ratchetIds ?? new Set(lintRatchets.map((ratchet) => ratchet.id)),
    ratchetMembership: options.ratchetMembership ?? defaultRatchetMembership,
    worktreeExists: options.worktreeExists ?? createWorktreeExists(cwd),
    rows: (options.entries ?? defaultCoverageEntries).map(coverageRowFromEntry),
  };
}

export async function runLintCoverageMapCheck(
  options: LintCoverageMapCheckOptions = {},
): Promise<LintCoverageMapCheckResult> {
  const { cwd, trackedFiles, ratchetIds, ratchetMembership, worktreeExists, rows } =
    resolveCheckInputs(options);
  const patterns = rows.flatMap((row) => row.patterns);
  const configSurfaceEntries = configSurfaceEntriesForOptions(options);
  const findings: CheckFinding[] = [
    ...collectStalePathFindings(patterns, trackedFiles, worktreeExists),
    ...collectUnknownRatchetFindings(rows, ratchetIds),
    ...collectFilesCountFindings(rows, trackedFiles),
    ...collectRatchetMembershipFindings({ ratchetMembership, rows, trackedFiles }),
    ...collectConflictingCoverageFindings(trackedFiles, rows, trackedFileIsInScope),
    ...collectConfigSurfaceCoverageFindings({
      configSurfaceEntries,
      rows,
      trackedFileIsInScope,
      trackedFiles,
    }),
    ...collectUnaccountedFileFindings(trackedFiles, patterns, trackedFileIsInScope),
    ...(await collectEslintReachFindings({
      checkEslintReach: options.checkEslintReach,
      cwd,
      reachChecker: options.eslintReachChecker,
      rows,
      trackedFileIsInScope,
      trackedFiles,
    })),
  ];

  if (findings.length > 0) {
    const suggestions =
      options.suggest === true
        ? await buildSuggestionLines(findings, patterns, cwd, options.eslintReachChecker)
        : [];
    const stderr =
      formatFindings(findings) + (suggestions.length > 0 ? suggestions.join("\n") : "");
    return { exitCode: 1, stdout: "", stderr, findings };
  }
  return {
    exitCode: 0,
    stdout: `lint-coverage-map-check OK — ${String(rows.length)} entry(ies), ${String(patterns.length)} glob(s), ${String(trackedFiles.length)} tracked file(s) checked.\n`,
    stderr: "",
    findings,
  };
}

async function buildSuggestionLines(
  findings: readonly CheckFinding[],
  patterns: readonly CoveragePattern[],
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
    patterns,
    isEslintReachable,
    isRatchetCovered: (file) => lintRatchets.some((ratchet) => matchesRatchet(ratchet, file)),
  });
}

const cliFlagsSchema = z.object({
  "--check-eslint-reach": z.boolean().default(false),
  "--suggest": z.boolean().default(false),
});

// Exported for the S0 characterization tests of arch-plans-2026-07 leaf 02;
// the CLI entrypoint below remains the only runtime caller. Contract (pinned):
// bare `--` tokens are filtered, any other unexpected token (positional, help
// flag, inline value) writes the usage line to stderr and returns undefined.
export function parseCliArgs(args: readonly string[]): LintCoverageMapCheckOptions | undefined {
  try {
    const parsed = parseCli({
      argv: args.filter((arg) => arg !== "--"),
      usage: "",
      createError: (message) => new Error(message),
      options: [
        { name: "--check-eslint-reach", kind: "flag" },
        { name: "--suggest", kind: "flag" },
      ],
      schema: cliFlagsSchema,
    });
    const stray = parsed.positionals[0];
    if (stray !== undefined) throw new Error(`unexpected argument: ${stray}`);
    return {
      checkEslintReach: parsed.options["--check-eslint-reach"],
      suggest: parsed.options["--suggest"],
    };
  } catch {
    process.stderr.write("usage: lint-coverage-map-check.ts [--check-eslint-reach] [--suggest]\n");
    return undefined;
  }
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
