// CLI seam of the Prisma migration safety scanner (backlog leaf 119).
//
// `scripts/migration-safety-scan.sh` execs this module; the shell file survives
// only as a ~15-line forwarder because `doctor.sh` and the smokes invoke the
// scanner by that exact path. Everything below is either argument parsing, the
// read-only filesystem walk, or the glue that hands one `ScanReport` to the two
// pure renderers. The CLI contract is frozen: `--json`, positional PATH
// arguments, `--` end-of-options, warn-only exit 0, and invocation from any
// working directory.
//
// `runMigrationSafetyCli` takes its effects as an injected `MigrationSafetyIo`
// so contract tests run in Vitest without spawning a process, mirroring
// `verify-metadata-core.ts`.

import { dirname as pathDirname } from "node:path/posix";

import type { HarnessFinding } from "@musi/harness-diagnostics/schema.js";

import {
  type AllowlistEntry,
  classifyHits,
  type CollectionWarning,
  findStaleEntries,
  parseAllowlist,
  type RuleHit,
  type ScanReport,
  scanSqlText,
} from "./migration-safety-core.js";
import { nodeMigrationSafetyIo } from "./migration-safety-io.js";
import { renderHumanReport, toHarnessFindings } from "./migration-safety-report.js";

const MIGRATIONS_SUBPATH = "packages/server/prisma/migrations";
const ALLOWLIST_BASENAME = ".safety-acknowledged";
const EXIT_OK = 0;
const EXIT_FAIL = 1;

const USAGE = `usage: migration-safety-scan.sh [--json] [PATH ...]

Scans Prisma SQL migrations for destructive operations:
  - DROP TABLE
  - DROP COLUMN
  - ALTER COLUMN ... TYPE (potential type narrowing)
  - ADD COLUMN ... NOT NULL without DEFAULT

PATH may be a migration directory (containing migration.sql), a single
.sql file, or the migrations root. With no arguments the scanner walks
packages/server/prisma/migrations.

With --json, emits a harness-diagnostics envelope on stdout instead of
the human-readable report. The scanner is warn-only and always exits 0.
`;

/** Every effect the scanner performs, injectable for tests. */
export interface MigrationSafetyIo {
  /** Repository root, or `""` when the process is not inside a git repo. */
  readonly repoRoot: string;
  /** `MUSI_MIGRATION_ALLOWLIST`, unset/empty meaning "use the default". */
  readonly allowlistOverride: string | undefined;
  readonly isDirectory: (path: string) => boolean;
  readonly isFile: (path: string) => boolean;
  /** Migration SQL files one level below `dir`, or `dir`'s own if it has one. */
  readonly listMigrationSql: (dir: string) => readonly string[];
  readonly readText: (path: string) => string;
  readonly emitEnvelope: (findings: readonly HarnessFinding[]) => void;
}

export interface MigrationSafetyCliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface ParsedArgs {
  readonly help: boolean;
  readonly json: boolean;
  readonly paths: readonly string[];
}

/**
 * `-h`/`--help` win over any earlier `--json` or path — but only before `--`.
 * `--` stops flag parsing entirely, as the shell contract requires, so every
 * token after it is a path even when it is spelled `-h` or `--json`. Before
 * `--`, everything that is not a flag is likewise a path, including
 * option-shaped tokens, so a directory literally named `--weird-name` is
 * scannable by passing it after `--`.
 */
export function parseMigrationSafetyArgs(argv: readonly string[]): ParsedArgs {
  const paths: string[] = [];
  let json = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    if (arg === "-h" || arg === "--help") return { help: true, json, paths };
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--") {
      paths.push(...argv.slice(index + 1));
      break;
    }
    paths.push(arg);
  }
  return { help: false, json, paths };
}

