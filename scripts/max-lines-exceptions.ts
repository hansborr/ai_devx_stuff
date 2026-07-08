#!/usr/bin/env bun
// CLI for the max-lines per-file cap exceptions baseline
// (eslint-config/max-lines-exceptions.baseline.json). Default mode checks the
// committed baseline is normalized and framework-valid; --update re-derives the
// summary and re-sorts after a hand edit. eslint-config/shared-policy.js reads
// the same JSON directly at config-load time.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  checkMaxLinesExceptionsBaseline,
  formatMaxLinesExceptionsBaseline,
  parseMaxLinesEntriesForUpdate,
} from "./max-lines-exceptions-core.js";

const PROCESS_ARGV_USER_ARGS_START = 2;
const DEFAULT_BASELINE_RELATIVE = "eslint-config/max-lines-exceptions.baseline.json";

function repoRootFromModule(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export type MaxLinesExceptionsCliResult = {
  readonly exitCode: number;
  readonly stdout: string;
};

export function runMaxLinesExceptionsCli(options: {
  readonly argv: readonly string[];
  readonly baselinePath: string;
}): MaxLinesExceptionsCliResult {
  const update = options.argv.includes("--update");
  const { baselinePath } = options;

  if (!existsSync(baselinePath)) {
    return {
      exitCode: 2,
      stdout: `ERROR: baseline missing at ${baselinePath}; restore eslint-config/max-lines-exceptions.baseline.json`,
    };
  }
  const text = readFileSync(baselinePath, "utf8");

  if (update) {
    const parsed = parseMaxLinesEntriesForUpdate(text);
    if (!parsed.ok) return { exitCode: 2, stdout: `ERROR: ${parsed.error}` };
    const formatted = formatMaxLinesExceptionsBaseline(parsed.value);
    writeFileSync(baselinePath, formatted);
    return {
      exitCode: 0,
      stdout: `max-lines-exceptions -- normalized ${String(parsed.value.length)} exception(s)`,
    };
  }

  const check = checkMaxLinesExceptionsBaseline(text);
  if (!check.ok) return { exitCode: 2, stdout: `ERROR: ${check.error}` };
  return { exitCode: 0, stdout: "OK: max-lines exceptions baseline is normalized and valid" };
}

function isCliEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isCliEntrypoint()) {
  const result = runMaxLinesExceptionsCli({
    argv: process.argv.slice(PROCESS_ARGV_USER_ARGS_START),
    baselinePath: resolve(repoRootFromModule(), DEFAULT_BASELINE_RELATIVE),
  });
  if (result.stdout) console.log(result.stdout);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
