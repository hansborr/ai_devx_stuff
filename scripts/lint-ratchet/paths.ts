import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BASELINE_FILENAME = "lint-ratchet.baseline.json";
// Append-only JSONL log of accepted --allow-worse/orphan-removal debt, committed
// beside the baseline so a human stages both together and reviewers see them paired.
export const DEBT_LOG_FILENAME = "lint-ratchet.debt-log.jsonl";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const baselinePath = join(repoRoot, BASELINE_FILENAME);
export const debtLogPath = join(repoRoot, DEBT_LOG_FILENAME);

export function relativePath(filePath: string): string {
  if (!isAbsolute(filePath)) return filePath.replaceAll("\\", "/");
  const rel = relative(repoRoot, filePath);
  return rel === "" ? filePath : rel.replaceAll("\\", "/");
}

export function safeRatchetId(id: string): string {
  return id.replaceAll("/", "-").replaceAll(/[^a-z0-9-]/gu, "-");
}