/** Shorten absolute paths under the repo root, exactly as the shell did. */
function displayPath(repoRoot: string, path: string): string {
  const prefix = `${repoRoot}/`;
  return repoRoot !== "" && path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

interface Collected {
  readonly sqlFiles: readonly string[];
  readonly warnings: readonly CollectionWarning[];
  readonly stderr: string;
  /** Set when collection cannot proceed at all (no repo, no PATH). */
  readonly fatal: string | undefined;
  /**
   * True for the missing-default-migrations-directory branch, which returns
   * before the "no migration.sql files found" notice the other empty-result
   * paths print.
   */
  readonly earlyExit: boolean;
}

function collectTargets(
  paths: readonly string[],
  defaultMigrationsDir: string,
  io: MigrationSafetyIo,
): Collected {
  const sqlFiles: string[] = [];
  const warnings: CollectionWarning[] = [];
  let stderr = "";

  const warn = (warning: CollectionWarning): void => {
    stderr += `WARN: ${warning.message}\n`;
    warnings.push(warning);
  };

  if (paths.length === 0) {
    if (defaultMigrationsDir === "") {
      return {
        sqlFiles,
        warnings,
        stderr,
        fatal:
          "FAIL: no PATH argument and not inside a git repository — pass a migration directory or .sql file\n",
        earlyExit: true,
      };
    }
    if (!io.isDirectory(defaultMigrationsDir)) {
      warn({
        messageId: "missing-migrations-directory",
        path: defaultMigrationsDir,
        message: `no migrations directory at ${defaultMigrationsDir} — nothing to scan`,
        howToFix:
          "Create the migrations directory, or pass an existing migration directory or .sql file.",
      });
      return { sqlFiles, warnings, stderr, fatal: undefined, earlyExit: true };
    }
    sqlFiles.push(...io.listMigrationSql(defaultMigrationsDir));
    return { sqlFiles, warnings, stderr, fatal: undefined, earlyExit: false };
  }

  for (const target of paths) {
    if (io.isDirectory(target)) {
      sqlFiles.push(...io.listMigrationSql(target));
    } else if (io.isFile(target)) {
      sqlFiles.push(target);
    } else {
      warn({
        messageId: "missing-target",
        path: target,
        message: `not a file or directory, skipping: ${target}`,
        howToFix:
          "Pass an existing migration directory or .sql file, or remove this path from the scanner invocation.",
      });
    }
  }
  return { sqlFiles, warnings, stderr, fatal: undefined, earlyExit: false };
}

/**
 * An unreadable file is reported and skipped, never fatal. The shell scanned
 * each file with a separate `awk` and read the allowlist with a shell
 * redirection, so a permission error printed one line to stderr and the run
 * carried on to exit 0 with every other migration's findings intact. Letting
 * `readFileSync` throw instead would suppress destructive findings the scanner
 * *did* resolve — the opposite of failing safe for a warn-only tool whose
 * stderr doctor discards. The message is the scanner's own rather than awk's,
 * so parity on this path is behavioural, not byte-exact.
 */
function readTextOrWarn(path: string, io: MigrationSafetyIo): { text: string; stderr: string } {
  try {
    return { text: io.readText(path), stderr: "" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { text: "", stderr: `WARN: cannot read ${path}, skipping: ${detail}\n` };
  }
}

interface AllowlistRead {
  readonly entries: ReadonlyMap<string, AllowlistEntry>;
  readonly stderr: string;
}

function readAllowlist(allowlistFile: string, io: MigrationSafetyIo): AllowlistRead {
  if (allowlistFile === "" || !io.isFile(allowlistFile)) return { entries: new Map(), stderr: "" };
  const read = readTextOrWarn(allowlistFile, io);
  return { entries: parseAllowlist(read.text), stderr: read.stderr };
}

interface Scanned {
  readonly hits: readonly RuleHit[];
  readonly stderr: string;
}

/**
 * No path-shape guard: the shell version framed findings as tab-separated
 * records and had to refuse a path containing a tab or newline before that
 * framing corrupted downstream fields. Values stay structured here, so such a
 * path is scanned like any other.
 */
function scanFiles(sqlFiles: readonly string[], repoRoot: string, io: MigrationSafetyIo): Scanned {
  const hits: RuleHit[] = [];
  let stderr = "";
  for (const file of sqlFiles) {
    const path = displayPath(repoRoot, file);
    const read = readTextOrWarn(file, io);
    stderr += read.stderr;
    for (const match of scanSqlText(read.text)) {
      hits.push({ path, line: match.line, rule: match.rule, snippet: match.snippet });
    }
  }
  return { hits, stderr };
}

/** The allowlist's own directory, `""` when the scan has no allowlist at all. */
function allowlistDir(allowlistFile: string): string {
  return allowlistFile === "" ? "" : pathDirname(allowlistFile);
}

/** The three allowlist fields both report shapes carry, derived in one place. */
function allowlistFields(
  allowlistFile: string,
  repoRoot: string,
): Pick<ScanReport, "allowlistDisplayDir" | "allowlistDisplayPath" | "allowlistPath"> {
  const dir = allowlistDir(allowlistFile);
  return {
    allowlistPath: allowlistFile,
    allowlistDisplayPath: allowlistFile === "" ? "" : displayPath(repoRoot, allowlistFile),
    allowlistDisplayDir: dir === "" ? "" : displayPath(repoRoot, dir),
  };
}

function emptyReport(
  warnings: readonly CollectionWarning[],
  allowlistFile: string,
  repoRoot: string,
): ScanReport {
  return {
    scannedFileCount: 0,
    hits: [],
    staleEntries: [],
    ...allowlistFields(allowlistFile, repoRoot),
    collectionWarnings: warnings,
  };
}

function resolveAllowlistPath(io: MigrationSafetyIo, defaultMigrationsDir: string): string {
  const fallback =
    defaultMigrationsDir === "" ? "" : `${defaultMigrationsDir}/${ALLOWLIST_BASENAME}`;
  const override = io.allowlistOverride;
  return override === undefined || override === "" ? fallback : override;
}

/**
 * The result when collection produced no SQL files. The allowlist is never read
 * on this path, so stale entries stay invisible here — preserved from the shell
 * original, where the early return sat above the allowlist parser.
 */
function noFilesResult(
  json: boolean,
  collected: Collected,
  allowlistFile: string,
  io: MigrationSafetyIo,
): MigrationSafetyCliResult {
  if (json) {
    io.emitEnvelope(toHarnessFindings(emptyReport(collected.warnings, allowlistFile, io.repoRoot)));
    return { exitCode: EXIT_OK, stdout: "", stderr: collected.stderr };
  }
  return {
    exitCode: EXIT_OK,
    stdout: collected.earlyExit ? "" : "INFO: no migration.sql files found\n",
    stderr: collected.stderr,
  };
}

function buildReport(
  collected: Collected,
  allowlistFile: string,
  hits: readonly RuleHit[],
  io: MigrationSafetyIo,
): { readonly report: ScanReport; readonly stderr: string } {
  const allowlist = readAllowlist(allowlistFile, io);
  const dir = allowlistDir(allowlistFile);
  return {
    report: {
      scannedFileCount: collected.sqlFiles.length,
      hits: classifyHits(hits, allowlist.entries),
      staleEntries:
        allowlist.entries.size === 0
          ? []
          : findStaleEntries(allowlist.entries, (name) =>
              io.isFile(`${dir}/${name}/migration.sql`),
            ),
      ...allowlistFields(allowlistFile, io.repoRoot),
      collectionWarnings: collected.warnings,
    },
    stderr: allowlist.stderr,
  };
}

/** Run the scanner end to end. Warn-only: findings never change the exit code. */
export function runMigrationSafetyCli(
  argv: readonly string[],
  io: MigrationSafetyIo,
): MigrationSafetyCliResult {
  const args = parseMigrationSafetyArgs(argv);
  if (args.help) return { exitCode: EXIT_OK, stdout: USAGE, stderr: "" };

  const defaultMigrationsDir = io.repoRoot === "" ? "" : `${io.repoRoot}/${MIGRATIONS_SUBPATH}`;
  const allowlistFile = resolveAllowlistPath(io, defaultMigrationsDir);

  const collected = collectTargets(args.paths, defaultMigrationsDir, io);
  if (collected.fatal !== undefined) {
    return { exitCode: EXIT_FAIL, stdout: "", stderr: collected.stderr + collected.fatal };
  }
  if (collected.sqlFiles.length === 0) {
    return noFilesResult(args.json, collected, allowlistFile, io);
  }

  const scanned = scanFiles(collected.sqlFiles, io.repoRoot, io);
  const built = buildReport(collected, allowlistFile, scanned.hits, io);
  const stderr = collected.stderr + scanned.stderr + built.stderr;
  if (args.json) {
    io.emitEnvelope(toHarnessFindings(built.report));
    return { exitCode: EXIT_OK, stdout: "", stderr };
  }
  return { exitCode: EXIT_OK, stdout: renderHumanReport(built.report), stderr };
}

const PROCESS_ARGV_USER_ARGS_START = 2;

if (import.meta.main) {
  const result = runMigrationSafetyCli(
    process.argv.slice(PROCESS_ARGV_USER_ARGS_START),
    nodeMigrationSafetyIo(),
  );
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
