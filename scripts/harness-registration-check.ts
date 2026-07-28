import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatRegistrationFailures,
  loadRegistrationCheckInputs,
  runRegistrationChecks,
} from "./harness/registration-check.js";

const PROCESS_ARG_OFFSET = 2;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const args = process.argv.slice(PROCESS_ARG_OFFSET).filter((arg) => arg !== "--");
  if (args.length > 0) {
    console.error(`harness:registration:check: unknown argument(s): ${args.join(", ")}`);
    process.exitCode = 2;
    return;
  }
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

try {
  await main();
} catch (error) {
  console.error(
    `harness:registration:check: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
