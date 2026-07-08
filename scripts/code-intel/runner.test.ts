import type { Project } from "ts-morph";
import { describe, expect, it } from "vitest";

import { CodeIntelError } from "./errors.js";
import { runCodeIntel } from "./runner.js";
import {
  addSource,
  createFixtureProject,
  createFixtureResolver,
  repoRoot,
} from "./test-fixtures.test-helper.js";
import type { WorkspaceResolver } from "./workspace-resolver.js";

describe("runCodeIntel", () => {
  it("supports scripts across definitions, exports, dependents, and tests", () => {
    const project = createFixtureProject();
    addSource(project, "scripts/tool.ts", "export const tool = () => 1;\n");
    addSource(
      project,
      "scripts/tool.test.ts",
      'import { tool } from "./tool.js"; test("tool", () => tool());\n',
    );
    addSource(
      project,
      "packages/server/src/uses-tool.ts",
      'import { tool } from "../../../scripts/tool.js"; export const value = tool();\n',
    );
    const resolver = createFixtureResolver(project);
    const context = { graphProject: project, project, repoRoot, resolver };

    expect(runCodeIntel(["exports", "scripts/tool.ts"], context)).toContain("tool value export");
    expect(runCodeIntel(["def", "scripts/tool.test.ts:1:10"], context)).toContain(
      "definition tool",
    );
    const dependentOutput = runCodeIntel(["dependents", "scripts/tool.ts"], context);
    expect(dependentOutput).toContain(
      "dependents scripts/tool.ts (2 results, depth=1) -- server: 1, scripts: 1",
    );
    expect(dependentOutput).toContain("scripts/tool.test.ts direct");
    expect(
      JSON.parse(runCodeIntel(["dependents", "scripts/tool.ts", "--format=json"], context)),
    ).toMatchObject({
      byProject: { server: 1, scripts: 1 },
    });
    expect(runCodeIntel(["tests", "scripts/tool.ts", "--direct"], context)).toContain(
      "scripts/tool.test.ts co-located",
    );
  });

  it("rejects non-source-file graph targets", () => {
    const project = createFixtureProject();
    addSource(project, "packages/server/src/services/live.ts", "export const live = () => 1;\n");
    const resolver = createFixtureResolver(project);
    const context = { graphProject: project, repoRoot, resolver };

    expect(() =>
      runCodeIntel(["tests", "packages/server/src/services/live", "--direct"], context),
    ).toThrow(/TypeScript source file/u);
    expect(() =>
      runCodeIntel(["dependents", "packages/server/src/services/live"], context),
    ).toThrow(/TypeScript source file/u);
  });

  function guardContext(): {
    graphProject: Project;
    repoRoot: string;
    resolver: WorkspaceResolver;
  } {
    const project = createFixtureProject();
    addSource(project, "packages/shared/src/rules/math.ts", "export const sum = () => 1;\n");
    const resolver = createFixtureResolver(project);
    return { graphProject: project, repoRoot, resolver };
  }

  it("rejects supplying both --name and a positional location to def", () => {
    const context = guardContext();
    expect(() =>
      runCodeIntel(["def", "--name", "sum", "packages/shared/src/rules/math.ts:1:1"], context),
    ).toThrow(/Use either def <file>:<line>:<col> or def --name <symbol>/u);
    expect(() =>
      runCodeIntel(["def", "--name", "sum", "packages/shared/src/rules/math.ts:1:1"], context),
    ).toThrow(CodeIntelError);
  });

  it("rejects refs with zero or multiple positional locations", () => {
    const context = guardContext();
    expect(() => runCodeIntel(["refs"], context)).toThrow(
      /Usage: bun run code:intel -- refs <file>:<line>:<col>/u,
    );
    expect(() => runCodeIntel(["refs", "a.ts:1:1", "b.ts:1:1"], context)).toThrow(
      /Usage: bun run code:intel -- refs <file>:<line>:<col>/u,
    );
    expect(() => runCodeIntel(["refs"], context)).toThrow(CodeIntelError);
  });
});
