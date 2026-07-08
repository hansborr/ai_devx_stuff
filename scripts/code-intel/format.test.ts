import { describe, expect, it } from "vitest";

import { runCodeIntel } from "./runner.js";
import {
  addSource,
  createFixtureProject,
  createFixtureResolver,
  repoRoot,
} from "./test-fixtures.test-helper.js";

describe("formatCodeIntelQueryResult", () => {
  it("formats result counts, empty states, and JSON output", () => {
    const project = createFixtureProject();
    addSource(project, "packages/shared/src/rules/local.ts", "const local = 1;\n");
    addSource(project, "packages/shared/src/rules/core.ts", "export const core = () => 1;\n");
    const resolver = createFixtureResolver(project);
    const context = { graphProject: project, project, repoRoot, resolver };

    expect(runCodeIntel(["exports", "packages/shared/src/rules/local.ts"], context)).toBe(
      "exports packages/shared/src/rules/local.ts (0 results)\n  no exports found",
    );
    expect(runCodeIntel(["dependents", "packages/shared/src/rules/core.ts"], context)).toBe(
      "dependents packages/shared/src/rules/core.ts (0 results, depth=1)\n  no dependents found",
    );
    expect(
      JSON.parse(
        runCodeIntel(["dependents", "packages/shared/src/rules/core.ts", "--format=json"], context),
      ),
    ).toMatchObject({
      header: "dependents packages/shared/src/rules/core.ts",
      count: 0,
      byProject: {},
    });
    expect(runCodeIntel(["tests", "packages/shared/src/rules/core.ts", "--direct"], context)).toBe(
      "tests packages/shared/src/rules/core.ts (0 results)\n  no tests found",
    );

    const jsonOutput = runCodeIntel(
      ["exports", "packages/shared/src/rules/core.ts", "--format", "json"],
      context,
    );
    expect(JSON.parse(jsonOutput)).toEqual({
      header: "exports packages/shared/src/rules/core.ts",
      count: 1,
      results: [{ kind: "export", name: "core", exportKind: "value export" }],
    });
  });
});
