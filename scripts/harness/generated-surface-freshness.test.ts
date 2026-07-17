import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  GENERATED_SURFACE_FRESHNESS,
  renderGeneratedSurfaceFreshnessShell,
} from "./generated-surface-freshness.js";

describe("generated surface freshness registry", () => {
  it("covers every freshness checker, including the two formerly missing hook warnings", () => {
    expect(GENERATED_SURFACE_FRESHNESS.map((entry) => entry.checkScript)).toEqual([
      "test:scripts:subjects:check",
      "verify:steps:check",
      "harness:hook-timeouts:check",
      "harness:config-surfaces:check",
      "harness:wiring:check",
      "docs:lint-guidance:check",
      "docs:baseline-conflict-recipes:check",
      "docs:harness-controls:check",
      "lint:restricted-disable-rules:check",
    ]);

    const generated = renderGeneratedSurfaceFreshnessShell(GENERATED_SURFACE_FRESHNESS);
    expect(generated).toContain("scripts/path-policy/generate-smoke-subjects.ts");
    expect(generated).toContain("test:scripts:subjects:check");
    expect(generated).toContain("scripts/harness/generate-restricted-disable-rules.ts");
    expect(generated).toContain("lint:restricted-disable-rules:check");
  });

  it("renders a newly registered surface without changing the hook", () => {
    const hookBefore = readFileSync(".husky/pre-commit", "utf8");
    const generated = renderGeneratedSurfaceFreshnessShell([
      ...GENERATED_SURFACE_FRESHNESS,
      {
        triggerPaths: ["scripts/example-generator.ts"],
        outputPaths: ["generated/example.txt"],
        checkScript: "example:check",
        warnLabel: "example output",
      },
    ]);

    expect(generated).toContain("scripts/example-generator.ts");
    expect(generated).toContain("warn_if_generated_surface_stale 'example output' 'example:check'");
    expect(readFileSync(".husky/pre-commit", "utf8")).toBe(hookBefore);
  });
});
