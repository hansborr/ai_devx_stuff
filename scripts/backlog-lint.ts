import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkBacklogFiles } from "./backlog-lint-core.js";
import type { BacklogLintFile, BacklogLintResult } from "./backlog-lint-types.js";

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
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BACKLOG_DIR = "docs/agent_notes/backlog";
const PROCESS_ARGV_USER_ARGS_START = 2;

function listBacklogMarkdownFiles(cwd: string, backlogDir: string): string[] {
  const output = execFileSync("git", ["ls-files", `${backlogDir}/**/*.md`, `${backlogDir}/*.md`], {
    cwd,
    encoding: "utf8",
  });
  return output
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .sort();
}

function loadBacklogFiles(cwd: string, backlogDir: string): BacklogLintFile[] {
  return listBacklogMarkdownFiles(cwd, backlogDir).map((path) => ({
    path,
    text: readFileSync(resolve(cwd, path), "utf8"),
  }));
}

export function runBacklogLint(options: RunBacklogLintOptions = {}): BacklogLintResult {
  const cwd = options.cwd ?? repoRoot;
  const backlogDir = options.backlogDir ?? DEFAULT_BACKLOG_DIR;
  const files = options.files ?? loadBacklogFiles(cwd, backlogDir);
  return checkBacklogFiles({
    files,
    now: options.now,
    staleMonths: options.staleMonths,
    checkStaleness: options.checkStaleness,
    requireFrontMatter: options.requireFrontMatter,
  });
}

function parsePositiveInteger(value: string): number | undefined {
  if (!/^[1-9]\d*$/u.test(value)) return undefined;
  return Number(value);
}

function parseStaleMonths(args: readonly string[], index: number): number | undefined {
  const value = args[index + 1];
  return value === undefined ? undefined : parsePositiveInteger(value);
}

function parseBacklogDir(args: readonly string[], index: number): string | undefined {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("-")) return undefined;
  return value;
}

function parseCliArgs(args: readonly string[]): CliOptions | undefined {
  const options: {
    backlogDir?: string;
    staleMonths?: number;
    checkStaleness?: boolean;
    requireFrontMatter?: boolean;
  } = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--") continue;
    if (arg === "--no-stale") {
      options.checkStaleness = false;
    } else if (arg === "--require-front-matter") {
      options.requireFrontMatter = true;
    } else if (arg === "--stale-months") {
      const staleMonths = parseStaleMonths(args, index);
      if (staleMonths === undefined) return undefined;
      options.staleMonths = staleMonths;
      index += 1;
    } else if (arg === "--backlog-dir") {
      const backlogDir = parseBacklogDir(args, index);
      if (backlogDir === undefined) return undefined;
      options.backlogDir = backlogDir;
      index += 1;
    } else {
      return undefined;
    }
  }
  return options;
}

const invokedPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (fileURLToPath(import.meta.url) === invokedPath) {
  const options = parseCliArgs(process.argv.slice(PROCESS_ARGV_USER_ARGS_START));
  if (options === undefined) {
    process.stderr.write(
      "usage: backlog-lint.ts [--backlog-dir <path>] [--stale-months <months>] [--no-stale] [--require-front-matter]\n",
    );
    process.exitCode = 2;
  } else {
    const result = runBacklogLint(options);
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  }
}
