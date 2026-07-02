// Emits an agent-facing JSON envelope of local/* ESLint diagnostics for the
// PR 3 machine-readable diagnostics contract (see
// packages/shared/src/schemas/harness-diagnostics.ts).
//
// Local rule metadata is re-projected from each rule's meta.docs (PR 1
// contract) so the envelope is self-contained: each finding carries its
// manifest control id, severity, repair kind, and (for codemod rules)
// repair command. Non-local findings are counted on stderr and also emitted
// as info-severity completeness disclosures under lint/skipped-non-local.

import { spawn } from "node:child_process";
import { dirname, isAbsolute, resolve } from "node:path";

import { harnessDiagnosticsSchema } from "../packages/shared/src/schemas/harness-diagnostics.js";
import { parseEslintOutput } from "./lib/eslint-json.js";
import { formatRuleDocsFailures, loadLintRuleDocs } from "./lib/lint-rule-docs.js";
import {
  buildLintAgentEnvelope,
  type LintAgentEnvelopeResult,
  lintAgentRepoRoot,
  parseArgs,
} from "./lint-agent-envelope.js";

const PROCESS_ARG_OFFSET = 2;
const JSON_INDENT_SPACES = 2;
const DISPLAY_COMMAND = "lint:agent:local-rules";

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
    const child = spawn(resolve(lintAgentRepoRoot, "node_modules/.bin/eslint"), args, {
      cwd: lintAgentRepoRoot,
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

async function buildEnvelope(patterns: readonly string[]): Promise<LintAgentEnvelopeResult> {
  const { entries, failures } = await loadLintRuleDocs(lintAgentRepoRoot);
  if (failures.length > 0) {
    throw new Error(formatRuleDocsFailures(failures));
  }
  const ruleDocs = new Map(entries.map((entry) => [entry.id, entry]));

  const stdout = await runEslint(patterns);
  const eslintResults = parseEslintOutput(stdout);
  return buildLintAgentEnvelope(eslintResults, ruleDocs);
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
