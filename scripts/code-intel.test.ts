import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ModuleKind, ModuleResolutionKind, Project, ScriptTarget } from "ts-morph";
import { describe, expect, it } from "vitest";

import {
  buildImportGraph,
  CodeIntelError,
  createWorkspaceResolver,
  executeCodeIntelQuery,
  formatCodeIntelQueryResult,
  queryDefinition,
  queryDependents,
  queryExports,
  queryTests,
  runCodeIntel,
} from "./code-intel.js";
import type { ExecutableCliCommand, IntelResult } from "./code-intel.js";

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
    fileIsFile: (filePath) => project.getSourceFile(path.resolve(filePath)) !== undefined,
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

function spawnCodeIntel(args: string[]): SpawnSyncReturns<string> {
  return spawnSync("bun", ["scripts/code-intel.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

describe("code:intel CLI front door", () => {
  it("keeps help and parse errors on the thin path before one-shot fallback", () => {
    const entrypoint = readFileSync(path.join(process.cwd(), "scripts/code-intel.ts"), "utf8");
    const cliMain = readFileSync(
      path.join(process.cwd(), "scripts/code-intel/cli-main.ts"),
      "utf8",
    );

    expect(entrypoint).not.toContain('from "./code-intel/runner.js"');
    expect(cliMain).toContain('await import("./runner.js")');

    const help = spawnCodeIntel(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage:");
    expect(help.stdout).toContain("bun run code:intel -- [--format text|json] def --name <symbol>");
    expect(help.stderr).toBe("");

    const parseError = spawnCodeIntel(["def"]);
    expect(parseError.status).toBe(1);
    expect(parseError.stdout).toBe("");
    expect(parseError.stderr).toContain(
      "Usage: bun run code:intel -- def <file>:<line>:<col> OR def --name <symbol>",
    );
  });
});

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

    const snappedResults = queryDefinition(project, resolver, {
      file: "packages/shared/src/rules/consumer.ts",
      line: 2,
      col: 21,
    });
    expect(snappedResults).toContainEqual({
      kind: "definition",
      name: "sum",
      file: "packages/shared/src/rules/math.ts",
      line: 1,
      col: 14,
      exportKind: "value export",
    });

    const nameOutput = runCodeIntel(["def", "--name", "sum"], {
      graphProject: project,
      repoRoot,
      resolver,
    });
    expect(nameOutput).toContain("definition sum");
    expect(nameOutput).toContain("packages/shared/src/rules/math.ts:1:14 value export");
  });

  it("surfaces capped prefix hints for name-only definition misses", () => {
    const project = createFixtureProject();
    const nearNames = Array.from(
      { length: 11 },
      (_, index) => `useCharacterMatch${String(index).padStart(2, "0")}`,
    );
    addSource(
      project,
      "packages/client/src/hooks/use-character.ts",
      `${nearNames.map((name, index) => `export const ${name} = ${index};`).join("\n")}\n`,
    );
    addSource(project, "scripts/builders.ts", "const buildEncounterDraft = () => 1;\n");
    const resolver = createFixtureResolver(project);
    const context = { graphProject: project, repoRoot, resolver };

    const output = runCodeIntel(["def", "--name", "useCharacter"], context);
    expect(output).toContain("definition useCharacter (0 results)");
    expect(output).toContain("no definitions found");
    expect(output).toContain("near matches (11 total): useCharacterMatch00, useCharacterMatch01");
    expect(output).toContain(", ...");
    expect(output).not.toContain("useCharacterMatch10");

    const jsonOutput = runCodeIntel(["def", "--name", "useCharacter", "--format=json"], context);
    expect(JSON.parse(jsonOutput)).toEqual({
      header: "definition useCharacter",
      count: 0,
      results: [],
      nearMatches: nearNames.slice(0, 10).map((name, index) => ({
        name,
        file: "packages/client/src/hooks/use-character.ts",
        line: index + 1,
        col: 14,
        exportKind: "value export",
      })),
      nearMatchTotal: 11,
    });

    expect(runCodeIntel(["def", "--name", "buildEncounter"], context)).toContain(
      "near matches (1 total): buildEncounterDraft",
    );
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
});
