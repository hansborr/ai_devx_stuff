#!/usr/bin/env bun
// mutation-targets — resolve a Stryker lane's mutate globs to concrete files.
//
// Reads NUL-delimited candidate paths on stdin and writes back the subset the
// lane's `mutate` globs — or the `--mutate` override, which Stryker's own CLI
// takes over the config's — select, NUL-delimited. It is the glob-resolution half
// of scripts/mutation-run.sh: the runner feeds it `git ls-files` output to
// learn which tracked files an in-place lane will mutate, and feeds it
// `git ls-files --others` to learn which *untracked* files it would mutate
// unrecoverably.
//
// Exit codes: 0 success, 2 CLI misuse or an unloadable lane config, and — only
// under --require-in-place — 3 for a lane that runs in Stryker's copied sandbox
// and therefore needs none of the runner's worktree rails. The sandboxed answer
// is decided before `mutate` is read, so a config that leans on Stryker's own
// default `mutate` still runs through the runner exactly as `stryker run` would.

import { readFileSync } from "node:fs";

import { z } from "zod";

import { parseCli } from "./lib/cli.js";
import { errorMessage } from "./lib/error-message.js";
import {
  findDefaultStrykerConfigFile,
  formatCandidatePaths,
  loadMutationLane,
  parseCandidatePaths,
  parseMutateOverride,
  selectMutateTargets,
} from "./lib/mutation-targets.js";
import { isCliEntrypoint, PROCESS_ARGV_USER_ARGS_START } from "./lib/process-argv.js";

const USAGE_ERROR_EXIT_CODE = 2;
const SANDBOXED_LANE_EXIT_CODE = 3;

function usage(): string {
  return [
    "Usage:",
    "  bun scripts/mutation-targets.ts [--config <file>] [--mutate <globs>] [--require-in-place]",
    "",
    "Reads NUL-delimited candidate paths from stdin and writes the",
    "subset selected by the Stryker lane's mutate globs as NUL-delimited stdout.",
    "",
    "  --config <file>      lane config to import; default is Stryker's own",
    "                       config-file lookup in the current directory.",
    "  --mutate <globs>     comma-separated globs that replace the config's",
    "                       mutate, exactly as `stryker run --mutate` does.",
    "  --require-in-place   exit 3 with no output when the lane is not inPlace.",
  ].join("\n");
}

class MutationTargetsHelp extends Error {
  constructor() {
    super(usage());
    this.name = "MutationTargetsHelp";
  }
}

class MutationTargetsCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MutationTargetsCliError";
  }
}

export interface MutationTargetsCliOptions {
  readonly argv: readonly string[];
  /**
   * Read the NUL-delimited candidate list. A thunk, not a string, so nothing
   * blocks on stdin before argv is parsed: the entrypoint's reader blocks until
   * EOF, which would hang `--help` and every usage-error path when this CLI is
   * run from a terminal instead of the runner's pipe. Same guard as
   * `subcommandReadsStdin` in scripts/lib/verify-metadata-core.ts.
   */
  readonly readStdin: () => string;
  readonly cwd: string;
}

export interface MutationTargetsCliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface ParsedMutationTargetsCli {
  readonly config: string | undefined;
  readonly mutate: string | undefined;
  readonly requireInPlace: boolean;
}

function parseArgv(argv: readonly string[]): ParsedMutationTargetsCli {
  const parsed = parseCli({
    argv,
    usage: usage(),
    createError: (message) => new MutationTargetsCliError(message),
    allowEmptyArgs: true,
    rejectPositionals: true,
    onHelp: () => {
      throw new MutationTargetsHelp();
    },
    options: [
      { name: "--config", kind: "value" },
      { name: "--mutate", kind: "value" },
      { name: "--require-in-place", kind: "flag" },
    ],
    schema: z.object({
      "--config": z.string().optional(),
      "--mutate": z.string().optional(),
      "--require-in-place": z.literal(true).optional(),
    }),
  });
  return {
    config: parsed.options["--config"],
    mutate: parsed.options["--mutate"],
    requireInPlace: parsed.options["--require-in-place"] === true,
  };
}

/** Run the CLI over injected argv/stdin/cwd and return its exit code and streams. */
export async function runMutationTargetsCli({
  argv,
  readStdin,
  cwd,
}: MutationTargetsCliOptions): Promise<MutationTargetsCliResult> {
  let parsed: ParsedMutationTargetsCli;
  try {
    parsed = parseArgv(argv);
  } catch (error) {
    if (error instanceof MutationTargetsHelp) {
      return { exitCode: 0, stdout: `${error.message}\n`, stderr: "" };
    }
    return {
      exitCode: USAGE_ERROR_EXIT_CODE,
      stdout: "",
      stderr: `mutation-targets: ${errorMessage(error)}\n`,
    };
  }

  const configFile = parsed.config ?? findDefaultStrykerConfigFile(cwd);
  if (configFile === undefined) {
    return {
      exitCode: USAGE_ERROR_EXIT_CODE,
      stdout: "",
      stderr: "mutation-targets: no Stryker config file found; pass --config <file>.\n",
    };
  }

  try {
    const lane = await loadMutationLane(configFile, cwd);
    if (parsed.requireInPlace && !lane.inPlace) {
      return { exitCode: SANDBOXED_LANE_EXIT_CODE, stdout: "", stderr: "" };
    }
    // The override wins over the config the way Stryker's own CLI does, so the
    // rails preflight the set the run will actually mutate rather than the
    // config's — an override that widens the scope would otherwise slip past
    // preflight entirely.
    const mutate = parsed.mutate === undefined ? lane.mutate : parseMutateOverride(parsed.mutate);
    if (mutate === undefined) {
      return {
        exitCode: USAGE_ERROR_EXIT_CODE,
        stdout: "",
        stderr:
          `mutation-targets: Stryker lane config "${configFile}" declares no "mutate" globs, ` +
          `so the in-place rails have no target scope to preflight.\n`,
      };
    }
    const targets = selectMutateTargets(parseCandidatePaths(readStdin()), mutate, cwd);
    return { exitCode: 0, stdout: formatCandidatePaths(targets), stderr: "" };
  } catch (error) {
    return {
      exitCode: USAGE_ERROR_EXIT_CODE,
      stdout: "",
      stderr: `mutation-targets: ${errorMessage(error)}\n`,
    };
  }
}

if (isCliEntrypoint(import.meta.url)) {
  const result = await runMutationTargetsCli({
    argv: process.argv.slice(PROCESS_ARGV_USER_ARGS_START),
    readStdin: () => readFileSync(0, "utf8"),
    cwd: process.cwd(),
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
