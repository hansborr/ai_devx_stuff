#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { writeEslintConfig } from "./lint-ratchet/eslint-config.js";
import type { LintRatchetConfig } from "./lint-ratchet/lint-ratchet-config.js";
import { repoRoot } from "./lint-ratchet/paths.js";

const PROCESS_ARGV_USER_ARGS_START = 2;
const PROBE_RULE_SOURCE_HASH = "lint-probe-rule";
const PROBE_CONFIG_DIRECTORY_PREFIX = "lint-probe-rule-";
const PROBE_FILES = ["**/*.{js,jsx,ts,tsx,mjs,cjs}"] as const;
const PROBE_IGNORES = ["**/dist/**", "**/generated/**", "**/node_modules/**"] as const;

interface ParsedProbeOptions {
  readonly ruleId: string;
  readonly files: readonly string[];
  readonly stdin: boolean;
  readonly filename: string | undefined;
}

interface LeadingProbeOptions {
  readonly stdin: boolean;
  readonly filename: string | undefined;
  readonly restStart: number;
}

type ParseResult =
  | { readonly kind: "ok"; readonly options: ParsedProbeOptions }
  | { readonly kind: "help" }
  | { readonly kind: "error"; readonly message: string };

type LeadingParseResult =
  | { readonly kind: "ok"; readonly options: LeadingProbeOptions }
  | { readonly kind: "help" }
  | { readonly kind: "error"; readonly message: string };

type FilenameParseResult =
  | { readonly kind: "ok"; readonly filename: string; readonly nextIndex: number }
  | { readonly kind: "error"; readonly message: string };

export interface LintProbeRuleCliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface LintProbeRuleCliOptions {
  readonly argv: readonly string[];
  readonly runEslint?: (args: readonly string[]) => number;
  readonly writeConfig?: (ratchet: LintRatchetConfig, ruleSourceHash: string) => string;
}

interface ProbeConfig {
  readonly path: string;
  readonly cleanup: () => void;
}

function usage(): string {
  return [
    "usage: bun run lint:probe-rule -- [--stdin --filename <path>] <local/rule-name> <file...>",
    "",
    "Runs exactly one local ESLint rule through the ratchet-generated flat config.",
  ].join("\n");
}

function parseFilenameFlag(argv: readonly string[], index: number): FilenameParseResult {
  const arg = argv[index];
  if (arg === "--filename") {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("-")) {
      return { kind: "error", message: "--filename requires a path argument" };
    }
    return { kind: "ok", filename: value, nextIndex: index + 1 };
  }
  const value = arg?.slice("--filename=".length) ?? "";
  if (value.length === 0) {
    return { kind: "error", message: "--filename requires a path argument" };
  }
  return { kind: "ok", filename: value, nextIndex: index };
}

function parseLeadingOptions(argv: readonly string[]): LeadingParseResult {
  let stdin = false;
  let filename: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (arg === "--help" || arg === "-h") return { kind: "help" };
    if (arg === "--stdin") {
      stdin = true;
      continue;
    }
    if (arg === "--filename" || arg.startsWith("--filename=")) {
      const parsedFilename = parseFilenameFlag(argv, index);
      if (parsedFilename.kind === "error") return parsedFilename;
      filename = parsedFilename.filename;
      index = parsedFilename.nextIndex;
      continue;
    }
    if (arg.startsWith("-")) {
      return { kind: "error", message: `unknown argument: ${arg}` };
    }
    return { kind: "ok", options: { stdin, filename, restStart: index } };
  }

  return { kind: "error", message: "missing local rule id" };
}

function parseRuleAndFiles(argv: readonly string[], leading: LeadingProbeOptions): ParseResult {
  const ruleId = argv[leading.restStart];
  if (ruleId === undefined) return { kind: "error", message: "missing local rule id" };
  if (!ruleId.startsWith("local/")) {
    return { kind: "error", message: `rule id must start with local/: ${ruleId}` };
  }
  const files = argv.slice(leading.restStart + 1);
  if (leading.stdin && files.length > 0) {
    return { kind: "error", message: "--stdin cannot be combined with positional files" };
  }
  if (leading.stdin && leading.filename === undefined) {
    return { kind: "error", message: "--stdin requires --filename <path>" };
  }
  if (!leading.stdin && files.length === 0) {
    return { kind: "error", message: "provide at least one file, or use --stdin --filename" };
  }

  return {
    kind: "ok",
    options: { ruleId, files, stdin: leading.stdin, filename: leading.filename },
  };
}

function parseArgs(argv: readonly string[]): ParseResult {
  const leading = parseLeadingOptions(argv);
  if (leading.kind !== "ok") return leading;
  return parseRuleAndFiles(argv, leading.options);
}

function probeRatchetFor(ruleId: string): LintRatchetConfig {
  return {
    id: `probe/${ruleId.replaceAll("/", "-")}`,
    ruleId,
    files: PROBE_FILES,
    ignores: PROBE_IGNORES,
    ruleOptions: [],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
    principle: "Probe a single local ESLint rule without the rest of the repo flat config.",
  } satisfies LintRatchetConfig;
}

function eslintArgs(configPath: string, options: ParsedProbeOptions): readonly string[] {
  const baseArgs = [
    "--no-config-lookup",
    "--no-error-on-unmatched-pattern",
    "--config",
    configPath,
  ];
  if (options.stdin) {
    return [...baseArgs, "--stdin", "--stdin-filename", options.filename ?? ""];
  }
  return [...baseArgs, ...options.files];
}

function defaultRunEslint(args: readonly string[]): number {
  const result = spawnSync(resolve(repoRoot, "node_modules/.bin/eslint"), args, {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  return result.status ?? 1;
}

function writeTemporaryProbeConfig(
  ratchet: LintRatchetConfig,
  ruleSourceHash: string,
): ProbeConfig {
  const cacheDirectory = resolve(repoRoot, "node_modules/.cache");
  mkdirSync(cacheDirectory, { recursive: true });
  const configDirectory = mkdtempSync(join(cacheDirectory, PROBE_CONFIG_DIRECTORY_PREFIX));
  try {
    return {
      path: writeEslintConfig(ratchet, ruleSourceHash, { configDirectory }),
      cleanup: () => {
        rmSync(configDirectory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(configDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function runLintProbeRuleCli(options: LintProbeRuleCliOptions): LintProbeRuleCliResult {
  const parsed = parseArgs(options.argv);
  if (parsed.kind === "help") return { exitCode: 0, stdout: `${usage()}\n`, stderr: "" };
  if (parsed.kind === "error") {
    return { exitCode: 2, stdout: "", stderr: `lint:probe-rule: ${parsed.message}\n${usage()}\n` };
  }

  const runEslint = options.runEslint ?? defaultRunEslint;
  const ratchet = probeRatchetFor(parsed.options.ruleId);
  const config =
    options.writeConfig === undefined
      ? writeTemporaryProbeConfig(ratchet, PROBE_RULE_SOURCE_HASH)
      : { path: options.writeConfig(ratchet, PROBE_RULE_SOURCE_HASH), cleanup: () => {} };
  try {
    return { exitCode: runEslint(eslintArgs(config.path, parsed.options)), stdout: "", stderr: "" };
  } finally {
    config.cleanup();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runLintProbeRuleCli({ argv: process.argv.slice(PROCESS_ARGV_USER_ARGS_START) });
  if (result.stdout.length > 0) process.stdout.write(result.stdout);
  if (result.stderr.length > 0) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
