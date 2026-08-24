// Emits an agent-facing JSON envelope of local/* diagnostics, selected
// core/plugin steering rules, and parser errors for the PR 3 machine-readable
// diagnostics contract (see
// @musi/harness-diagnostics/schema.js).
//
// Local rule metadata is re-projected from each rule's meta.docs (PR 1
// contract); selected non-local rules use the checked overlay registry. The
// envelope is self-contained: each finding carries its manifest control id,
// severity, repair kind, and (for codemod rules) repair command. Rules without
// either metadata source are counted on stderr and emitted as info-severity
// completeness disclosures under lint/skipped-non-local.

import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { emitHarnessDiagnostics } from "./harness/harness-diagnostics-output.js";
import { parseEslintOutput } from "./lib/eslint-json.js";
import { formatRuleDocsFailures, loadLintRuleDocs } from "./lib/lint-rule-docs.js";
import {
  buildLintAgentEnvelope,
  type LintAgentEnvelopeResult,
  lintAgentRepoRoot,
  parseArgs,
} from "./lint-agent-envelope.js";

const PROCESS_ARG_OFFSET = 2;
const DISPLAY_COMMAND = "lint:agent:local-rules";
const STRUCTURAL_OVERLAY_ENV = "MUSI_LINT_AGENT_STRUCTURAL_OVERLAY";

// Obtain the salted ESLint cache args from the main lane's typed owner rather
// than reimplementing the fingerprint (which would drift). The module salts the
// cache location by every input that can change diagnostics for otherwise
// unchanged files (rule sources, config, tsconfig, TS sources, lockfiles) and
// prunes stale siblings, so the agent envelope can never serve pre-change
// findings the way the old unsalted `node_modules/.cache/eslint/` could.
// On any failure, degrade to an uncached run: correctness beats a cache that
// can lie about rule-development edits.
async function saltedCacheArgs(): Promise<readonly string[]> {
  return import("./lib/eslint-main-cache.js")
    .then((cacheModule) => {
      const plan = cacheModule.prepareEslintCachePlan({
        repoRoot: lintAgentRepoRoot,
        cacheRoot: globalThis.process.env.MUSI_ESLINT_MAIN_CACHE_ROOT,
      });
      return plan.eslintArguments;
    })
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(
        `${DISPLAY_COMMAND}: could not derive the salted ESLint cache args ` +
          `(${detail}); running without the ESLint cache.`,
      );
      return [];
    });
}

async function runEslint(patterns: readonly string[]): Promise<string> {
  const cacheArgs = await saltedCacheArgs();
  const args = [
    "--format=json",
    "--no-error-on-unmatched-pattern",
    ...cacheArgs,
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

  emitHarnessDiagnostics(
    envelope,
    args.outputPath === undefined
      ? { mode: "stdout-only" }
      : { mode: "output-path", path: args.outputPath },
    { source: DISPLAY_COMMAND },
  );

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
