import type { SpawnSyncReturns } from "node:child_process";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function spawnCodeIntel(args: string[]): SpawnSyncReturns<string> {
  return spawnSync("bun", ["scripts/code-intel.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

describe("code:intel CLI front door", () => {
  it("keeps help and parse errors on the thin path before one-shot fallback", () => {
    const entrypoint = readFileSync(path.join(process.cwd(), "scripts/code-intel.ts"), "utf8");
    const cliMain = readFileSync(
      path.join(process.cwd(), "scripts/code-intel/cli-main.ts"),
      "utf8",
    );
    const runtimeRunnerImportLines = entrypoint
      .split("\n")
      .filter((line) => line.includes('from "./code-intel/runner.js"'))
      .filter((line) => !line.startsWith("import type ") && !line.startsWith("export type "));

    expect(runtimeRunnerImportLines).toEqual([]);
    expect(cliMain).toContain('await import("./runner.js")');

    const help = spawnCodeIntel(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage:");
    expect(help.stdout).toContain("bun run code:intel -- [--format text|json] def --name <symbol>");
    expect(help.stdout).toContain(
      "Daemon/perf: bun run code:intel:server -- restart|status|stop; bun run code:intel:perf",
    );
    expect(help.stderr).toBe("");

    const parseError = spawnCodeIntel(["def"]);
    expect(parseError.status).toBe(1);
    expect(parseError.stdout).toBe("");
    expect(parseError.stderr).toContain(
      "Usage: bun run code:intel -- def <file>:<line>:<col> OR def --name <symbol>",
    );
  });
});
