import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Import the error class from its leaf module, not the metrics barrel: paths.ts
// is copied into sandbox fixtures (test-format-changed) that provide only its
// direct dependency closure, so it must stay near-leaf.
import { ConfigError } from "@musi/lint-ratchet/kernel/metrics-types.js";

export const BASELINE_FILENAME = "lint-ratchet.baseline.json";
// Append-only JSONL log of accepted --allow-worse/orphan-removal debt, committed
// beside the baseline so a human stages both together and reviewers see them paired.
export const DEBT_LOG_FILENAME = "lint-ratchet.debt-log.jsonl";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const baselinePath = join(repoRoot, BASELINE_FILENAME);
export const debtLogPath = join(repoRoot, DEBT_LOG_FILENAME);

// Single reader for the committed baseline text; both the default gate and the
// unvalidated modes need the same "missing baseline ⇒ run lint:ratchet:update"
// contract.
export function readBaselineOrThrow(updateCommand: string): string {
  if (!existsSync(baselinePath)) {
    throw new ConfigError(`${BASELINE_FILENAME} does not exist; run ${updateCommand}`);
  }
  return readFileSync(baselinePath, "utf8");
}
