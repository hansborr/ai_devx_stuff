import { writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import { ALL_CHECKS, DEFAULT_CHECKS } from "./check-metadata.js";
import { makeDefaultDriftAiConfig } from "./config-defaults.js";
import { buildConfigInspection, formatConfigInspectionText } from "./config-inspect.js";
import { currentRepoGit } from "./git-runner.test-helper.js";
import { runDriftAi } from "./runner.js";

const tmpRepo = registerTempRootCleanup();

describe("buildConfigInspection", () => {
  it("classifies an explicit config path as explicit, even at the auto filename", () => {
    const inspection = buildConfigInspection({
      repoRoot: "/repo",
      config: makeDefaultDriftAiConfig(),
      explicitConfig: true,
      loadedConfigPath: "drift-ai.config.json",
    });
    expect(inspection.configSource).toBe("explicit");
    expect(inspection.configPath).toBe("drift-ai.config.json");
  });

  it("classifies a discovered config as auto-discovered and an absent one as default", () => {
    const discovered = buildConfigInspection({
      repoRoot: "/repo",
      config: makeDefaultDriftAiConfig(),
      explicitConfig: false,
      loadedConfigPath: "drift-ai.config.json",
    });
    expect(discovered.configSource).toBe("auto-discovered");

    const fallback = buildConfigInspection({
      repoRoot: "/repo",
      config: makeDefaultDriftAiConfig(),
      explicitConfig: false,
      loadedConfigPath: null,
    });
    expect(fallback.configSource).toBe("default");
    expect(fallback.configPath).toBeNull();
  });

  it("reports default/implemented check sets and the merged source extensions", () => {
    const config = { ...makeDefaultDriftAiConfig(), additionalSourceExtensions: [".vue"] };
    const inspection = buildConfigInspection({
      repoRoot: "/repo",
      config,
      explicitConfig: false,
      loadedConfigPath: null,
    });
    expect(inspection.defaultChecks).toEqual(DEFAULT_CHECKS);
    expect(inspection.implementedChecks).toEqual(ALL_CHECKS);
    expect(inspection.additionalSourceExtensions).toEqual([".vue"]);
    expect(inspection.sourceExtensions).toContain(".vue");
    expect(inspection.sourceExtensions).toContain(".ts");
    // sorted for stable output
    expect([...inspection.sourceExtensions]).toEqual([...inspection.sourceExtensions].sort());
  });
});

describe("formatConfigInspectionText", () => {
  it("renders a concise summary and points at --format json for the rest", () => {
    const text = formatConfigInspectionText(
      buildConfigInspection({
        repoRoot: "/repo",
        config: { ...makeDefaultDriftAiConfig(), roots: ["src"] },
        explicitConfig: false,
        loadedConfigPath: null,
      }),
    );
    expect(text).toContain("config source:       default");
    expect(text).toContain("repo root:           /repo");
    expect(text).toContain("roots:               src");
    expect(text).toContain("--format json");
  });
});

describe("config subcommand", () => {
  it("reports built-in defaults when the target has no config file", () => {
    const repoRoot = makeRepoDir();
    const result = runDriftAi({ argv: ["config"], git: currentRepoGit(repoRoot) });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("config source:       default");
    expect(result.stdout).toContain(`repo root:           ${repoRoot}`);
  });

  it("auto-discovers drift-ai.config.json at the target repo root and emits JSON", () => {
    const repoRoot = makeRepoDir();
    writeFileSync(
      path.join(repoRoot, "drift-ai.config.json"),
      JSON.stringify({
        roots: ["packages/server/src"],
        additionalSourceExtensions: [".vue"],
        checks: {
          "ghost-files": {
            currentAllowedPairs: [
              {
                files: ["src/foo.ts", "./src/foo-helper.ts"],
                rationale:
                  "The helper remains a focused seam for foo; remove when its logic is consolidated.",
              },
            ],
          },
        },
      }),
      "utf8",
    );

    const result = runDriftAi({
      argv: ["config", "--format", "json"],
      git: currentRepoGit(repoRoot),
    });
    // type-assertion-boundary: JSON parse — narrow the inspection payload under test.
    const payload = JSON.parse(result.stdout) as {
      kind: string;
      configSource: string;
      configPath: string | null;
      roots: string[];
      config: {
        roots: string[];
        additionalSourceExtensions: string[];
        checks: {
          "ghost-files": {
            currentAllowedPairs: Array<{ files: string[]; rationale: string }>;
          };
        };
      };
    };

    expect(result.exitCode).toBe(0);
    expect(payload.kind).toBe("config-inspection");
    expect(payload.configSource).toBe("auto-discovered");
    expect(payload.configPath).toBe("drift-ai.config.json");
    expect(payload.roots).toEqual(["packages/server/src"]);
    expect(payload.config.additionalSourceExtensions).toEqual([".vue"]);
    expect(payload.config.checks["ghost-files"].currentAllowedPairs).toEqual([
      {
        files: ["src/foo-helper.ts", "src/foo.ts"],
        rationale:
          "The helper remains a focused seam for foo; remove when its logic is consolidated.",
      },
    ]);
    expect("findings" in payload).toBe(false);
  });

  it("reads an explicit --config path and labels the source explicit", () => {
    const repoRoot = makeRepoDir();
    const configPath = path.join(repoRoot, "custom.config.json");
    writeFileSync(configPath, JSON.stringify({ roots: ["app"] }), "utf8");

    const result = runDriftAi({
      argv: ["config", "--config", configPath, "--format", "json"],
      git: currentRepoGit(repoRoot),
    });
    // type-assertion-boundary: JSON parse — narrow the inspection payload under test.
    const payload = JSON.parse(result.stdout) as { configSource: string; roots: string[] };

    expect(result.exitCode).toBe(0);
    expect(payload.configSource).toBe("explicit");
    expect(payload.roots).toEqual(["app"]);
  });

  it("labels an explicit --config as explicit even when it is the auto filename", () => {
    const repoRoot = makeRepoDir();
    const configPath = path.join(repoRoot, "drift-ai.config.json");
    writeFileSync(configPath, JSON.stringify({ roots: ["lib"] }), "utf8");

    const result = runDriftAi({
      argv: ["config", "--config", configPath, "--format", "json"],
      git: currentRepoGit(repoRoot),
    });
    // type-assertion-boundary: JSON parse — narrow the inspection payload under test.
    const payload = JSON.parse(result.stdout) as { configSource: string };

    expect(result.exitCode).toBe(0);
    // An explicit path that happens to be the auto-discovery filename is still
    // reported as explicit: classification keys off whether --config was passed,
    // not the basename.
    expect(payload.configSource).toBe("explicit");
  });

  it("returns exit 2 for a missing explicit config path", () => {
    const repoRoot = makeRepoDir();
    const result = runDriftAi({
      argv: ["config", "--config", path.join(repoRoot, "nope.json")],
      git: currentRepoGit(repoRoot),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("does not exist");
  });

  it("prints usage on --help", () => {
    const result = runDriftAi({
      argv: ["config", "--help"],
      git: currentRepoGit(makeRepoDir()),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("bun run drift:ai config");
    expect(result.stdout).toContain("Read-only");
  });

  it("writes the report to --output without mutating the target config", () => {
    const repoRoot = makeRepoDir();
    const outputPath = path.join(repoRoot, "config-inspection.json");
    const writes: Array<{ path: string; contents: string }> = [];

    const result = runDriftAi({
      argv: ["config", "--format", "json", "--output", outputPath],
      git: currentRepoGit(repoRoot),
      writer: (filePath, contents) => writes.push({ path: filePath, contents }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`wrote json report to ${outputPath}`);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe(outputPath);
    // No drift-ai.config.json was created in the target repo.
    expect(writes.some((w) => w.path.endsWith("drift-ai.config.json"))).toBe(false);
  });
});

function makeRepoDir(): string {
  return tmpRepo.makeTempRepo("drift-config-inspect-");
}
