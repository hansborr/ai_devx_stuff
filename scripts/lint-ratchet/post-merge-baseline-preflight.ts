import { readFileSync } from "node:fs";

import { parseLintRatchetBaseline } from "@musi/lint-ratchet/kernel/baseline.js";
import { buildRuleSourceHashesById } from "@musi/lint-ratchet/kernel/rule-source.js";

import { musiLintRatchetBinding } from "./engine-binding.js";
import { lintRatchets } from "./lint-ratchet-config.js";
import { baselinePath } from "./paths.js";

const parsed = parseLintRatchetBaseline(
  readFileSync(baselinePath, "utf8"),
  lintRatchets,
  buildRuleSourceHashesById(lintRatchets, musiLintRatchetBinding),
);

if (parsed.baseline === undefined) {
  console.error(parsed.failures.join("\n"));
  process.exitCode = 1;
}
