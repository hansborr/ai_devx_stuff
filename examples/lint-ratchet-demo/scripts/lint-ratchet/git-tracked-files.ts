import { execFileSync } from "node:child_process";

import { compareByCodepoint } from "../lib/codepoint-compare.js";
import { ConfigError } from "./metrics.js";
import { repoRoot } from "./paths.js";

export function trackedFilesFromGit(context: string, cwd: string = repoRoot): readonly string[] {
  try {
    // `-z` + NUL-split: git otherwise C-quotes any non-ASCII pathname (with
    // `core.quotePath` on by default), and a quoted string (leading `"`) fails
    // every ratchet glob — so such files silently drop out of gate coverage.
    // `-z` also survives pathnames containing newlines, which a newline-split
    // would corrupt outright.
    // Codepoint order (see compareByCodepoint), not localeCompare: this defines
    // the ratchet's collection iteration order, kept stable across machines with
    // different ICU builds or locales.
    return execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8" })
      .split("\0")
      .filter((entry) => entry.length > 0)
      .sort(compareByCodepoint);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new ConfigError(`git ls-files failed while ${context}: ${message}`);
  }
}
