import { describe, expect, it } from "vitest";

import { formatCodeIntelQueryResult } from "./format.js";
import { executeCodeIntelQuery } from "./query-executor.js";
import { runCodeIntel } from "./runner.js";
import {
  addSource,
  createFixtureProject,
  createFixtureResolver,
  repoRoot,
} from "./test-fixtures.test-helper.js";
import type { ExecutableCliCommand } from "./types.js";

describe("query-executor", () => {
  it("executes structured commands without argv parsing", () => {
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
      "packages/client/src/core-view.ts",
      'import { core } from "@musi/shared/rules/core.js"; export const view = core;\n',
    );
    const resolver = createFixtureResolver(project);
    const context = { graphProject: project, repoRoot, resolver };
    const command: Extract<ExecutableCliCommand, { kind: "dependents" }> = {
      kind: "dependents",
      file: "packages/shared/src/rules/core.ts",
      depth: 2,
      excludeTests: false,
    };

    const execution = executeCodeIntelQuery(command, context);

    expect(execution).toMatchObject({
      kind: "results",
      header: "dependents packages/shared/src/rules/core.ts",
      metadata: { depth: 2 },
      projectSummary: { byProject: { client: 1, server: 2 } },
    });
    expect(formatCodeIntelQueryResult(execution, "text")).toBe(
      runCodeIntel(["dependents", command.file, "--depth", "2"], context),
    );
    expect(formatCodeIntelQueryResult(execution, "json")).toBe(
      runCodeIntel(["dependents", command.file, "--depth", "2", "--format=json"], context),
    );
  });
});
