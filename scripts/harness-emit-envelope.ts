import { isAbsolute, resolve } from "node:path";

import {
  HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
  type HarnessDiagnostics,
  harnessDiagnosticsSchema,
  type HarnessFinding,
  harnessFindingSchema,
  summarizeHarnessFindings,
} from "../packages/shared/src/schemas/harness-diagnostics.js";
import { ensureDirWriteFileAtomicallySync } from "./lib/atomic-write.js";

const PROCESS_ARG_OFFSET = 2;
const OPTION_WITH_VALUE_ARG_SPAN = 2;
const JSON_INDENT_SPACES = 2;

// The shared envelope schema treats `tool` as any non-empty string (a permissive
// transport). This CLI is the Musi-side gate: it restricts producers to Musi's
// closed inventory of harness tool ids so a typo fails loudly at emit time
// rather than flowing an unknown tool into the aggregated audit. (Kept as a
// plain tuple rather than a Zod enum because the scripts project does not depend
// on Zod directly — the shared schema is the only Zod boundary the CLI crosses.)
const MUSI_HARNESS_TOOLS = [
  "doctor",
  "verify:logs",
  "module:index:check",
  "migration-safety-scan",
  "lint:agent",
  "lint:ratchet",
  "drift:ai",
  "logs:audit",
  "harness:audit",
] as const;

type MusiHarnessTool = (typeof MUSI_HARNESS_TOOLS)[number];

function isMusiHarnessTool(value: string): value is MusiHarnessTool {
  return MUSI_HARNESS_TOOLS.some((tool) => tool === value);
}

class UsageError extends Error {}

interface ParsedArgs {
  readonly tool: MusiHarnessTool;
  readonly outputPath: string | undefined;
}

function usage(): string {
  return [
    "usage: bun scripts/harness-emit-envelope.ts --tool <tool> [--output <path>]",
    "",
    "Reads newline-delimited JSON findings from stdin and writes a",
    "harness-diagnostics envelope (validated against the shared schema) to",
    "stdout, or to --output if given. Blank stdin emits an empty envelope.",
  ].join("\n");
}

function requireToolValue(raw: string | undefined, source: "--tool" | "--tool="): string {
  if (raw === undefined || raw === "") {
    const value = source === "--tool=" ? "a non-empty tool id" : "a tool id";
    throw new UsageError(`${source} requires ${value}`);
  }
  if (raw.startsWith("--")) {
    const detail = source === "--tool=" ? `, got: ${raw}` : "";
    throw new UsageError(`${source} requires a tool id${detail}`);
  }
  return raw;
}

function requireOutputValue(raw: string | undefined, source: "--output" | "--output="): string {
  if (raw === undefined || raw === "") {
    const value = source === "--output=" ? "a non-empty path" : "a path argument";
    throw new UsageError(`${source} requires ${value}`);
  }
  if (raw.startsWith("--")) {
    const detail = source === "--output=" ? `, got: ${raw}` : "";
    throw new UsageError(`${source} requires a path argument${detail}`);
  }
  return raw;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let tool: string | undefined;
  let outputPath: string | undefined;
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i] ?? "";
    if (arg === "--tool") {
      tool = requireToolValue(argv[i + 1], "--tool");
      i += OPTION_WITH_VALUE_ARG_SPAN;
      continue;
    }
    if (arg.startsWith("--tool=")) {
      tool = requireToolValue(arg.slice("--tool=".length), "--tool=");
      i += 1;
      continue;
    }
    if (arg === "--output") {
      outputPath = requireOutputValue(argv[i + 1], "--output");
      i += OPTION_WITH_VALUE_ARG_SPAN;
      continue;
    }
    if (arg.startsWith("--output=")) {
      outputPath = requireOutputValue(arg.slice("--output=".length), "--output=");
      i += 1;
      continue;
    }
    throw new UsageError(`Unknown argument: ${arg}`);
  }
  if (tool === undefined) throw new UsageError("--tool is required");
  if (!isMusiHarnessTool(tool)) {
    throw new UsageError(`--tool must be one of the harness tool ids; got '${tool}'`);
  }
  return { tool, outputPath };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    // type-assertion-boundary: framework - process.stdin yields any
    const buf: Buffer =
      typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array);
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseFindings(text: string): readonly HarnessFinding[] {
  const findings: HarnessFinding[] = [];
  let lineNumber = 0;
  for (const rawLine of text.split("\n")) {
    lineNumber += 1;
    const line = rawLine.trim();
    if (line === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`stdin line ${String(lineNumber)} is not valid JSON: ${reason}`, {
        cause: error,
      });
    }
    const result = harnessFindingSchema.safeParse(parsed);
    if (!result.success) {
      const issues = JSON.stringify(result.error.issues, null, JSON_INDENT_SPACES);
      throw new Error(`stdin line ${String(lineNumber)} failed harnessFindingSchema:\n${issues}`);
    }
    findings.push(result.data);
  }
  return findings;
}

async function main(): Promise<void> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(PROCESS_ARG_OFFSET));
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`harness-emit-envelope: ${error.message}\n${usage()}`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }

  const text = await readStdin();
  const findings = parseFindings(text);

  const envelope: HarnessDiagnostics = {
    version: HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
    tool: args.tool,
    findings: [...findings],
    summary: summarizeHarnessFindings(findings),
  };
  const validated = harnessDiagnosticsSchema.safeParse(envelope);
  if (!validated.success) {
    const issues = JSON.stringify(validated.error.issues, null, JSON_INDENT_SPACES);
    throw new Error(`harness-emit-envelope produced an invalid envelope:\n${issues}`);
  }

  const rendered = `${JSON.stringify(envelope, null, JSON_INDENT_SPACES)}\n`;
  if (args.outputPath !== undefined) {
    const outPath = isAbsolute(args.outputPath)
      ? args.outputPath
      : resolve(process.cwd(), args.outputPath);
    ensureDirWriteFileAtomicallySync(outPath, rendered);
  } else {
    process.stdout.write(rendered);
  }
}

await main();
