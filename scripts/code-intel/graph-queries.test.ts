import { describe, expect, it } from "vitest";

import { CodeIntelError } from "./errors.js";
import { queryDependents, queryTests } from "./graph-queries.js";
import { runCodeIntel } from "./runner.js";
import {
  addSource,
  createFixtureProject,
  createFixtureResolver,
  fileResult,
  graphFor,
  hasFileResult,
  repoRoot,
} from "./test-fixtures.test-helper.js";

describe("graph-queries", () => {
  it("walks dependents across static imports, re-exports, dynamic imports, and depth", () => {
    const project = createFixtureProject();
    addSource(project, "packages/shared/src/rules/math.ts", "export const sum = () => 1;\n");
    addSource(
      project,
      "packages/server/src/direct.ts",
      'import { sum } from "@musi/shared/rules/math.js"; export const direct = sum();\n',
    );
    addSource(
      project,
      "packages/server/src/reexport.ts",
      'export { sum } from "@musi/shared/rules/math.js";\n',
    );
    addSource(
      project,
      "packages/client/src/lazy.ts",
      'export async function load() { return import("@musi/shared/rules/math.js"); }\n',
    );
    addSource(project, "packages/server/src/feature.ts", 'import "./direct.js";\n');
    const resolver = createFixtureResolver(project);
    const results = queryDependents(
      resolver,
      graphFor(project, resolver),
      "packages/shared/src/rules/math.ts",
      2,
    );

    expect(results).toContainEqual({
      kind: "dependent",
      file: "packages/server/src/direct.ts",
      depth: 1,
      via: "direct",
    });
    expect(results).toContainEqual({
      kind: "dependent",
      file: "packages/server/src/reexport.ts",
      depth: 1,
      via: "re-export",
    });
    expect(results).toContainEqual({
      kind: "dependent",
      file: "packages/client/src/lazy.ts",
      depth: 1,
      via: "dynamic",
    });
    expect(results).toContainEqual({
      kind: "dependent",
      file: "packages/server/src/feature.ts",
      depth: 2,
      via: "direct",
    });
  });

  it("parses dependents depth, project, and test filters", () => {
    const project = createFixtureProject();
    addSource(project, "packages/shared/src/rules/core.ts", "export const core = () => 1;\n");
    addSource(
      project,
      "packages/server/src/direct.ts",
      'import { core } from "@musi/shared/rules/core.js"; export const direct = core();\n',
    );
    addSource(
      project,
      "packages/server/src/feature.ts",
      'import { direct } from "./direct.js"; export const feature = direct;\n',
    );
    addSource(
      project,
      "packages/server/src/direct.test.ts",
      'import { core } from "@musi/shared/rules/core.js"; test("core", () => core());\n',
    );
    addSource(
      project,
      "packages/client/src/core-view.ts",
      'import { core } from "@musi/shared/rules/core.js"; export const view = core;\n',
    );
    const resolver = createFixtureResolver(project);
    const context = { graphProject: project, repoRoot, resolver };
    const target = "packages/shared/src/rules/core.ts";

    const output = runCodeIntel(
      ["dependents", target, "--depth=2", "--project", "server", "--exclude-tests"],
      context,
    );
    expect(output).toContain("dependents packages/shared/src/rules/core.ts (2 results, depth=2)");
    expect(output).toContain("packages/server/src/direct.ts direct");
    expect(output).toContain("packages/server/src/feature.ts transitive (depth=2)");
    expect(output).not.toContain(" -- server:");
    expect(output).not.toContain("packages/server/src/direct.test.ts");
    expect(output).not.toContain("packages/client/src/core-view.ts");
    // dependents is file-anchored and guarded at input, so it carries no
    // scope statement; only discovery-mode (def --name) output does.
    expect(output).not.toContain("Scope:");

    const filteredJsonOutput = runCodeIntel(
      [
        "dependents",
        target,
        "--depth=2",
        "--project",
        "server",
        "--exclude-tests",
        "--format=json",
      ],
      context,
    );
    expect(JSON.parse(filteredJsonOutput)).toMatchObject({
      count: 2,
      byProject: { server: 2 },
    });

    const jsonOutput = runCodeIntel(["dependents", target, "--depth", "2", "--format=json"], {
      graphProject: project,
      repoRoot,
      resolver,
    });
    expect(JSON.parse(jsonOutput)).toMatchObject({
      header: "dependents packages/shared/src/rules/core.ts",
      count: 4,
      meta: { depth: 2 },
      byProject: { client: 1, server: 3 },
    });

    const limitedOutput = runCodeIntel(
      ["dependents", target, "--depth", "2", "--limit", "1"],
      context,
    );
    expect(limitedOutput).toContain(
      "dependents packages/shared/src/rules/core.ts (4 results, depth=2) -- client: 1, server: 3",
    );
    expect(limitedOutput).toContain("packages/client/src/core-view.ts direct");
    expect(limitedOutput).toContain("... and 3 more");
    expect(limitedOutput).not.toContain("packages/server/src/direct.ts direct");

    const limitedJsonOutput = runCodeIntel(
      ["dependents", target, "--depth", "2", "--limit=1", "--format=json"],
      context,
    );
    expect(JSON.parse(limitedJsonOutput)).toMatchObject({
      count: 1,
      limit: 1,
      total: 4,
      truncated: true,
      byProject: { client: 1, server: 3 },
    });

    expect(() => runCodeIntel(["dependents", target, "--project", "bogus"], context)).toThrow(
      CodeIntelError,
    );
    expect(() => runCodeIntel(["dependents", target, "--exclude-tests=false"], context)).toThrow(
      CodeIntelError,
    );
    expect(() => runCodeIntel(["dependents"], context)).toThrow(
      /dependents <file> .* \[--limit <N>\]/u,
    );
  });

  it("finds likely tests without treating vi.mock targets as coverage", () => {
    const project = createFixtureProject();
    addSource(
      project,
      "packages/server/src/services/live.ts",
      "export const live = () => 1;\nexport type Live = ReturnType<typeof live>;\n",
    );
    addSource(
      project,
      "packages/server/src/services/live.test.ts",
      "test('co-located', () => {});\n",
    );
    addSource(
      project,
      "packages/server/src/services/live.slow.test.ts",
      "test('slow', () => {});\n",
    );
    addSource(
      project,
      "packages/server/src/services/live-direct.test.ts",
      'import { live } from "./live.js"; test("direct", () => live());\n',
    );
    addSource(
      project,
      "packages/server/src/services/live-type-only.test.ts",
      'import { type Live } from "./live.js"; test("type only", () => {});\n',
    );
    addSource(
      project,
      "packages/server/src/services/live-mixed-type.test.ts",
      'import { live, type Live } from "./live.js"; const value: Live = live(); test("mixed", () => value);\n',
    );
    addSource(
      project,
      "packages/server/src/services/live-helper.ts",
      'import { live } from "./live.js"; export const helper = live;\n',
    );
    addSource(
      project,
      "packages/server/src/services/live-transitive.test.ts",
      'import { helper } from "./live-helper.js"; test("transitive", () => helper());\n',
    );
    addSource(
      project,
      "packages/server/src/services/live-dynamic.test.ts",
      'test("dynamic", async () => import("./live.js"));\n',
    );
    addSource(
      project,
      "packages/server/src/services/live-mock-only.test.ts",
      'import { vi } from "vitest"; vi.mock("./live.js"); test("mock", () => {});\n',
    );
    addSource(
      project,
      "packages/server/src/services/live-mock-factory.test.ts",
      'import { vi } from "vitest"; vi.mock("./other.js", async () => import("./live.js"));\n',
    );
    addSource(
      project,
      "packages/server/src/services/live-type-barrel.ts",
      'export { type Live } from "./live.js"; export const helper = 1;\n',
    );
    addSource(
      project,
      "packages/server/src/services/live-type-barrel.test.ts",
      'import { helper } from "./live-type-barrel.js"; test("type barrel", () => helper);\n',
    );
    addSource(
      project,
      "packages/server/src/services/live-value-barrel.ts",
      'export { live, type Live } from "./live.js";\n',
    );
    addSource(
      project,
      "packages/server/src/services/live-value-barrel.test.ts",
      'import { live } from "./live-value-barrel.js"; test("value barrel", () => live());\n',
    );
    const resolver = createFixtureResolver(project);
    const results = queryTests(
      resolver,
      graphFor(project, resolver),
      "packages/server/src/services/live.ts",
    );

    expect(fileResult(results, "packages/server/src/services/live.test.ts")).toMatchObject({
      kind: "test",
      reason: "co-located",
      slow: false,
    });
    expect(fileResult(results, "packages/server/src/services/live.slow.test.ts")).toMatchObject({
      kind: "test",
      reason: "co-located",
      slow: true,
    });
    expect(fileResult(results, "packages/server/src/services/live-direct.test.ts")).toMatchObject({
      kind: "test",
      reason: "direct",
    });
    expect(
      fileResult(results, "packages/server/src/services/live-mixed-type.test.ts"),
    ).toMatchObject({
      kind: "test",
      reason: "direct",
    });
    expect(
      fileResult(results, "packages/server/src/services/live-transitive.test.ts"),
    ).toMatchObject({
      kind: "test",
      reason: "transitive",
      depth: 2,
    });
    expect(fileResult(results, "packages/server/src/services/live-dynamic.test.ts")).toMatchObject({
      kind: "test",
      reason: "direct",
      via: "dynamic",
    });
    expect(
      fileResult(results, "packages/server/src/services/live-value-barrel.test.ts"),
    ).toMatchObject({
      kind: "test",
      reason: "transitive",
      depth: 2,
    });
    expect(
      fileResult(results, "packages/server/src/services/live-mock-factory.test.ts"),
    ).toMatchObject({
      kind: "test",
      reason: "direct",
      via: "dynamic",
    });
    expect(hasFileResult(results, "packages/server/src/services/live-type-only.test.ts")).toBe(
      false,
    );
    expect(hasFileResult(results, "packages/server/src/services/live-type-barrel.test.ts")).toBe(
      false,
    );
    expect(hasFileResult(results, "packages/server/src/services/live-mock-only.test.ts")).toBe(
      false,
    );
  });

  it("limits tests query depth while keeping co-located tests", () => {
    const project = createFixtureProject();
    addSource(project, "packages/server/src/services/live.ts", "export const live = () => 1;\n");
    addSource(
      project,
      "packages/server/src/services/live.test.ts",
      "test('co-located', () => {});\n",
    );
    addSource(
      project,
      "packages/server/src/services/a-live-direct.test.ts",
      'import { live } from "./live.js"; test("direct", () => live());\n',
    );
    addSource(
      project,
      "packages/server/src/services/live-direct.test.ts",
      'import { live } from "./live.js"; test("direct", () => live());\n',
    );
    addSource(
      project,
      "packages/server/src/services/live-helper.ts",
      'import { live } from "./live.js"; export const helper = live;\n',
    );
    addSource(
      project,
      "packages/server/src/services/live-transitive.test.ts",
      'import { helper } from "./live-helper.js"; test("transitive", () => helper());\n',
    );
    const resolver = createFixtureResolver(project);
    const graph = graphFor(project, resolver);
    const context = { graphProject: project, repoRoot, resolver };
    const target = "packages/server/src/services/live.ts";
    const results = queryTests(resolver, graph, target, {
      depth: 1,
    });

    expect(results.map((result) => ("file" in result ? result.file : ""))).toEqual([
      "packages/server/src/services/live.test.ts",
      "packages/server/src/services/a-live-direct.test.ts",
      "packages/server/src/services/live-direct.test.ts",
    ]);
    expect(fileResult(results, "packages/server/src/services/live.test.ts")).toMatchObject({
      reason: "co-located",
    });
    expect(fileResult(results, "packages/server/src/services/a-live-direct.test.ts")).toMatchObject(
      {
        reason: "direct",
      },
    );
    expect(fileResult(results, "packages/server/src/services/live-direct.test.ts")).toMatchObject({
      reason: "direct",
    });
    expect(hasFileResult(results, "packages/server/src/services/live-transitive.test.ts")).toBe(
      false,
    );

    const limitedOutput = runCodeIntel(["tests", target, "--direct", "--limit", "1"], context);
    expect(limitedOutput).toContain("tests packages/server/src/services/live.ts (3 results)");
    expect(limitedOutput).toContain("packages/server/src/services/live.test.ts co-located");
    expect(limitedOutput).toContain("... and 2 more");
    expect(limitedOutput).not.toContain("packages/server/src/services/a-live-direct.test.ts");

    const limitedJsonOutput = runCodeIntel(
      ["tests", target, "--direct", "--limit=1", "--format=json"],
      context,
    );
    expect(JSON.parse(limitedJsonOutput)).toMatchObject({
      count: 1,
      limit: 1,
      total: 3,
      truncated: true,
      results: [
        {
          file: "packages/server/src/services/live.test.ts",
          kind: "test",
          reason: "co-located",
        },
      ],
    });
  });

  it("parses tests depth, direct, project filters, and invalid flags", () => {
    const project = createFixtureProject();
    addSource(project, "packages/shared/src/rules/core.ts", "export const core = () => 1;\n");
    addSource(
      project,
      "packages/shared/src/rules/core.test.ts",
      'import { core } from "./core.js"; test("shared", () => core());\n',
    );
    addSource(
      project,
      "packages/server/src/core-helper.ts",
      'import { core } from "@musi/shared/rules/core.js"; export const serverCore = core;\n',
    );
    addSource(
      project,
      "packages/server/src/core-helper.test.ts",
      'import { serverCore } from "./core-helper.js"; test("server", () => serverCore());\n',
    );
    addSource(
      project,
      "packages/client/src/core.test.ts",
      'import { core } from "@musi/shared/rules/core.js"; test("client", () => core());\n',
    );
    const resolver = createFixtureResolver(project);
    const context = { graphProject: project, repoRoot, resolver };
    const target = "packages/shared/src/rules/core.ts";

    const depthTwoOutput = runCodeIntel(["tests", target, "--depth", "2"], context);
    expect(depthTwoOutput).toContain(
      "packages/server/src/core-helper.test.ts transitive candidate (depth=2)",
    );

    const directOutput = runCodeIntel(["tests", target, "--direct"], context);
    expect(directOutput).toContain("packages/client/src/core.test.ts direct candidate");
    expect(directOutput).not.toContain("packages/server/src/core-helper.test.ts");
    // tests is file-anchored and guarded at input, so it carries no scope
    // statement; only discovery-mode (def --name) output does.
    expect(directOutput).not.toContain("Scope:");

    const limitedOutput = runCodeIntel(["tests", target, "--depth", "2", "--limit", "1"], context);
    expect(limitedOutput).toContain("tests packages/shared/src/rules/core.ts (3 results)");
    expect(limitedOutput).toContain("... and 2 more");

    const serverOutput = runCodeIntel(["tests", target, "--project", "server"], context);
    expect(serverOutput).toContain("packages/server/src/core-helper.test.ts");
    expect(serverOutput).not.toContain("packages/shared/src/rules/core.test.ts");
    expect(serverOutput).not.toContain("packages/client/src/core.test.ts");

    const helpOutput = runCodeIntel(["--help"], context);
    expect(helpOutput).toContain(
      "tests <file> [--depth <N>] [--direct] [--project <shared|server|client>] [--limit <N>]",
    );
    expect(helpOutput).toContain(
      "tests packages/server/src/services/level-up/level-up.ts --direct",
    );
    expect(helpOutput).not.toContain("tests packages/server/src/services/level-up.ts");
    expect(helpOutput).toContain("not an exact coverage oracle");

    const subcommandHelpOutput = runCodeIntel(["dependents", "--help"], context);
    expect(subcommandHelpOutput).toContain("dependents <file>");
    expect(subcommandHelpOutput).toContain("--limit 20");

    expect(() => runCodeIntel(["tests", target, "--depth", "0"], context)).toThrow(CodeIntelError);
    expect(() => runCodeIntel(["tests", target, "--limit", "-1"], context)).toThrow(CodeIntelError);
    expect(() => runCodeIntel(["tests", target, "--direct", "--depth", "1"], context)).toThrow(
      CodeIntelError,
    );
    expect(() => runCodeIntel(["tests", target, "--bogus"], context)).toThrow(CodeIntelError);
    expect(() => runCodeIntel(["tests"], context)).toThrow(/tests <file> .* \[--limit <N>\]/u);
  });
});
