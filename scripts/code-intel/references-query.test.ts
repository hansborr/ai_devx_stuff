import { describe, expect, it } from "vitest";

import { executeCodeIntelQuery } from "./query-executor.js";
import { runCodeIntel } from "./runner.js";
import {
  addSource,
  createFixtureResolver,
  createReferenceFixtureProject,
  repoRoot,
} from "./test-fixtures.test-helper.js";
import type { ExecutableCliCommand } from "./types.js";

describe("references-query", () => {
  it("finds references across packages and classifies import, value, and type kinds", () => {
    const project = createReferenceFixtureProject();
    addSource(
      project,
      "packages/shared/src/rules/core.ts",
      "export const core = () => 1;\nexport type CoreFn = typeof core;\n",
    );
    addSource(
      project,
      "packages/server/src/direct.ts",
      'import { core } from "@musi/shared/rules/core.js";\nexport const direct = core();\n',
    );
    addSource(
      project,
      "packages/server/src/renamed.ts",
      'import { core as renamedCore } from "@musi/shared/rules/core.js";\nexport const useRenamed = renamedCore();\n',
    );
    addSource(
      project,
      "packages/client/src/core-view.tsx",
      'import { core, type CoreFn } from "@musi/shared/rules/core.js";\nconst alias: CoreFn = core;\nexport const View = () => alias();\n',
    );
    addSource(
      project,
      "scripts/core-script.ts",
      'import { core } from "@musi/shared/rules/core.js";\nexport const tool = () => core();\n',
    );
    const resolver = createFixtureResolver(project);
    const context = { referenceProject: project, repoRoot, resolver };

    const refsCommand: Extract<ExecutableCliCommand, { kind: "refs" }> = {
      kind: "refs",
      location: { col: 14, file: "packages/shared/src/rules/core.ts", line: 1 },
    };
    const execution = executeCodeIntelQuery(refsCommand, context);

    expect(execution).toMatchObject({
      kind: "results",
      header: "references core",
    });
    if (execution.kind !== "results") throw new Error("expected results kind");
    const referencesByFile = execution.results.flatMap((result) =>
      result.kind === "reference"
        ? [{ file: result.file, line: result.line, col: result.col, kind: result.referenceKind }]
        : [],
    );
    expect(referencesByFile).toEqual([
      { file: "packages/client/src/core-view.tsx", line: 1, col: 10, kind: "import" },
      { file: "packages/client/src/core-view.tsx", line: 2, col: 23, kind: "value" },
      { file: "packages/server/src/direct.ts", line: 1, col: 10, kind: "import" },
      { file: "packages/server/src/direct.ts", line: 2, col: 23, kind: "value" },
      { file: "packages/server/src/renamed.ts", line: 1, col: 10, kind: "import" },
      { file: "packages/server/src/renamed.ts", line: 1, col: 18, kind: "import" },
      { file: "packages/server/src/renamed.ts", line: 2, col: 27, kind: "value" },
      { file: "packages/shared/src/rules/core.ts", line: 2, col: 29, kind: "type" },
      { file: "scripts/core-script.ts", line: 1, col: 10, kind: "import" },
      { file: "scripts/core-script.ts", line: 2, col: 27, kind: "value" },
    ]);

    const textOutput = runCodeIntel(["refs", "packages/shared/src/rules/core.ts:1:14"], context);
    expect(textOutput).toContain("references core (10 results)");
    expect(textOutput).toContain("packages/server/src/renamed.ts:1:10 import");
    expect(textOutput).toContain("packages/server/src/renamed.ts:1:18 import");
    expect(textOutput).toContain("packages/server/src/renamed.ts:2:27 value");
    expect(textOutput).not.toContain("packages/shared/src/rules/core.ts:1:14");

    const snapped = runCodeIntel(["refs", "packages/shared/src/rules/core.ts:1:13"], context);
    expect(snapped).toBe(textOutput);

    const jsonOutput: unknown = JSON.parse(
      runCodeIntel(["refs", "packages/shared/src/rules/core.ts:1:14", "--format=json"], context),
    );
    expect(jsonOutput).toMatchObject({
      header: "references core",
      count: 10,
    });

    const limitedJson: unknown = JSON.parse(
      runCodeIntel(
        ["refs", "packages/shared/src/rules/core.ts:1:14", "--limit", "2", "--format=json"],
        context,
      ),
    );
    expect(limitedJson).toMatchObject({
      count: 2,
      limit: 2,
      total: 10,
      truncated: true,
    });

    const typeRefsCommand: Extract<ExecutableCliCommand, { kind: "refs" }> = {
      kind: "refs",
      location: { col: 13, file: "packages/shared/src/rules/core.ts", line: 2 },
    };
    const typeRefs = executeCodeIntelQuery(typeRefsCommand, context);
    if (typeRefs.kind !== "results") throw new Error("expected results kind");
    const typeKinds = typeRefs.results.map((result) =>
      result.kind === "reference"
        ? `${result.file}:${String(result.line)}:${String(result.col)} ${result.referenceKind}`
        : "",
    );
    expect(typeKinds).toContain("packages/client/src/core-view.tsx:1:21 import");
    expect(typeKinds).toContain("packages/client/src/core-view.tsx:2:14 type");

    const empty = runCodeIntel(["refs", "scripts/core-script.ts:2:15"], context);
    expect(empty).toContain("references tool (0 results)");
    expect(empty).toContain("no references found");
  });

  it("classifies heritage and assertion references by runtime/type position", () => {
    const project = createReferenceFixtureProject();
    addSource(
      project,
      "packages/shared/src/rules/heritage.ts",
      [
        "export class Base { value = 1; }",
        "export interface Contract { value: number; }",
        "export type Box<T extends Base> = T;",
        "export class Child extends Base implements Contract { value = 2; }",
        "const cast = new Child() as Base;",
        "const satisfied = { value: 1 } satisfies Contract;",
        "export const derived: Base = cast;",
        "",
      ].join("\n"),
    );
    const resolver = createFixtureResolver(project);
    const context = { referenceProject: project, repoRoot, resolver };

    const baseRefs = executeCodeIntelQuery(
      {
        kind: "refs",
        location: { col: 14, file: "packages/shared/src/rules/heritage.ts", line: 1 },
      },
      context,
    );
    if (baseRefs.kind !== "results") throw new Error("expected results kind");
    const baseKinds = baseRefs.results.map((result) =>
      result.kind === "reference"
        ? `${result.file}:${String(result.line)}:${String(result.col)} ${result.referenceKind}`
        : "",
    );
    expect(baseKinds).toContain("packages/shared/src/rules/heritage.ts:3:27 type");
    expect(baseKinds).toContain("packages/shared/src/rules/heritage.ts:4:28 value");
    expect(baseKinds).toContain("packages/shared/src/rules/heritage.ts:5:29 type");
    expect(baseKinds).toContain("packages/shared/src/rules/heritage.ts:7:23 type");

    const contractRefs = executeCodeIntelQuery(
      {
        kind: "refs",
        location: { col: 18, file: "packages/shared/src/rules/heritage.ts", line: 2 },
      },
      context,
    );
    if (contractRefs.kind !== "results") throw new Error("expected results kind");
    const contractKinds = contractRefs.results.map((result) =>
      result.kind === "reference"
        ? `${result.file}:${String(result.line)}:${String(result.col)} ${result.referenceKind}`
        : "",
    );
    expect(contractKinds).toContain("packages/shared/src/rules/heritage.ts:4:44 type");
    expect(contractKinds).toContain("packages/shared/src/rules/heritage.ts:6:42 type");

    expect(() => runCodeIntel(["refs", "packages/shared/src/rules/heritage.ts"], context)).toThrow(
      /References location must include :line:col/u,
    );
  });
});
