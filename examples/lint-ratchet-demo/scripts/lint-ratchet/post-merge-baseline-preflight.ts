import { readFileSync } from "node:fs";

import { parseLintRatchetBaseline } from "@musi/lint-ratchet/kernel/baseline.js";
import { buildRuleSourceHashesById } from "@musi/lint-ratchet/kernel/rule-source.js";

import { baselinePath, demoBinding, demoRatchets } from "./adapter.js";

const parsed = parseLintRatchetBaseline(
  readFileSync(baselinePath, "utf8"),
  demoRatchets,
  buildRuleSourceHashesById(demoRatchets, demoBinding),
);

if (parsed.baseline === undefined) {
  console.error(parsed.failures.join("\n"));
  process.exitCode = 1;
}
