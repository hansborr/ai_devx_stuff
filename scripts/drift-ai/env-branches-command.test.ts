import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runDriftAi } from "./runner.js";

const SOURCE = [
  'if (process.env.NODE_ENV === "production") bootProd();',
  "if (__DEV__) enableDebug();",
  "if (process.env.UNKNOWN_FLAG) enableExperimental();",
].join("\n");

const ENV_DEFINE = {
  processEnv: { NODE_ENV: { value: "production", source: "prod" } },
  defines: { __DEV__: { value: false, source: "vite" } },
};

describe("env-branches subcommand", () => {
  it("dispatches through drift:ai and predicts branches under the configured matrix", () => {
    const repo = writeFixtureRepo({ roots: ["src"], envDefine: ENV_DEFINE });

    const result = runDriftAi({
      argv: ["env-branches", "--config", repo.configPath, "--format", "json", "--top", "10"],
      git: gitRoot(repo.dir),
      gitBuffer: () => Buffer.alloc(0),
    });
    const advisory = JSON.parse(result.stdout) as Record<string, unknown>;

    expect(result.exitCode).toBe(0);
    expect(advisory["kind"]).toBe("advisory");
    expect(advisory["lane"]).toBe("prototype");
    expect(advisory["subcommand"]).toBe("env-branches");
    expect("findings" in advisory).toBe(false);
    expect(result.stdout).toContain('"predictedBranch": "truthy"');
    expect(result.stdout).toContain('"predictedBranch": "falsy"');
    expect(result.stdout).toContain('"predictedBranch": "unknown"');
    expect(result.stdout).toContain('"valueSource": "prod"');
  });

  it("discloses an unmet matrix prerequisite when envDefine is absent", () => {
    const repo = writeFixtureRepo({ roots: ["src"] });

    const result = runDriftAi({
      argv: ["env-branches", "--config", repo.configPath, "--format", "json"],
      git: gitRoot(repo.dir),
      gitBuffer: () => Buffer.alloc(0),
    });
    const advisory = JSON.parse(result.stdout) as { prerequisites: { satisfied: boolean }[] };

    expect(result.exitCode).toBe(0);
    expect(advisory.prerequisites[0]?.satisfied).toBe(false);
    expect(result.stdout).not.toContain('"predictedBranch"');
  });

  it("prints subcommand usage on help", () => {
    const result = runDriftAi({ argv: ["env-branches", "--help"] });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("bun run drift:ai env-branches");
    expect(result.stdout).toContain("--config <path>");
  });
});

function writeFixtureRepo(config: unknown): { dir: string; configPath: string } {
  const dir = path.join(tmpdir(), `drift-env-branches-${process.pid}-${Date.now()}`);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(path.join(dir, "src", "app.ts"), SOURCE, "utf8");
  const configPath = path.join(dir, "drift-ai.config.json");
  writeFileSync(configPath, JSON.stringify(config), "utf8");
  return { dir, configPath };
}

function gitRoot(repoRoot: string): (args: readonly string[]) => string {
  return (args) => (args[0] === "rev-parse" ? `${repoRoot}\n` : "");
}
