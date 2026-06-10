import { describe, expect, it } from "vitest";

import { makeDefaultDriftAiConfig } from "./config-defaults.js";
import { parseDriftAiConfig } from "./config-parsing.js";
import { parseCoverageConfig } from "./coverage-config.js";

describe("parseCoverageConfig", () => {
  it("parses artifacts, normalizing paths and trimming labels", () => {
    const config = parseCoverageConfig(
      {
        artifacts: [
          { path: "./coverage/lcov.info", label: "  unit  " },
          { path: "coverage/e2e/lcov.info", label: "e2e" },
        ],
      },
      "config.coverage",
    );
    expect(config).toEqual({
      artifacts: [
        { path: "coverage/lcov.info", label: "unit" },
        { path: "coverage/e2e/lcov.info", label: "e2e" },
      ],
    });
  });

  it("defaults to no artifacts when the key is omitted", () => {
    expect(parseCoverageConfig({}, "config.coverage")).toEqual({ artifacts: [] });
  });

  it("preserves duplicate artifact entries rather than merging them", () => {
    const config = parseCoverageConfig(
      {
        artifacts: [
          { path: "coverage/lcov.info", label: "unit" },
          { path: "coverage/lcov.info", label: "unit" },
        ],
      },
      "config.coverage",
    );
    expect(config.artifacts).toHaveLength(2);
  });

  it("rejects unknown keys, non-array artifacts, and malformed entries", () => {
    expect(() => parseCoverageConfig({ nope: true }, "config.coverage")).toThrow(/unknown key/u);
    expect(() => parseCoverageConfig({ artifacts: {} }, "config.coverage")).toThrow(
      /must be an array/u,
    );
    expect(() => parseCoverageConfig({ artifacts: ["x"] }, "config.coverage")).toThrow(
      /must be an object/u,
    );
    expect(() =>
      parseCoverageConfig({ artifacts: [{ label: "unit" }] }, "config.coverage"),
    ).toThrow(/path' must be a non-empty string/u);
    expect(() =>
      parseCoverageConfig({ artifacts: [{ path: "coverage/lcov.info" }] }, "config.coverage"),
    ).toThrow(/label' must be a non-empty string/u);
    expect(() =>
      parseCoverageConfig({ artifacts: [{ path: "x", label: "y", extra: 1 }] }, "config.coverage"),
    ).toThrow(/unknown key 'extra'/u);
  });
});

describe("parseDriftAiConfig coverage section", () => {
  it("defaults coverage to an empty artifact list", () => {
    expect(parseDriftAiConfig({}).coverage).toEqual({ artifacts: [] });
    expect(makeDefaultDriftAiConfig().coverage).toEqual({ artifacts: [] });
  });

  it("parses a top-level coverage block", () => {
    const config = parseDriftAiConfig({
      coverage: { artifacts: [{ path: "coverage/lcov.info", label: "unit" }] },
    });
    expect(config.coverage.artifacts).toEqual([{ path: "coverage/lcov.info", label: "unit" }]);
  });

  it("rejects an unknown top-level coverage shape", () => {
    expect(() => parseDriftAiConfig({ coverage: { artifacts: [{ path: "x" }] } })).toThrow(
      /label' must be a non-empty string/u,
    );
  });
});
