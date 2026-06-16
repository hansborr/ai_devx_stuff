import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { SCRIPT_SMOKE_SUBJECTS } from "./path-policy-smoke-subjects-data.js";

function discoverScriptSmokeTestNames(): readonly string[] {
  const testsDir = join(process.cwd(), "scripts", "tests");
  const subjectNames = Object.keys(SCRIPT_SMOKE_SUBJECTS);
  if (!existsSync(testsDir)) return subjectNames;

  const discovered = new Set(
    readdirSync(testsDir)
      .filter((entry) => /^test-.+\.sh$/u.test(entry))
      .map((entry) => entry.slice(0, -".sh".length)),
  );
  const ordered = subjectNames.filter((name) => discovered.has(name));
  const extra = [...discovered].filter((name) => !subjectNames.includes(name)).sort();
  return [...ordered, ...extra];
}

export const SCRIPT_SMOKE_TEST_NAMES = discoverScriptSmokeTestNames();
