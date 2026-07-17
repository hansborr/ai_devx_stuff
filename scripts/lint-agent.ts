// Emits an agent-facing JSON envelope of local/* diagnostics, selected
// core/plugin steering rules, and parser errors for the PR 3 machine-readable
// diagnostics contract (see
// packages/shared/src/schemas/harness-diagnostics.ts).
//
// Local rule metadata is re-projected from each rule's meta.docs (PR 1
// contract); selected non-local rules use the checked overlay registry. The
// envelope is self-contained: each finding carries its manifest control id,
// severity, repair kind, and (for codemod rules) repair command. Rules without
// either metadata source are counted on stderr and emitted as info-severity
// completeness disclosures under lint/skipped-non-local.

import { spawn, spawnSync } from "node:child_process";
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
const STRUCTURAL_OVERLAY_ENV = "MUSI_LINT_AGENT_STRUCTURAL_OVERLAY";

// Obtain the salted ESLint cache args from the main lane's shared lib rather
// than reimplementing the fingerprint (which would drift). The lib salts the
// cache location by every input that can change diagnostics for otherwise
// unchanged files (rule sources, config, tsconfig, TS sources, lockfiles) and
// prunes stale siblings, so the agent envelope can never serve pre-change
// findings the way the old unsalted `node_modules/.cache/eslint/` could.
// On any failure, degrade to an uncached run: correctness beats a cache that
// can lie about rule-development edits.
function saltedCacheArgs(): readonly string[] {
  const script =
    ". scripts/lib/eslint-main-cache.sh" +
    ' && musi_eslint_main_cache_args "$1"' +
    " && " +
    "printf '%s\\n' \"${MUSI_ESLINT_MAIN_CACHE_ARGS[@]}\"";
  // spawnSync (not execFileSync) so a failing shell-out is an ordinary result
  // to branch on rather than a thrown error we would have to log-and-swallow.
  const result = spawnSync("bash", ["-c", script, "bash", lintAgentRepoRoot], {
    cwd: lintAgentRepoRoot,
    env: globalThis.process.env,
    encoding: "utf8",
  });
  if (result.error !== undefined || result.status !== 0) {
    const stderr = result.stderr.trim();
    const detail =
      result.error?.message ?? (stderr.length > 0 ? stderr : `exit ${String(result.status)}`);
    console.error(
      `${DISPLAY_COMMAND}: could not derive the salted ESLint cache args ` +
        `(${detail}); running without the ESLint cache.`,
    );
    return [];
  }
  const args = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (args[0] !== "--cache") {
    console.error(
      `${DISPLAY_COMMAND}: unexpected cache args from eslint-main-cache.sh; ` +
        `running without the ESLint cache.`,
    );
    return [];
  }
  return args;
}

async function runEslint(patterns: readonly string[]): Promise<string> {
  const args = [
    "--format=json",
    "--no-error-on-unmatched-pattern",
    ...saltedCacheArgs(),
    ...(patterns.length > 0 ? patterns : ["."]),
  ];

  return new Promise((resolveOutput, rejectOutput) => {
    const child = spawn(resolve(lintAgentRepoRoot, "node_modules/.bin/eslint"), args, {
      cwd: lintAgentRepoRoot,
      env: { ...globalThis.process.env, [STRUCTURAL_OVERLAY_ENV]: "1" },
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
