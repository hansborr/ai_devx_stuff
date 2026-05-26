import path from "node:path";

import { fail } from "./errors.js";
import type { CliArgs } from "./types.js";

type CliTokens = {
  all: boolean;
  check: boolean;
  positional: string[];
};

const CHECK_USAGE = "Usage: bun run codemod:concurrency-guard -- --check";
const ALL_USAGE = "Usage: bun run codemod:concurrency-guard -- --all";
const SINGLE_USAGE = "Usage: bun run codemod:concurrency-guard -- --check | --all | <file>";

function parseCliArg(tokens: CliTokens, arg: string): void {
  if (!arg) fail("Empty arguments are not supported.");
  if (arg === "--all") {
    tokens.all = true;
    return;
  }
  if (arg === "--check") {
    tokens.check = true;
    return;
  }
  if (arg.startsWith("-")) fail(`Unknown argument: ${arg}`);
  tokens.positional.push(arg);
}

function readCliTokens(args: string[]): CliTokens {
  const tokens: CliTokens = { all: false, check: false, positional: [] };
  for (const arg of args) parseCliArg(tokens, arg);
  return tokens;
}

function checkModeArgs(tokens: CliTokens): CliArgs {
  if (tokens.all || tokens.positional.length !== 0) fail(CHECK_USAGE);
  return { mode: "check" };
}

function allModeArgs(tokens: CliTokens): CliArgs {
  if (tokens.positional.length !== 0) fail(ALL_USAGE);
  return { mode: "all" };
}

function singleModeArgs(tokens: CliTokens): CliArgs {
  if (tokens.positional.length !== 1) fail(SINGLE_USAGE);
  const [file] = tokens.positional;
  if (!file) fail("File argument is required.");
  return { mode: "single", file };
}

export function parseArgs(args: string[]): CliArgs {
  const tokens = readCliTokens(args);
  if (tokens.check) return checkModeArgs(tokens);
  if (tokens.all) return allModeArgs(tokens);
  return singleModeArgs(tokens);
}

export function normalizeRelativePath(root: string, filePath: string): string {
  const absolute = path.resolve(root, filePath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail("File must be inside the current repository.");
  }
  if (!relative.endsWith(".ts")) fail("File must be a .ts file.");
  return relative;
}
