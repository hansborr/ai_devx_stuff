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
    expect(formatCodeIntelQueryResult(execution, "text", command.kind)).toBe(
      runCodeIntel(["dependents", command.file, "--depth", "2"], context),
    );
    expect(formatCodeIntelQueryResult(execution, "json", command.kind)).toBe(
      runCodeIntel(["dependents", command.file, "--depth", "2", "--format=json"], context),
    );
  });

  it("fails loudly with the supported-scope error on out-of-scope single-file queries", () => {
    const project = createFixtureProject();
    addSource(project, "packages/shared/src/rules/core.ts", "export const core = () => 1;\n");
    addSource(
      project,
      "tools/lint-ratchet/src/atomic-write.ts",
      "export const writeFileAtomicallySync = () => 1;\n",
    );
    const resolver = createFixtureResolver(project);
    // No context.project: def/exports/overview must reach the
    // createProjectForFile guard, exactly as one-shot CLI runs do.
    const context = { graphProject: project, referenceProject: project, repoRoot, resolver };
    // Out-of-scope targets must hit the supported-scope error on every
    // single-file query path, not return empty or incomplete output that
    // reads as authority (decision record: docs/guides/code-intel.md).
    const scopeError = (file: string): string =>
      "File must be under packages/shared/src, packages/server/src, packages/client/src, " +
      `or scripts (excluding scripts/codemods/fixtures): ${file}`;
    const outOfScope = "tools/lint-ratchet/src/atomic-write.ts";

    expect(() => runCodeIntel(["dependents", outOfScope], context)).toThrow(scopeError(outOfScope));
    expect(() => runCodeIntel(["tests", outOfScope], context)).toThrow(scopeError(outOfScope));
    expect(() => runCodeIntel(["refs", `${outOfScope}:1:14`], context)).toThrow(
      scopeError(outOfScope),
    );
    expect(() => runCodeIntel(["def", `${outOfScope}:1:14`], context)).toThrow(
      scopeError(outOfScope),
    );
    expect(() => runCodeIntel(["exports", outOfScope], context)).toThrow(scopeError(outOfScope));
    expect(() => runCodeIntel(["overview", outOfScope], context)).toThrow(scopeError(outOfScope));

    // Files inside advertised package/script directories but outside the
    // discovery roots (non-src package files, codemod fixtures) are equally
    // out of scope and must error, not return an authoritative-looking empty.
    const nonSrcPackageFile = "packages/server/prisma/seed.ts";
    const fixtureFile = "scripts/codemods/fixtures/widget.ts";
    expect(() => runCodeIntel(["dependents", nonSrcPackageFile], context)).toThrow(
      scopeError(nonSrcPackageFile),
    );
    expect(() => runCodeIntel(["exports", nonSrcPackageFile], context)).toThrow(
      scopeError(nonSrcPackageFile),
    );
    expect(() => runCodeIntel(["tests", fixtureFile], context)).toThrow(scopeError(fixtureFile));
    expect(() => runCodeIntel(["def", `${fixtureFile}:1:1`], context)).toThrow(
      scopeError(fixtureFile),
    );

    // Build artifacts must be judged as named: the resolver's dist -> src
    // source mapping exists for graph edges, not user input, so a dist/ or
    // node_modules path is out of scope even when its src twin (added at the
    // top of this test) exists.
    const distFile = "packages/shared/dist/rules/core.js";
    const nodeModulesFile = "node_modules/@musi/shared/dist/rules/core.js";
    expect(() => runCodeIntel(["dependents", distFile], context)).toThrow(scopeError(distFile));
    expect(() => runCodeIntel(["tests", distFile], context)).toThrow(scopeError(distFile));
    expect(() => runCodeIntel(["refs", `${distFile}:1:14`], context)).toThrow(scopeError(distFile));
    expect(() => runCodeIntel(["dependents", nodeModulesFile], context)).toThrow(
      scopeError(nodeModulesFile),
    );
  });

  it("reports directory and bare-root inputs as non-source files, not scope violations", () => {
    const project = createFixtureProject();
    addSource(project, "packages/shared/src/rules/core.ts", "export const core = () => 1;\n");
    const resolver = createFixtureResolver(project);
    const context = { graphProject: project, referenceProject: project, repoRoot, resolver };
    // A bare discovery root fails the trailing-slash scope predicate, so the
    // scope error would tell the caller their path "must be under" the very
    // root they passed. Extensionless inputs get the source-file error
    // instead; extension-shaped out-of-scope paths (dist/, node_modules)
    // must keep the scope error — that split is pinned here.
    const sourceFileError = (file: string): string =>
      `File must be a TypeScript source file: ${file}`;

    expect(() => runCodeIntel(["dependents", "packages/shared/src"], context)).toThrow(
      sourceFileError("packages/shared/src"),
    );
    expect(() => runCodeIntel(["tests", "scripts"], context)).toThrow(sourceFileError("scripts"));
    expect(() => runCodeIntel(["refs", "packages/shared/src:1:1"], context)).toThrow(
      sourceFileError("packages/shared/src"),
    );
    expect(() =>
      runCodeIntel(["dependents", "packages/shared/dist/rules/core.js"], context),
    ).toThrow(
      "File must be under packages/shared/src, packages/server/src, packages/client/src, " +
        "or scripts (excluding scripts/codemods/fixtures): packages/shared/dist/rules/core.js",
    );
  });
});
