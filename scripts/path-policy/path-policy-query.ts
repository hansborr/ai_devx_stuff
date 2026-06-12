import { readFileSync } from "node:fs";

import {
  formatPathPolicyOutput,
  isPathPolicyQueryName,
  parsePathPolicyInput,
  PATH_POLICY_QUERY_NAMES,
  queryPathPolicy,
} from "./path-policy-query-core.js";

export interface PathPolicyQueryCliOptions {
  readonly argv: readonly string[];
  readonly stdin: string;
}

export interface PathPolicyQueryCliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const usageErrorExitCode = 2;
const nodeArgvUserArgumentOffset = 2;

const usage = (): string =>
  [
    "usage: bun scripts/path-policy/path-policy-query.ts <query>",
    "",
    "Reads NUL-delimited paths from stdin and writes matching records as NUL-delimited stdout.",
    "Queries:",
    ...PATH_POLICY_QUERY_NAMES.map((name) => `  ${name}`),
  ].join("\n");

export const runPathPolicyQueryCli = ({
  argv,
  stdin,
}: PathPolicyQueryCliOptions): PathPolicyQueryCliResult => {
  const [query, unexpected] = argv;

  if (query === undefined || query === "--help" || query === "-h") {
    return {
      exitCode: query === undefined ? usageErrorExitCode : 0,
      stdout: `${usage()}\n`,
      stderr: "",
    };
  }

  if (unexpected !== undefined) {
    return {
      exitCode: usageErrorExitCode,
      stdout: "",
      stderr: `path-policy-query: unexpected argument: ${unexpected}\n${usage()}\n`,
    };
  }

  if (!isPathPolicyQueryName(query)) {
    return {
      exitCode: usageErrorExitCode,
      stdout: "",
      stderr: `path-policy-query: unsupported query: ${query}\n${usage()}\n`,
    };
  }

  const paths = parsePathPolicyInput(stdin);
  return {
    exitCode: 0,
    stdout: formatPathPolicyOutput(queryPathPolicy(query, paths)),
    stderr: "",
  };
};

if (import.meta.main) {
  const result = runPathPolicyQueryCli({
    argv: process.argv.slice(nodeArgvUserArgumentOffset),
    stdin: readFileSync(0, "utf8"),
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
