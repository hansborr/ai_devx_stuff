import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
  type HarnessDiagnostics,
  type HarnessFinding,
  type HarnessFindingRepairKind,
  type HarnessFindingSeverity,
  summarizeHarnessFindings,
} from "@musi/harness-diagnostics/schema.js";

import type { ESLintFileResult, ESLintMessage } from "./lib/eslint-json.js";
import type { RuleDocsEntry } from "./lib/lint-rule-docs.js";
import { lintAgentHowToFixFor } from "./lint-agent-fix-text.js";
import {
  LINT_AGENT_GUIDANCE_OVERLAYS,
  type LintAgentGuidanceOverlay,
  lintAgentGuidanceOverlayFor,
  type LintAgentRuleGuidanceOverlay,
} from "./lint-agent-guidance.js";

const ESLINT_SEVERITY_ERROR = 2;
const ESLINT_SEVERITY_WARN = 1;
const LOCAL_RULE_PREFIX = "local/";
const LINT_CONTROL_PREFIX = "lint/";
const PARSER_ERROR_CONTROL = "lint/parser-error";
const SKIPPED_NON_LOCAL_CONTROL = "lint/skipped-non-local";
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
    howToFix: `Fix the syntax error reported by ESLint: ${message.message}. If this file should not be parsed as TypeScript, check \`node_modules/.bin/eslint --print-config ${path}\`.`,
    repairKind: "manual",
  } as const;
  return message.line !== undefined ? { ...base, line: message.line } : base;
}

export function buildFinding(
  message: ESLintMessage,
  filePath: string,
  ruleDocs: ReadonlyMap<string, RuleDocsEntry>,
  guidanceOverlays: ReadonlyMap<
    string,
    LintAgentRuleGuidanceOverlay
  > = LINT_AGENT_GUIDANCE_OVERLAYS,
): HarnessFinding | undefined {
  const ruleId = message.ruleId;
  if (ruleId === null)
    return message.fatal === true || message.severity === ESLINT_SEVERITY_ERROR
      ? buildParserErrorFinding(message, filePath)
      : undefined;
  if (!ruleId.startsWith(LOCAL_RULE_PREFIX)) {
    const overlay = lintAgentGuidanceOverlayFor(ruleId, message.messageId, guidanceOverlays);
    return overlay === undefined
      ? undefined
      : buildOverlaidFinding(message, filePath, ruleId, overlay);
  }

  const entry = ruleDocs.get(ruleId);
  if (entry === undefined) return undefined;
  return buildLocalFinding(message, filePath, ruleId, entry);
}

interface FindingIdentity {
  readonly control: string;
  readonly ruleId: string;
  readonly severity: HarnessFindingSeverity;
}

interface ResolvedFindingGuidance {
  readonly why: string;
  readonly howToFix: string;
  readonly repairKind: HarnessFindingRepairKind;
  readonly repairCommand?: string;
}

function assembleFinding(
  message: ESLintMessage,
  filePath: string,
  identity: FindingIdentity,
  guidance: ResolvedFindingGuidance,
): HarnessFinding {
  const base = {
    ...identity,
    path: relativePath(filePath),
    why: guidance.why,
    howToFix: guidance.howToFix,
    repairKind: guidance.repairKind,
  } as const;
  const withLocation = message.line !== undefined ? { ...base, line: message.line } : base;
  const withMessageId =
    message.messageId !== undefined
      ? { ...withLocation, messageId: message.messageId }
      : withLocation;
  return guidance.repairKind === "codemod" && guidance.repairCommand !== undefined
    ? { ...withMessageId, repairCommand: guidance.repairCommand }
    : withMessageId;
}

function buildLocalFinding(
  message: ESLintMessage,
  filePath: string,
  ruleId: string,
  entry: RuleDocsEntry,
): HarnessFinding {
  return assembleFinding(
    message,
    filePath,
    {
      control: `${LINT_CONTROL_PREFIX}${ruleId}`,
      severity: severityFromEslint(message.severity),
      ruleId,
    },
    {
      why: entry.principle,
      howToFix: lintAgentHowToFixFor(entry, message),
      repairKind: entry.repairKind,
      repairCommand: entry.repairCommand,
    },
  );
}

function buildOverlaidFinding(
  message: ESLintMessage,
  filePath: string,
  ruleId: string,
  overlay: LintAgentGuidanceOverlay,
): HarnessFinding {
  return assembleFinding(
    message,
    filePath,
    {
      control: `${LINT_CONTROL_PREFIX}${ruleId}`,
      severity: severityFromEslint(message.severity),
      ruleId,
    },
    overlay,
  );
}

function buildSkippedNonLocalFinding(
  message: ESLintMessage,
  filePath: string,
): HarnessFinding | undefined {
  const ruleId = message.ruleId;
  if (ruleId === null || ruleId.startsWith(LOCAL_RULE_PREFIX)) return undefined;
  return assembleFinding(
    message,
    filePath,
    { control: SKIPPED_NON_LOCAL_CONTROL, severity: "info", ruleId },
    {
      why: "Non-local ESLint rule; no structured local-rule metadata is available.",
      howToFix: "Run `bun run lint` for the full ESLint report and fix this finding there.",
      repairKind: "manual",
    },
  );
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
  guidanceOverlays: ReadonlyMap<
    string,
    LintAgentRuleGuidanceOverlay
  > = LINT_AGENT_GUIDANCE_OVERLAYS,
): LintAgentEnvelopeResult {
  const findings: HarnessFinding[] = [];
  let skippedNonLocal = 0;
  for (const file of eslintResults) {
    for (const message of file.messages) {
      const finding = buildFinding(message, file.filePath, ruleDocs, guidanceOverlays);
      if (finding === undefined) {
        const skippedFinding = buildSkippedNonLocalFinding(message, file.filePath);
        if (skippedFinding !== undefined) {
          skippedNonLocal += 1;
          findings.push(skippedFinding);
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
