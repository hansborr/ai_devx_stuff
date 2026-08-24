import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatRegistrationFailures,
  loadRegistrationCheckInputs,
  runRegistrationChecks,
} from "./harness/registration-check.js";
import { parseRegistrationCheckArgs } from "./harness/registration-explain-cli.js";
import type { ExplainSelector } from "./harness/registration-explain-model.js";

const PROCESS_ARG_OFFSET = 2;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function runExplain(selector: ExplainSelector, format: "text" | "json"): Promise<void> {
  // Explain-only modules load lazily (mirroring the lint-ratchet-config
  // import in registration-check.ts): the no-arg preflight gate must not pay
  // for the explain closure or run its module-scope work — path-policy
  // smoke-subject loading reads the cwd-relative scripts/tests directory at
  // import time. The literal specifiers keep both modules visible to the
  // fixture-copy closure walker (see runtime-imports.ts recordImport).
  const {
    buildExplainReport,
    liveExplainPathPolicy,
    loadLiveExplainFixtureClosure,
    resolveExplainAuthorities,
  } = await import("./harness/registration-explain.js");
  const { renderExplainJson, renderExplainText } =
    await import("./harness/registration-explain-render.js");
  const inputs = await loadRegistrationCheckInputs(repoRoot);
  const result = runRegistrationChecks(inputs);
  const fixtureClosure = await loadLiveExplainFixtureClosure(repoRoot, result.generatedSurfaces);
  const resolved = resolveExplainAuthorities(
    inputs,
    result,
    liveExplainPathPolicy(),
    fixtureClosure,
  );
  if (resolved.authorities === undefined) {
    console.error(
      [
        "harness:registration:check: --explain refuses to report over a failing " +
          "registration state (an explain result is only authoritative when " +
          "registration is clean); repair these failures first:",
        ...resolved.failures.map((failure) => `- ${failure}`),
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }
  const report = buildExplainReport(selector, resolved.authorities);
  console.log(format === "json" ? renderExplainJson(report) : renderExplainText(report));
}

async function runCheck(): Promise<void> {
  const inputs = await loadRegistrationCheckInputs(repoRoot);
  const { failures, state } = runRegistrationChecks(inputs);
  if (failures.size > 0) {
    console.error(formatRegistrationFailures("harness:registration:check", failures));
    process.exitCode = 1;
    return;
  }
  console.log(
    `harness:registration:check OK — ${String(state.controls.length)} control(s) structurally registered.`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(PROCESS_ARG_OFFSET).filter((arg) => arg !== "--");
  const command = parseRegistrationCheckArgs(args);
  if (command.mode === "usage-error") {
    console.error(`harness:registration:check: ${command.message}`);
    process.exitCode = 2;
    return;
  }
  if (command.mode === "explain") {
    await runExplain(command.selector, command.format);
    return;
  }
  await runCheck();
}

try {
  await main();
} catch (error) {
  console.error(
    `harness:registration:check: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
