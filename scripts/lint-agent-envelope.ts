import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
  type HarnessDiagnostics,
  type HarnessFinding,
  type HarnessFindingSeverity,
  summarizeHarnessFindings,
} from "../packages/shared/src/schemas/harness-diagnostics.js";
import type { ESLintFileResult, ESLintMessage } from "./lib/eslint-json.js";
import type { RuleDocsEntry } from "./lib/lint-rule-docs.js";
import { lintAgentHowToFixFor } from "./lint-agent-fix-text.js";

const ESLINT_SEVERITY_ERROR = 2;
const ESLINT_SEVERITY_WARN = 1;
const LOCAL_RULE_PREFIX = "local/";
const LINT_CONTROL_PREFIX = "lint/";
const PARSER_ERROR_CONTROL = "lint/parser-error";
// The schema tool id is stable; the preferred package script name is more explicit.
const ENVELOPE_TOOL = "lint:agent";

export const lintAgentRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface ParsedArgs {
  readonly patterns: readonly string[];
  readonly outputPath: string | undefined;
}

export interface LintAgentEnvelopeResult {
  readonly envelope: HarnessDiagnostics;
  readonly skippedNonLocal: number;
}

export function parseOutputOption(
  arg: string,
  args: readonly string[],
  index: number,
): { readonly outputPath: string; readonly nextIndex: number } | undefined {
  if (arg === "--output") {
    const valueIndex = index + 1;
    const value = args[valueIndex];
    if (!value || value.startsWith("--")) {
      throw new Error("--output requires a path argument");
    }
    return { outputPath: value, nextIndex: valueIndex + 1 };
  }
  if (!arg.startsWith("--output=")) return undefined;
  const value = arg.slice("--output=".length);
  if (value.length === 0) {
    throw new Error("--output= requires a non-empty path");
  }
  if (value.startsWith("--")) {
    throw new Error(`--output= requires a path argument, got: ${value}`);
  }
  return { outputPath: value, nextIndex: index + 1 };
}

export function parseArgs(args: readonly string[]): ParsedArgs {
  const patterns: string[] = [];
  let outputPath: string | undefined;
  let i = 0;
  while (i < args.length) {
    const arg = args[i] ?? "";
    if (arg === "--") {
      i += 1;
      continue;
    }
    const output = parseOutputOption(arg, args, i);
    if (output !== undefined) {
      outputPath = output.outputPath;
      i = output.nextIndex;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    patterns.push(arg);
    i += 1;
  }
  return { patterns, outputPath };
}

export function severityFromEslint(severity: number): HarnessFindingSeverity {
  if (severity === ESLINT_SEVERITY_ERROR) return "block";
  if (severity === ESLINT_SEVERITY_WARN) return "warn";
  return "info";
}

function relativePath(filePath: string): string {
  if (!isAbsolute(filePath)) return filePath;
  const rel = relative(lintAgentRepoRoot, filePath);
  return rel === "" ? filePath : rel;
}

export function buildParserErrorFinding(message: ESLintMessage, filePath: string): HarnessFinding {
  const path = relativePath(filePath);
  const base = {
    control: PARSER_ERROR_CONTROL,
    severity: "block",
    path,
    why: "ESLint could not parse this file, so no other rule could run against it.",
    howToFix: `Fix the syntax error reported by ESLint: ${message.message}`,
    repairKind: "manual",
  } as const;
  return message.line !== undefined ? { ...base, line: message.line } : base;
}

export function buildFinding(
  message: ESLintMessage,
  filePath: string,
  ruleDocs: ReadonlyMap<string, RuleDocsEntry>,
): HarnessFinding | undefined {
  const ruleId = message.ruleId;
  if (ruleId === null) {
    if (message.fatal === true || message.severity === ESLINT_SEVERITY_ERROR) {
      return buildParserErrorFinding(message, filePath);
    }
    return undefined;
  }
  if (!ruleId.startsWith(LOCAL_RULE_PREFIX)) return undefined;
  const entry = ruleDocs.get(ruleId);
  if (entry === undefined) return undefined;

  const control = `${LINT_CONTROL_PREFIX}${ruleId}`;
  const path = relativePath(filePath);
  const base = {
    control,
    severity: severityFromEslint(message.severity),
    path,
    ruleId,
    why: entry.principle,
    howToFix: lintAgentHowToFixFor(entry, message),
    repairKind: entry.repairKind,
  } as const;

  const withLocation = message.line !== undefined ? { ...base, line: message.line } : base;
  const withMessageId =
    message.messageId !== undefined
      ? { ...withLocation, messageId: message.messageId }
      : withLocation;
  const withRepair =
    entry.repairKind === "codemod" && entry.repairCommand !== undefined
      ? { ...withMessageId, repairCommand: entry.repairCommand }
      : withMessageId;
  return withRepair;
}

export function compareLintAgentFindings(a: HarnessFinding, b: HarnessFinding): number {
  const controlCompare = a.control.localeCompare(b.control);
  if (controlCompare !== 0) return controlCompare;
  const pathCompare = (a.path ?? "").localeCompare(b.path ?? "");
  if (pathCompare !== 0) return pathCompare;
  return (a.line ?? 0) - (b.line ?? 0);
}

export function buildLintAgentEnvelope(
  eslintResults: readonly ESLintFileResult[],
  ruleDocs: ReadonlyMap<string, RuleDocsEntry>,
): LintAgentEnvelopeResult {
  const findings: HarnessFinding[] = [];
  let skippedNonLocal = 0;
  for (const file of eslintResults) {
    for (const message of file.messages) {
      const finding = buildFinding(message, file.filePath, ruleDocs);
      if (finding === undefined) {
        if (message.ruleId !== null && !message.ruleId.startsWith(LOCAL_RULE_PREFIX)) {
          skippedNonLocal += 1;
        }
        continue;
      }
      findings.push(finding);
    }
  }
  findings.sort(compareLintAgentFindings);

  const envelope: HarnessDiagnostics = {
    version: HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
    tool: ENVELOPE_TOOL,
    findings,
    summary: summarizeHarnessFindings(findings),
  };
  return { envelope, skippedNonLocal };
}
