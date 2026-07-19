import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { checkBacklogFiles } from "./backlog-lint-core.js";
import type { BacklogLintFile, BacklogLintResult } from "./backlog-lint-types.js";
import { parseCli } from "./lib/cli.js";

export type {
  BacklogLintFile,
  BacklogLintFinding,
  BacklogLintFindingKind,
  BacklogLintOptions,
  BacklogLintResult,
} from "./backlog-lint-types.js";

export interface RunBacklogLintOptions {
  readonly cwd?: string;
  readonly backlogDir?: string;
  readonly files?: readonly BacklogLintFile[];
  readonly filePaths?: readonly string[];
  readonly fileMode?: boolean;
  readonly now?: Date;
  readonly staleMonths?: number;
  readonly checkStaleness?: boolean;
  readonly requireFrontMatter?: boolean;
}

interface CliOptions {
  readonly backlogDir?: string;
  readonly staleMonths?: number;
  readonly checkStaleness?: boolean;
  readonly requireFrontMatter?: boolean;
  readonly filePaths?: readonly string[];
}

interface MutableCliOptions {
  backlogDir?: string;
  staleMonths?: number;
  checkStaleness?: boolean;
  requireFrontMatter?: boolean;
  filePaths?: string[];
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BACKLOG_DIR = "docs/agent_notes/backlog";
const PROCESS_ARGV_USER_ARGS_START = 2;
// A pack member's path under the backlog root is exactly `<pack>/<file>`.
const PACK_MEMBER_SEGMENTS = 2;

function listBacklogMarkdownFiles(cwd: string, backlogDir: string): string[] {
  // `-z` + NUL-split so a non-ASCII backlog pathname (git C-quotes those by
  // default) is not silently dropped; harmless for the ASCII paths in use today.
  const output = execFileSync(
    "git",
    ["ls-files", "-z", `${backlogDir}/**/*.md`, `${backlogDir}/*.md`],
    { cwd, encoding: "utf8" },
  );
  return output
    .split("\0")
    .filter((entry) => entry.length > 0)
    .sort();
}

function loadBacklogFiles(cwd: string, backlogDir: string): BacklogLintFile[] {
  return listBacklogMarkdownFiles(cwd, backlogDir).map((path) => ({
    path,
    text: readFileSync(resolve(cwd, path), "utf8"),
  }));
}

function existingMarkdownFile(path: string): boolean {
  if (extname(path) !== ".md") return false;
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function displayPathForNamedFile(cwd: string, path: string): string {
  const repoRelative = relative(cwd, path);
  if (!repoRelative.startsWith("..") && !isAbsolute(repoRelative) && repoRelative.length > 0) {
    return repoRelative;
  }
  return path;
}

function loadNamedMarkdownFiles(cwd: string, filePaths: readonly string[]): BacklogLintFile[] {
  return filePaths.flatMap((filePath) => {
    const absolutePath = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
    if (!existingMarkdownFile(absolutePath)) return [];
    return [
      {
        path: displayPathForNamedFile(cwd, absolutePath),
        text: readFileSync(absolutePath, "utf8"),
      },
    ];
  });
}

function invalidNamedFileMessages(cwd: string, filePaths: readonly string[]): string[] {
  return filePaths.flatMap((filePath) => {
    const absolutePath = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
    let isFile: boolean;
    try {
      isFile = statSync(absolutePath).isFile();
    } catch {
      return [`backlog:lint invalid --file target: ${filePath} (path does not exist)`];
    }
    if (!isFile) {
      return [`backlog:lint invalid --file target: ${filePath} (path is not a file)`];
    }
    if (extname(absolutePath) !== ".md") {
      return [`backlog:lint invalid --file target: ${filePath} (expected a Markdown file)`];
    }
    return [];
  });
}

function invalidNamedFilesResult(messages: readonly string[]): BacklogLintResult {
  return {
    exitCode: 2,
    stdout: "",
    stderr: `${messages.join("\n")}\n`,
    checkedCount: 0,
    findings: [],
  };
}

/** The pack directory of a repo-relative display path, if it is a member. */
function packDirForDisplayPath(displayPath: string, backlogDir: string): string | undefined {
  const prefix = `${backlogDir}/`;
  if (!displayPath.startsWith(prefix)) return undefined;
  const segments = displayPath.slice(prefix.length).split("/");
  if (segments.length !== PACK_MEMBER_SEGMENTS) return undefined;
  return `${backlogDir}/${segments[0] ?? ""}`;
}

/**
 * File-mode pack context: the named files plus the immediate `.md` siblings of
 * each named file's pack directory, so the pack-level checks can see the whole
 * pack even though only the named files are reported on.
 */
function loadPackCorpus(
  cwd: string,
  backlogDir: string,
  named: readonly BacklogLintFile[],
): BacklogLintFile[] {
  const byPath = new Map(named.map((file) => [file.path, file]));
  const loadedDirs = new Set<string>();
  for (const file of named) {
    const packDir = packDirForDisplayPath(file.path, backlogDir);
    if (packDir === undefined || loadedDirs.has(packDir)) continue;
    loadedDirs.add(packDir);
    const absoluteDir = resolve(cwd, packDir);
    let entries: string[];
    try {
      entries = readdirSync(absoluteDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const displayPath = `${packDir}/${entry}`;
      const absolutePath = resolve(absoluteDir, entry);
      if (byPath.has(displayPath) || !existingMarkdownFile(absolutePath)) continue;
      byPath.set(displayPath, { path: displayPath, text: readFileSync(absolutePath, "utf8") });
    }
  }
  return [...byPath.values()];
}

interface ResolvedRun {
  readonly cwd: string;
  readonly backlogDir: string;
  readonly files: readonly BacklogLintFile[];
  readonly requireFrontMatter?: boolean;
}

function fileModeCheck(options: RunBacklogLintOptions, resolved: ResolvedRun): BacklogLintResult {
  // In file mode only the named files are reported on, but pack checks need the
  // whole pack in view (drift, dangling links, unlisted leaves) and are then
  // scoped back to the edited paths via focusPaths.
  const packCorpus =
    options.files === undefined
      ? loadPackCorpus(resolved.cwd, resolved.backlogDir, resolved.files)
      : resolved.files;
  return checkBacklogFiles({
    files: resolved.files,
    now: options.now,
    staleMonths: options.staleMonths,
    checkStaleness: options.checkStaleness,
    requireFrontMatter: resolved.requireFrontMatter,
    backlogDir: resolved.backlogDir,
    packCorpus,
    focusPaths: resolved.files.map((file) => file.path),
  });
}

function loadRunFiles(
  options: RunBacklogLintOptions,
  cwd: string,
  backlogDir: string,
  fileMode: boolean,
): readonly BacklogLintFile[] {
  if (options.files !== undefined) return options.files;
  if (fileMode) return loadNamedMarkdownFiles(cwd, options.filePaths ?? []);
  return loadBacklogFiles(cwd, backlogDir);
}

function runValidatedBacklogLint(
  options: RunBacklogLintOptions,
  cwd: string,
  backlogDir: string,
  fileMode: boolean,
): BacklogLintResult {
  const files = loadRunFiles(options, cwd, backlogDir, fileMode);
  const requireFrontMatter = options.requireFrontMatter ?? (fileMode ? true : undefined);
  const resolved: ResolvedRun = { cwd, backlogDir, files, requireFrontMatter };
  if (fileMode) return fileModeCheck(options, resolved);
  return checkBacklogFiles({
    files,
    now: options.now,
    staleMonths: options.staleMonths,
    checkStaleness: options.checkStaleness,
    requireFrontMatter,
    backlogDir,
  });
}

export function runBacklogLint(options: RunBacklogLintOptions = {}): BacklogLintResult {
  const cwd = options.cwd ?? repoRoot;
  const backlogDir = options.backlogDir ?? DEFAULT_BACKLOG_DIR;
  const fileMode = options.fileMode ?? options.filePaths !== undefined;
  const invalidMessages =
    fileMode && options.files === undefined
      ? invalidNamedFileMessages(cwd, options.filePaths ?? [])
      : [];
  return invalidMessages.length > 0
    ? invalidNamedFilesResult(invalidMessages)
    : runValidatedBacklogLint(options, cwd, backlogDir, fileMode);
}

// A path value may not start with a dash (pinned: `--file --no-stale` fails).
// The walk itself already rejects `--`-prefixed values; this extends the
// rejection to single-dash values the way the pre-substrate parser did.
const cliPathValue = z.string().refine((value) => !value.startsWith("-"));

const cliOptionsSchema = z.object({
  "--no-stale": z.boolean().default(false),
  "--require-front-matter": z.boolean().default(false),
  "--stale-months": z
    .string()
    .regex(/^[1-9]\d*$/u)
    .transform(Number)
    .optional(),
  "--backlog-dir": cliPathValue.optional(),
  "--file": z.array(cliPathValue).default([]),
});

// Exported for the S0 characterization tests of arch-plans-2026-07 leaf 02;
// the CLI entrypoint below remains the only runtime caller. Contract (pinned):
// no help handling, bare `--` tokens skipped, no inline `--name=value` forms,
// and every parse problem collapses to `undefined` (the entrypoint prints the
// usage line to stderr and exits 2).
export function parseCliArgs(args: readonly string[]): CliOptions | undefined {
  try {
    const parsed = parseCli({
      argv: args.filter((arg) => arg !== "--"),
      usage: "",
      createError: (message) => new Error(message),
      options: [
        { name: "--no-stale", kind: "flag" },
        { name: "--require-front-matter", kind: "flag" },
        { name: "--stale-months", kind: "value", rejectInlineForm: true },
        { name: "--backlog-dir", kind: "value", rejectInlineForm: true },
        { name: "--file", kind: "value", repeatable: true, rejectInlineForm: true },
      ],
      schema: cliOptionsSchema,
    });
    if (parsed.positionals.length > 0) return undefined;
    const options: MutableCliOptions = {};
    if (parsed.options["--no-stale"]) options.checkStaleness = false;
    if (parsed.options["--require-front-matter"]) options.requireFrontMatter = true;
    const staleMonths = parsed.options["--stale-months"];
    if (staleMonths !== undefined) options.staleMonths = staleMonths;
    const backlogDir = parsed.options["--backlog-dir"];
    if (backlogDir !== undefined) options.backlogDir = backlogDir;
    const filePaths = parsed.options["--file"];
    if (filePaths.length > 0) options.filePaths = filePaths;
    return options;
  } catch {
    return undefined;
  }
}

const invokedPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (fileURLToPath(import.meta.url) === invokedPath) {
  const options = parseCliArgs(process.argv.slice(PROCESS_ARGV_USER_ARGS_START));
  if (options === undefined) {
    process.stderr.write(
      "usage: backlog-lint.ts [--backlog-dir <path>] [--file <path>]... [--stale-months <months>] [--no-stale] [--require-front-matter]\n",
    );
    process.exitCode = 2;
  } else {
    const result = runBacklogLint(options);
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  }
}
