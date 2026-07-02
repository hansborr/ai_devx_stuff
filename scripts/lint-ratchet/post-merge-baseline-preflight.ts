import { readFileSync } from "node:fs";

import { parseLintRatchetBaseline } from "./lint-ratchet-baseline.js";
import { lintRatchets } from "./lint-ratchet-config.js";
import { baselinePath } from "./paths.js";
import { buildRuleSourceHashesById } from "./rule-source.js";

const parsed = parseLintRatchetBaseline(
  readFileSync(baselinePath, "utf8"),
  lintRatchets,
  buildRuleSourceHashesById(lintRatchets),
);

if (parsed.baseline === undefined) {
  console.error(parsed.failures.join("\n"));
  process.exitCode = 1;
}
