import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import { currentRepoGit } from "./git-runner.test-helper.js";
import { runDriftAi } from "./runner.js";

const FIXTURE_REPO = path.dirname(fileURLToPath(import.meta.url));
const tmpRepo = registerTempRootCleanup();

describe("coverage-evidence subcommand", () => {
  it("dispatches through drift:ai and reads configured coverage artifacts", () => {
    const configPath = writeConfig({
      coverage: {
        artifacts: [{ path: "fixtures/coverage/unit.lcov.info", label: "unit" }],
      },
    });

    const result = runDriftAi({
      argv: ["coverage-evidence", "--config", configPath, "--format", "json", "--top", "3"],
      git: currentRepoGit(FIXTURE_REPO),
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
      git: currentRepoGit(FIXTURE_REPO),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("bun run drift:ai coverage-evidence");
    expect(result.stdout).toContain("--config <path>");
  });
});

function writeConfig(value: unknown): string {
  const dir = tmpRepo.makeTempRepo("drift-coverage-evidence-");
  const configPath = path.join(dir, "drift-ai.config.json");
  writeFileSync(configPath, JSON.stringify(value), "utf8");
  return configPath;
}
