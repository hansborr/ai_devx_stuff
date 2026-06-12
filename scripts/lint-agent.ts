// Emits an agent-facing JSON envelope of local/* ESLint diagnostics for the
// PR 3 machine-readable diagnostics contract (see
// packages/shared/src/schemas/harness-diagnostics.ts).
//
// Local rule metadata is re-projected from each rule's meta.docs (PR 1
// contract) so the envelope is self-contained: each finding carries its
// manifest control id, severity, repair kind, and (for codemod rules)
// repair command. Non-local findings are counted on stderr and skipped —
// they have no structured metadata to surface.

import { spawn } from "node:child_process";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
  type HarnessDiagnostics,
  harnessDiagnosticsSchema,
  type HarnessFinding,
  type HarnessFindingSeverity,
  summarizeHarnessFindings,
} from "../packages/shared/src/schemas/harness-diagnostics.js";
import {
  formatRuleDocsFailures,
  loadLintRuleDocs,
  type RuleDocsEntry,
} from "./lib/lint-rule-docs.js";
import { lintAgentHowToFixFor } from "./lint-agent-fix-text.js";

const PROCESS_ARG_OFFSET = 2;
const JSON_INDENT_SPACES = 2;
const ESLINT_SEVERITY_ERROR = 2;
const ESLINT_SEVERITY_WARN = 1;
const LOCAL_RULE_PREFIX = "local/";
const LINT_CONTROL_PREFIX = "lint/";
const PARSER_ERROR_CONTROL = "lint/parser-error";
// The schema tool id is stable; the preferred package script name is more explicit.
const ENVELOPE_TOOL = "lint:agent";
const DISPLAY_COMMAND = "lint:agent:local-rules";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface ESLintMessage {
  readonly ruleId: string | null;
  readonly severity: number;
  readonly message: string;
  readonly messageId?: string;
  readonly line?: number;
  readonly column?: number;
  readonly fatal?: boolean;
  readonly fix?: unknown;
  readonly suggestions?: readonly unknown[];
}

interface ESLintFileResult {
  readonly filePath: string;
  readonly messages: readonly ESLintMessage[];
}

interface ParsedArgs {
  readonly patterns: readonly string[];
  readonly outputPath: string | undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseOutputOption(
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

function parseArgs(args: readonly string[]): ParsedArgs {
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

function severityFromEslint(severity: number): HarnessFindingSeverity {
  if (severity === ESLINT_SEVERITY_ERROR) return "block";
  if (severity === ESLINT_SEVERITY_WARN) return "warn";
  return "info";
}

function relativePath(filePath: string): string {
  if (!isAbsolute(filePath)) return filePath;
  const rel = relative(repoRoot, filePath);
  return rel === "" ? filePath : rel;
}

function buildParserErrorFinding(message: ESLintMessage, filePath: string): HarnessFinding {
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

function buildFinding(
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

function isEslintMessage(value: unknown): value is ESLintMessage {
  if (!isObject(value)) return false;
  if (typeof value.severity !== "number") return false;
  if (typeof value.message !== "string") return false;
  return true;
}

function parseEslintOutput(stdout: string): readonly ESLintFileResult[] {
  if (stdout.trim().length === 0) return [];
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new Error("ESLint --format=json output is not an array");
  }
  const results: ESLintFileResult[] = [];
  for (const entry of parsed) {
    if (!isObject(entry)) continue;
    if (typeof entry.filePath !== "string") continue;
    if (!Array.isArray(entry.messages)) continue;
    const messages: ESLintMessage[] = [];
    for (const raw of entry.messages) {
      if (isEslintMessage(raw)) messages.push(raw);
    }
    results.push({ filePath: entry.filePath, messages });
  }
  return results;
}

async function runEslint(patterns: readonly string[]): Promise<string> {
  const args = [
    "--format=json",
    "--no-error-on-unmatched-pattern",
    "--cache",
    "--cache-location",
    "node_modules/.cache/eslint/",
    ...(patterns.length > 0 ? patterns : ["."]),
  ];

  return new Promise((resolveOutput, rejectOutput) => {
    const child = spawn(resolve(repoRoot, "node_modules/.bin/eslint"), args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", rejectOutput);
    child.on("close", () => {
      if (stdout.trim().length === 0 && stderr.trim().length > 0) {
        rejectOutput(new Error(`ESLint produced no JSON output. stderr:\n${stderr}`));
        return;
      }
      resolveOutput(stdout);
    });
  });
}

async function buildEnvelope(patterns: readonly string[]): Promise<{
  readonly envelope: HarnessDiagnostics;
  readonly skippedNonLocal: number;
}> {
  const { entries, failures } = await loadLintRuleDocs(repoRoot);
  if (failures.length > 0) {
    throw new Error(formatRuleDocsFailures(failures));
  }
  const ruleDocs = new Map<string, RuleDocsEntry>(entries.map((entry) => [entry.id, entry]));

  const stdout = await runEslint(patterns);
  const eslintResults = parseEslintOutput(stdout);

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
  findings.sort((a, b) => {
    const controlCompare = a.control.localeCompare(b.control);
    if (controlCompare !== 0) return controlCompare;
    const pathCompare = (a.path ?? "").localeCompare(b.path ?? "");
    if (pathCompare !== 0) return pathCompare;
    return (a.line ?? 0) - (b.line ?? 0);
  });

  const envelope: HarnessDiagnostics = {
    version: HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
    tool: ENVELOPE_TOOL,
    findings,
    summary: summarizeHarnessFindings(findings),
  };
  return { envelope, skippedNonLocal };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(PROCESS_ARG_OFFSET));
  const { envelope, skippedNonLocal } = await buildEnvelope(args.patterns);

  const parseResult = harnessDiagnosticsSchema.safeParse(envelope);
  if (!parseResult.success) {
    const issues = JSON.stringify(parseResult.error.issues, null, JSON_INDENT_SPACES);
    throw new Error(
      `${DISPLAY_COMMAND} produced an envelope that failed schema validation:\n${issues}`,
    );
  }

  const rendered = `${JSON.stringify(envelope, null, JSON_INDENT_SPACES)}\n`;
  if (args.outputPath !== undefined) {
    const outPath = isAbsolute(args.outputPath)
      ? args.outputPath
      : resolve(process.cwd(), args.outputPath);
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, rendered);
  } else {
    process.stdout.write(rendered);
  }

  const skippedNote =
    skippedNonLocal > 0
      ? ` (skipped ${String(skippedNonLocal)} non-local finding(s) — see \`bun run lint\` for the full view)`
      : "";
  console.error(
    `${DISPLAY_COMMAND} OK — ${String(envelope.findings.length)} finding(s); ` +
      `blocking=${String(envelope.summary.blocking)} ` +
      `warning=${String(envelope.summary.warning)} ` +
      `info=${String(envelope.summary.info)}${skippedNote}`,
  );

  if (envelope.summary.blocking > 0) {
    process.exitCode = 1;
  }
}

await main();
