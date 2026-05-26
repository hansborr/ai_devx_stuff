import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BASELINE_FILENAME = "lint-ratchet.baseline.json";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const baselinePath = join(repoRoot, BASELINE_FILENAME);

export function relativePath(filePath: string): string {
  if (!isAbsolute(filePath)) return filePath.replaceAll("\\", "/");
  const rel = relative(repoRoot, filePath);
  return rel === "" ? filePath : rel.replaceAll("\\", "/");
}

export function safeRatchetId(id: string): string {
  return id.replaceAll("/", "-").replaceAll(/[^a-z0-9-]/gu, "-");
}
