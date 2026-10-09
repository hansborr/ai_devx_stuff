import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { SCRIPT_SMOKE_SUBJECTS } from "./path-policy-smoke-subjects-data.js";
import { isSmokeTestBasename } from "./smoke-test-files.js";

function discoverScriptSmokeTestNames(): readonly string[] {
  const testsDir = join(process.cwd(), "scripts", "tests");
  const subjectNames = Object.keys(SCRIPT_SMOKE_SUBJECTS);
  if (!existsSync(testsDir)) return subjectNames;

  const discovered = new Set(
    readdirSync(testsDir)
      .filter(isSmokeTestBasename)
      .map((entry) => entry.slice(0, -".sh".length)),
  );
  const ordered = subjectNames.filter((name) => discovered.has(name));
  const extra = [...discovered].filter((name) => !subjectNames.includes(name)).sort();
  return [...ordered, ...extra];
}

let cachedScriptSmokeTestNames: readonly string[] | undefined;

/**
 * Smoke test names in run order, discovered lazily.
 *
 * The first call reads the cwd-relative `scripts/tests` directory; importing
 * this module touches no filesystem. The memo is module-scope on purpose, so
 * `vi.resetModules()` clears it and a test can drive discovery against a
 * fixture root — see the discovery cases in `path-policy.test.ts`.
 */
export function scriptSmokeTestNames(): readonly string[] {
  cachedScriptSmokeTestNames ??= discoverScriptSmokeTestNames();
  return cachedScriptSmokeTestNames;
}
