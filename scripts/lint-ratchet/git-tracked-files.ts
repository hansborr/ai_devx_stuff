import { execFileSync } from "node:child_process";

import { ConfigError } from "../lint-ratchet-metrics.js";
import { repoRoot } from "./paths.js";

export function trackedFilesFromGit(context: string): readonly string[] {
  try {
    return execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
      .split("\n")
      .filter((line) => line.length > 0)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new ConfigError(`git ls-files failed while ${context}: ${message}`);
  }
}
