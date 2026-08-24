import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import { currentRepoGit } from "./git-runner.test-helper.js";
import { runDriftAi } from "./runner.js";

const FIXTURE_REPO = path.dirname(fileURLToPath(import.meta.url));
const tmpRepo = registerTempRootCleanup();

describe("coverage-unused-exports subcommand", () => {
  it("correlates a supplied knip report against configured coverage artifacts", () => {
    const configPath = writeConfig({
      coverage: { artifacts: [{ path: "fixtures/coverage/unit.lcov.info", label: "unit" }] },
    });

    const result = runDriftAi({
      argv: [
        "coverage-unused-exports",
        "--config",
        configPath,
        "--unused-exports-report",
        "fixtures/unused-exports/knip-report.json",
        "--format",
        "json",
      ],
      git: currentRepoGit(FIXTURE_REPO),
    });
    const advisory = JSON.parse(result.stdout) as Record<string, unknown>;

    expect(result.exitCode).toBe(0);
    expect(advisory["kind"]).toBe("advisory");
    expect(advisory["lane"]).toBe("prototype");
    expect(advisory["subcommand"]).toBe("coverage-unused-exports");
    expect("findings" in advisory).toBe(false);
    // add executed despite knip calling it unused -> conflict; subtract agrees; ghost unavailable.
    expect(result.stdout).toContain('"agreement": "covered-but-unused"');
    expect(result.stdout).toContain('"agreement": "uncovered-and-unused"');
    expect(result.stdout).toContain('"agreement": "coverage-unavailable"');
  });

  it("discloses a missing report without erroring", () => {
    const configPath = writeConfig({ coverage: { artifacts: [] } });

    const result = runDriftAi({
      argv: ["coverage-unused-exports", "--config", configPath],
      git: currentRepoGit(FIXTURE_REPO),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("prerequisite unused-exports report: unmet");
    expect(result.stdout).toContain("prerequisite coverage artifacts: unmet");
  });

  it("prints subcommand usage on help", () => {
    const result = runDriftAi({
      argv: ["coverage-unused-exports", "--help"],
      git: currentRepoGit(FIXTURE_REPO),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("bun run drift:ai coverage-unused-exports");
    expect(result.stdout).toContain("--unused-exports-report");
  });
});

function writeConfig(value: unknown): string {
  const dir = tmpRepo.makeTempRepo("drift-coverage-unused-");
  const configPath = path.join(dir, "drift-ai.config.json");
  writeFileSync(configPath, JSON.stringify(value), "utf8");
  return configPath;
}
