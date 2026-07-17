import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { evaluateLintMessageTrace } from "./lint-message-eval/evaluator.js";
import { formatLintMessageEvalMarkdown } from "./lint-message-eval/reporter.js";

interface ParsedArgs {
  readonly tracePath: string;
  readonly markdownPath: string;
  readonly jsonPath: string;
}

const DEFAULT_TRACE = "scripts/fixtures/lint-message-eval/2026-07-15-codex-pilot.json";
const DEFAULT_MARKDOWN = "reports/lint-message-eval/latest.md";
const DEFAULT_JSON = "reports/lint-message-eval/latest.json";
const PROCESS_ARG_OFFSET = 2;
const JSON_INDENT = 2;
const INFRASTRUCTURE_ERROR_EXIT = 2;

function optionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires a path`);
  }
  return value;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  let tracePath = DEFAULT_TRACE;
  let markdownPath = DEFAULT_MARKDOWN;
  let jsonPath = DEFAULT_JSON;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) throw new Error("Argument parsing reached an invalid index");
    if (arg === "--trace") tracePath = optionValue(args, index++, arg);
    else if (arg === "--output") markdownPath = optionValue(args, index++, arg);
    else if (arg === "--json-output") jsonPath = optionValue(args, index++, arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { tracePath, markdownPath, jsonPath };
}

function writeOutput(path: string, contents: string): void {
  const absolutePath = resolve(path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, "utf8");
}

function main(): void {
  const args = parseArgs(process.argv.slice(PROCESS_ARG_OFFSET));
  const input: unknown = JSON.parse(readFileSync(resolve(args.tracePath), "utf8"));
  const result = evaluateLintMessageTrace(input);
  writeOutput(args.markdownPath, formatLintMessageEvalMarkdown(result));
  writeOutput(args.jsonPath, `${JSON.stringify(result, null, JSON_INDENT)}\n`);
  console.log(
    `lint-message-eval: ${String(result.summary.fixtureCount)} fixtures; wrote ${args.markdownPath} and ${args.jsonPath}`,
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`lint-message-eval: ${message}`);
  process.exitCode = INFRASTRUCTURE_ERROR_EXIT;
}
