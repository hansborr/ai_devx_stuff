import path from "node:path";

import { ModuleKind, ModuleResolutionKind, Project, ScriptTarget } from "ts-morph";
import { describe, expect, it } from "vitest";

import {
  buildImportGraph,
  CodeIntelError,
  createWorkspaceResolver,
  queryDefinition,
  queryDependents,
  queryExports,
  queryTests,
  runCodeIntel,
} from "./code-intel.js";
import type { IntelResult } from "./code-intel.js";

const repoRoot = "/repo";
const packageConfigs = [
  {
    name: "@musi/shared",
    packageRoot: "packages/shared",
    exports: {
      "./schemas/*.js": {
        types: "./dist/schemas/*.d.ts",
        default: "./dist/schemas/*.js",
      },
      "./rules/*.js": {
        types: "./dist/rules/*.d.ts",
        default: "./dist/rules/*.js",
      },
      "./dice/*.js": {
        types: "./dist/dice/*.d.ts",
        default: "./dist/dice/*.js",
      },
      "./map/*.js": {
        types: "./dist/map/*.d.ts",
        default: "./dist/map/*.js",
      },
      "./constants": {
        types: "./dist/constants.d.ts",
        default: "./dist/constants.js",
      },
    },
  },
  {
    name: "@musi/server",
    packageRoot: "packages/server",
    exports: {
      "./router-type": {
        types: "./dist/routers/app-router.d.ts",
      },
    },
  },
];

function createFixtureProject(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      module: ModuleKind.Node16,
      moduleResolution: ModuleResolutionKind.Node16,
      target: ScriptTarget.ES2024,
    },
  });
}

function sourcePath(file: string): string {
  return path.join(repoRoot, file);
}

function addSource(project: Project, file: string, text: string): void {
  project.createSourceFile(sourcePath(file), text, { overwrite: true });
}

function createFixtureResolver(project: Project) {
  return createWorkspaceResolver(repoRoot, {
    fileExists: (filePath) => project.getSourceFile(path.resolve(filePath)) !== undefined,
    packages: packageConfigs,
  });
}

function graphFor(project: Project, resolver: ReturnType<typeof createFixtureResolver>) {
  return buildImportGraph(project.getSourceFiles(), resolver);
}

function fileResult(results: IntelResult[], file: string): IntelResult {
  const result = results.find((candidate) => "file" in candidate && candidate.file === file);
  if (!result) throw new Error(`Missing result for ${file}`);
  return result;
}

function hasFileResult(results: IntelResult[], file: string): boolean {
  return results.some((candidate) => "file" in candidate && candidate.file === file);
}

describe("WorkspaceResolver", () => {
  it("maps package exports, client aliases, relative imports, and source equivalents", () => {
    const project = createFixtureProject();
    addSource(project, "packages/shared/src/schemas/character.ts", "export const character = 1;");
    addSource(project, "packages/shared/src/rules/attack.ts", "export const attack = 1;");
    addSource(project, "packages/shared/src/dice/dice-roller.ts", "export const roll = 1;");
    addSource(project, "packages/shared/src/map/grid-utils.tsx", "export const grid = 1;");
    addSource(project, "packages/shared/src/constants.ts", "export const VERSION = 'test';");
    addSource(project, "packages/server/src/routers/app-router.ts", "export type AppRouter = {};");
    addSource(
      project,
      "packages/client/src/components/button.tsx",
      "export const Button = () => null;",
    );
    addSource(project, "packages/client/src/lib/local.ts", "export const local = 1;");
    addSource(
      project,
      "packages/client/src/pages/home.tsx",
      "import { local } from '../lib/local'; export const home = local;",
    );

    const resolver = createFixtureResolver(project);

    expect(resolver.resolveModule("@musi/shared/schemas/character.js")).toBe(
      "packages/shared/src/schemas/character.ts",
    );
    expect(resolver.resolveModule("@musi/shared/rules/attack.js")).toBe(
      "packages/shared/src/rules/attack.ts",
    );
    expect(resolver.resolveModule("@musi/shared/dice/dice-roller.js")).toBe(
      "packages/shared/src/dice/dice-roller.ts",
    );
    expect(resolver.resolveModule("@musi/shared/map/grid-utils.js")).toBe(
      "packages/shared/src/map/grid-utils.tsx",
    );
    expect(resolver.resolveModule("@musi/shared/constants")).toBe(
      "packages/shared/src/constants.ts",
    );
    expect(resolver.resolveModule("@musi/server/router-type")).toBe(
      "packages/server/src/routers/app-router.ts",
    );
    expect(resolver.resolveModule("@/components/button.js")).toBe(
      "packages/client/src/components/button.tsx",
    );
    expect(resolver.resolveModule("../lib/local", "packages/client/src/pages/home.tsx")).toBe(
      "packages/client/src/lib/local.ts",
    );
  });

  it("maps real workspace package exports to source", () => {
    const resolver = createWorkspaceResolver(process.cwd());

    expect(resolver.resolveModule("@musi/shared/constants")).toBe(
      "packages/shared/src/constants.ts",
    );
    expect(resolver.resolveModule("@musi/server/router-type")).toBe(
      "packages/server/src/routers/app-router.ts",
    );
  });
});

