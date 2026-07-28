// @ts-check
import { describe, expect, it } from "vitest";

import laneLintRatchet from "../tools/stryker-lint-ratchet.mjs";
import laneScripts from "../scripts/stryker-scripts.mjs";
import laneServer from "../stryker.config.server.mjs";
import laneShared from "../stryker.config.mjs";
import { createStrykerConfig } from "../stryker.shared.mjs";

/** @returns {Record<string, unknown>} a minimal set of the options every lane must supply */
function requiredLaneOptions() {
  return {
    tsconfigFile: "packages/shared/tsconfig.json",
    reportDir: "reports/mutation",
    vitest: { configFile: "packages/shared/vitest.config.ts" },
    mutate: ["packages/shared/src/**/*.ts"],
  };
}

describe("createStrykerConfig", () => {
  it("derives every report path from reportDir", () => {
    const config = createStrykerConfig(requiredLaneOptions());

    expect(config.incrementalFile).toBe("reports/mutation/stryker-incremental.json");
    expect(config.htmlReporter).toEqual({ fileName: "reports/mutation/index.html" });
    expect(config.jsonReporter).toEqual({ fileName: "reports/mutation/mutation.json" });
  });

  it("keeps the optional lane switches opt-in", () => {
    const withoutSwitches = createStrykerConfig(requiredLaneOptions());
    expect(withoutSwitches).not.toHaveProperty("ignorePatterns");
    expect(withoutSwitches).not.toHaveProperty("inPlace");

    const withSwitches = createStrykerConfig({
      ...requiredLaneOptions(),
      ignorePatterns: [".tools"],
      inPlace: true,
    });
    expect(withSwitches.ignorePatterns).toEqual([".tools"]);
    expect(withSwitches.inPlace).toBe(true);
  });

  it("rejects an option key it does not understand instead of dropping it", () => {
    // A typo'd `reportsDir` used to leave reportDir undefined and write
    // "undefined/stryker-incremental.json"; a typo'd `ignorePatterns` used to
    // silently reinstate the sandbox-copy failure that option exists to
    // prevent. These .mjs files have no checkJs, so the throw is the only guard.
    expect(() =>
      createStrykerConfig({ ...requiredLaneOptions(), reportsDir: "reports/typo" }),
    ).toThrow(/unknown option/i);
    expect(() =>
      createStrykerConfig({ ...requiredLaneOptions(), ignorePattern: [".tools"] }),
    ).toThrow(/ignorePattern/);
  });

  it("refuses to let a lane override a shared invariant", () => {
    expect(() => createStrykerConfig({ ...requiredLaneOptions(), concurrency: 4 })).toThrow(
      /concurrency/,
    );
  });

  it("rejects a missing required option instead of interpolating undefined", () => {
    for (const key of ["mutate", "reportDir", "tsconfigFile", "vitest"]) {
      const options = requiredLaneOptions();
      delete options[key];
      expect(() => createStrykerConfig(options), `missing ${key}`).toThrow(
        new RegExp(`required option.*${key}`, "i"),
      );
    }
  });
});

describe("stryker lane configs", () => {
  const lanes = [
    { name: "stryker.config.mjs", config: laneShared },
    { name: "stryker.config.server.mjs", config: laneServer },
    { name: "scripts/stryker-scripts.mjs", config: laneScripts },
    { name: "tools/stryker-lint-ratchet.mjs", config: laneLintRatchet },
  ];

  it.each(lanes)("$name resolves its report paths to a real directory", ({ config }) => {
    const paths = [
      config.incrementalFile,
      config.htmlReporter.fileName,
      config.jsonReporter.fileName,
    ];
    for (const path of paths) {
      expect(path).toMatch(/^reports\/[\w-]+\//);
    }
  });
});
