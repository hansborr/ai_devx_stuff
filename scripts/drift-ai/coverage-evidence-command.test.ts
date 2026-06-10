import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runDriftAi } from "./runner.js";

const FIXTURE_REPO = path.dirname(fileURLToPath(import.meta.url));

describe("coverage-evidence subcommand", () => {
  it("dispatches through drift:ai and reads configured coverage artifacts", () => {
    const configPath = writeConfig({
      coverage: {
        artifacts: [{ path: "fixtures/coverage/unit.lcov.info", label: "unit" }],
      },
    });

    const result = runDriftAi({
      argv: ["coverage-evidence", "--config", configPath, "--format", "json", "--top", "3"],
      git: gitRoot(FIXTURE_REPO),
    });
    const advisory = JSON.parse(result.stdout) as Record<string, unknown>;

    expect(result.exitCode).toBe(0);
    expect(advisory["kind"]).toBe("advisory");
    expect(advisory["lane"]).toBe("prototype");
    expect(advisory["subcommand"]).toBe("coverage-evidence");
    expect("findings" in advisory).toBe(false);
    expect(result.stdout).toContain('"label": "unit"');
    expect(result.stdout).toContain('"totalCandidates": 9');
    expect(result.stdout).toContain('"rank": 3');
    expect(result.stdout).not.toContain('"rank": 4');
  });

  it("prints subcommand usage on help", () => {
    const result = runDriftAi({
      argv: ["coverage-evidence", "--help"],
      git: gitRoot(FIXTURE_REPO),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("bun run drift:ai coverage-evidence");
    expect(result.stdout).toContain("--config <path>");
  });
});

function writeConfig(value: unknown): string {
  const dir = path.join(tmpdir(), `drift-coverage-evidence-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, "drift-ai.config.json");
  writeFileSync(configPath, JSON.stringify(value), "utf8");
  return configPath;
}

function gitRoot(repoRoot: string): (args: readonly string[]) => string {
  return (args) => (args[0] === "rev-parse" ? `${repoRoot}\n` : "");
}