describe("code intel queries", () => {
  it("finds definitions through TypeScript symbols and formats CLI output", () => {
    const project = createFixtureProject();
    addSource(
      project,
      "packages/shared/src/rules/math.ts",
      "export const sum = (left: number, right: number) => left + right;\n",
    );
    addSource(
      project,
      "packages/shared/src/rules/consumer.ts",
      'import { sum } from "./math.js";\nexport const total = sum(1, 2);\n',
    );
    const resolver = createFixtureResolver(project);

    const results = queryDefinition(project, resolver, {
      file: "packages/shared/src/rules/consumer.ts",
      line: 2,
      col: 22,
    });
    expect(results).toContainEqual({
      kind: "definition",
      name: "sum",
      file: "packages/shared/src/rules/math.ts",
      line: 1,
      col: 14,
      exportKind: "value export",
    });

    const output = runCodeIntel(["def", "packages/shared/src/rules/consumer.ts:2:22"], {
      project,
      repoRoot,
      resolver,
    });
    expect(output).toContain("definition sum");
    expect(output).toContain("packages/shared/src/rules/math.ts:1:14 value export");
  });

  it("lists direct exports and re-exports", () => {
    const project = createFixtureProject();
    addSource(project, "packages/shared/src/rules/math.ts", "export const sum = () => 1;\n");
    addSource(
      project,
      "packages/shared/src/rules/types.ts",
      "export type Thing = { id: string };\n",
    );
    addSource(
      project,
      "packages/shared/src/rules/index.ts",
      'export { sum } from "./math.js";\nexport type { Thing } from "./types.js";\nexport const direct = 1;\n',
    );
    const resolver = createFixtureResolver(project);

    expect(queryExports(project, resolver, "packages/shared/src/rules/index.ts")).toEqual([
      { kind: "export", name: "direct", exportKind: "value export" },
      { kind: "export", name: "sum", exportKind: "value re-export" },
      { kind: "export", name: "Thing", exportKind: "type re-export" },
    ]);
  });

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
    const results = queryTests(resolver, graph, "packages/server/src/services/live.ts", {
      depth: 1,
    });

    expect(fileResult(results, "packages/server/src/services/live.test.ts")).toMatchObject({
      reason: "co-located",
    });
    expect(fileResult(results, "packages/server/src/services/live-direct.test.ts")).toMatchObject({
      reason: "direct",
    });
    expect(hasFileResult(results, "packages/server/src/services/live-transitive.test.ts")).toBe(
      false,
    );
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
    expect(depthTwoOutput).toContain("packages/server/src/core-helper.test.ts transitive depth=2");

    const directOutput = runCodeIntel(["tests", target, "--direct"], context);
    expect(directOutput).toContain("packages/client/src/core.test.ts direct");
    expect(directOutput).not.toContain("packages/server/src/core-helper.test.ts");

    const serverOutput = runCodeIntel(["tests", target, "--project", "server"], context);
    expect(serverOutput).toContain("packages/server/src/core-helper.test.ts");
    expect(serverOutput).not.toContain("packages/shared/src/rules/core.test.ts");
    expect(serverOutput).not.toContain("packages/client/src/core.test.ts");

    const helpOutput = runCodeIntel(["--help"], context);
    expect(helpOutput).toContain(
      "tests <file> [--depth <N>] [--direct] [--project <shared|server|client>]",
    );
    expect(helpOutput).toContain("not an exact coverage oracle");

    expect(() => runCodeIntel(["tests", target, "--depth", "0"], context)).toThrow(CodeIntelError);
    expect(() => runCodeIntel(["tests", target, "--direct", "--depth", "1"], context)).toThrow(
      CodeIntelError,
    );
    expect(() => runCodeIntel(["tests", target, "--bogus"], context)).toThrow(CodeIntelError);
  });
});
