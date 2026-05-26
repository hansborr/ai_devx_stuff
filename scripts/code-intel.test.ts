import type { SpawnSyncReturns } from "node:child_process";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ModuleKind, ModuleResolutionKind, Project, ScriptTarget, ts } from "ts-morph";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CodeIntelQueryResult, ExecutableCliCommand, IntelResult, WorkspaceResolver } from "./code-intel.js";
import {
  buildImportGraph,
  CODE_INTEL_DAEMON_PROTOCOL_VERSION,
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
import { DaemonRequestTimeoutError, requestDaemonQuery } from "./code-intel/daemon-client.js";
import type { DaemonSpawner } from "./code-intel/daemon-process.js";
import { runDaemon, type RunningDaemon } from "./code-intel/daemon-server.js";
import {
  buildDaemonMetadata,
  computeRepoKey,
  ensureStateDir,
  readDaemonMetadata,
  resolveDaemonStatePaths,
  writeDaemonMetadata,
} from "./code-intel/daemon-state.js";
import {
  computeWorkspaceManifest,
  GraphCache,
  graphCacheTest,
} from "./code-intel/graph-cache.js";
import { ProjectCache } from "./code-intel/project-cache.js";
import { runServerCliCommand } from "./code-intel/server-cli.js";

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

function createReferenceFixtureProject(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      allowJs: false,
      baseUrl: repoRoot,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ModuleKind.Node16,
      moduleResolution: ModuleResolutionKind.Node16,
      paths: {
        "@/*": [path.join(repoRoot, "packages/client/src/*")],
        "@musi/shared/*": [path.join(repoRoot, "packages/shared/src/*")],
        "@musi/server/*": [path.join(repoRoot, "packages/server/src/*")],
        "@musi/client/*": [path.join(repoRoot, "packages/client/src/*")],
      },
      resolveJsonModule: true,
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

function createFixtureResolver(project: Project): WorkspaceResolver {
  return createWorkspaceResolver(repoRoot, {
    fileExists: (filePath) => project.getSourceFile(path.resolve(filePath)) !== undefined,
    fileIsFile: (filePath) => project.getSourceFile(path.resolve(filePath)) !== undefined,
    packages: packageConfigs,
  });
}

function graphFor(project: Project, resolver: WorkspaceResolver): ReturnType<typeof buildImportGraph> {
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
    expect(help.stdout).toContain(
      "Daemon/perf: bun run code:intel:server -- restart|status|stop; bun run code:intel:perf",
    );
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
      `${nearNames.map((name, index) => `export const ${name} = ${String(index)};`).join("\n")}\n`,
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

describe("code:intel:server lifecycle", () => {
  let tempRoot: string;
  let stateRoot: string;
  let repoA: string;
  let repoB: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), "code-intel-server-"));
    stateRoot = path.join(tempRoot, "state");
    repoA = path.join(tempRoot, "repo-a");
    repoB = path.join(tempRoot, "repo-b");
    mkdirSync(repoA, { recursive: true });
    mkdirSync(repoB, { recursive: true });
    mkdirSync(stateRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true });
  });

  function pathsFor(repo: string): ReturnType<typeof resolveDaemonStatePaths> {
    return resolveDaemonStatePaths(repo, { rootDir: stateRoot });
  }

  function seedRunningDaemon(repo: string, pid: number): void {
    const paths = pathsFor(repo);
    ensureStateDir(paths);
    writeDaemonMetadata(
      paths,
      buildDaemonMetadata({ paths, pid, repoRealpath: repo, repoRoot: repo }),
    );
    writeFileSync(paths.socketPath, "");
  }

  function okProbe(): Promise<{ ok: true }> {
    return Promise.resolve({ ok: true });
  }

  function failedProbe(): Promise<{
    failureKind: "unverified";
    ok: false;
    reason: string;
  }> {
    return Promise.resolve({
      failureKind: "unverified",
      ok: false,
      reason: "socket probe timed out",
    });
  }

  it("derives different state directories per repo realpath", () => {
    const aPaths = pathsFor(repoA);
    const bPaths = pathsFor(repoB);
    expect(aPaths.stateDir).not.toBe(bPaths.stateDir);
    expect(aPaths.stateDir).toContain(stateRoot);
    expect(bPaths.stateDir).toContain(stateRoot);
    expect(path.basename(aPaths.stateDir)).toBe(computeRepoKey(repoA));
    expect(path.basename(bPaths.stateDir)).toBe(computeRepoKey(repoB));
  });

  it("status distinguishes absent, running, and stale daemons", async () => {
    const absent = await runServerCliCommand(["status"], {
      repoRoot: repoA,
      state: { rootDir: stateRoot },
    });
    expect(absent.exitCode).toBe(0);
    expect(absent.output).toContain("absent");

    seedRunningDaemon(repoA, process.pid);
    const running = await runServerCliCommand(["status"], {
      repoRoot: repoA,
      state: { rootDir: stateRoot },
      isAlive: () => true,
      probeDaemon: okProbe,
    });
    expect(running.output).toContain("running");
    expect(running.output).toContain(`pid ${String(process.pid)}`);

    const stale = await runServerCliCommand(["status"], {
      repoRoot: repoA,
      state: { rootDir: stateRoot },
      isAlive: () => false,
    });
    expect(stale.output).toContain("stale");
  });

  it("status validates a daemon with the built-in ping command", async () => {
    const daemon = await runDaemon({
      paths: pathsFor(repoA),
      repoRealpath: repoA,
      repoRoot: repoA,
      signalEvents: [],
    });
    try {
      const status = await runServerCliCommand(["status"], {
        repoRoot: repoA,
        state: { rootDir: stateRoot },
      });
      expect(status.exitCode).toBe(0);
      expect(status.output).toContain("running");
      expect(status.output).toContain(`pid ${String(process.pid)}`);
    } finally {
      await daemon.shutdown();
    }
  });

  it("stop removes live and stale state", async () => {
    seedRunningDaemon(repoA, process.pid);
    const livePaths = pathsFor(repoA);
    expect(existsSync(livePaths.metadataPath)).toBe(true);

    let stopSignalled = false;
    const liveStop = await runServerCliCommand(["stop"], {
      repoRoot: repoA,
      state: { rootDir: stateRoot },
      isAlive: () => true,
      probeDaemon: okProbe,
      stopProcess: () => {
        stopSignalled = true;
        return Promise.resolve(true);
      },
    });
    expect(liveStop.output).toContain("stopped");
    expect(stopSignalled).toBe(true);
    expect(existsSync(livePaths.stateDir)).toBe(false);

    seedRunningDaemon(repoB, 999_999);
    const stalePaths = pathsFor(repoB);
    const staleStop = await runServerCliCommand(["stop"], {
      repoRoot: repoB,
      state: { rootDir: stateRoot },
      isAlive: () => false,
    });
    expect(staleStop.output).toContain("cleared stale state");
    expect(existsSync(stalePaths.stateDir)).toBe(false);

    const noState = await runServerCliCommand(["stop"], {
      repoRoot: repoA,
      state: { rootDir: stateRoot },
      isAlive: () => false,
    });
    expect(noState.output).toContain("no state to stop");
  });

  it("restart spawns a fresh daemon and waits for readiness", async () => {
    seedRunningDaemon(repoA, process.pid);
    const stalePid = process.pid;
    const stalePaths = pathsFor(repoA);
    let stopped = false;
    const fakeSpawner: DaemonSpawner = (resolvedRepo, _scriptPath) => {
      const targetPaths = resolveDaemonStatePaths(resolvedRepo, { rootDir: stateRoot });
      ensureStateDir(targetPaths);
      writeDaemonMetadata(
        targetPaths,
        buildDaemonMetadata({
          paths: targetPaths,
          pid: 424242,
          repoRealpath: resolvedRepo,
          repoRoot: resolvedRepo,
        }),
      );
      writeFileSync(targetPaths.socketPath, "");
      return { pid: 424242 };
    };

    const result = await runServerCliCommand(["restart"], {
      repoRoot: repoA,
      state: { rootDir: stateRoot },
      isAlive: (pid: number) => {
        if (pid === stalePid) return !stopped;
        return pid === 424242;
      },
      probeDaemon: okProbe,
      spawner: fakeSpawner,
      stopProcess: () => {
        stopped = true;
        return Promise.resolve(true);
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("started");
    expect(result.output).toContain("pid 424242");
    expect(existsSync(stalePaths.socketPath)).toBe(true);
    expect(existsSync(stalePaths.metadataPath)).toBe(true);
  });

  it("recovers lifecycle commands from corrupt metadata", async () => {
    const paths = pathsFor(repoA);
    ensureStateDir(paths);
    writeFileSync(paths.metadataPath, "{ not valid json");
    writeFileSync(paths.pidPath, `${String(process.pid)}\n`);
    writeFileSync(paths.socketPath, "");

    const status = await runServerCliCommand(["status"], {
      repoRoot: repoA,
      state: { rootDir: stateRoot },
    });
    expect(status.output).toContain("invalid state");

    let stopCalled = false;
    const stop = await runServerCliCommand(["stop"], {
      repoRoot: repoA,
      state: { rootDir: stateRoot },
      isAlive: () => true,
      stopProcess: () => {
        stopCalled = true;
        return Promise.resolve(true);
      },
    });
    expect(stop.output).toContain("cleared invalid state");
    expect(stopCalled).toBe(false);
    expect(existsSync(paths.stateDir)).toBe(false);

    ensureStateDir(paths);
    writeFileSync(paths.metadataPath, JSON.stringify({ pid: "not-a-number" }));
    writeFileSync(paths.pidPath, `${String(process.pid)}\n`);
    writeFileSync(paths.socketPath, "");
    const result = await runServerCliCommand(["restart"], {
      repoRoot: repoA,
      state: { rootDir: stateRoot },
      isAlive: (pid: number) => pid === 424243,
      spawner: (resolvedRepo) => {
        const targetPaths = resolveDaemonStatePaths(resolvedRepo, { rootDir: stateRoot });
        ensureStateDir(targetPaths);
        writeDaemonMetadata(
          targetPaths,
          buildDaemonMetadata({
            paths: targetPaths,
            pid: 424243,
            repoRealpath: resolvedRepo,
            repoRoot: resolvedRepo,
          }),
        );
        writeFileSync(targetPaths.socketPath, "");
        return { pid: 424243 };
      },
      stopProcess: () => {
        stopCalled = true;
        return Promise.resolve(true);
      },
    });
    expect(result.output).toContain("started");
    expect(stopCalled).toBe(false);
  });

  it("preserves unverifiable live PID state without signaling it", async () => {
    seedRunningDaemon(repoA, process.pid);
    const paths = pathsFor(repoA);
    let stopCalled = false;

    const stop = await runServerCliCommand(["stop"], {
      repoRoot: repoA,
      state: { rootDir: stateRoot },
      isAlive: () => true,
      probeDaemon: failedProbe,
      stopProcess: () => {
        stopCalled = true;
        return Promise.resolve(true);
      },
    });
    expect(stop.exitCode).toBe(1);
    expect(stop.output).toContain("state preserved");
    expect(stop.output).toContain("socket probe timed out");
    expect(stopCalled).toBe(false);
    expect(existsSync(paths.stateDir)).toBe(true);
  });

  it("restart preserves unverifiable live PID state without spawning", async () => {
    seedRunningDaemon(repoA, process.pid);
    let stopCalled = false;
    let spawnCalled = false;

    const result = await runServerCliCommand(["restart"], {
      repoRoot: repoA,
      state: { rootDir: stateRoot },
      isAlive: (pid: number) => pid === process.pid || pid === 424244,
      probeDaemon: failedProbe,
      spawner: (resolvedRepo) => {
        spawnCalled = true;
        const targetPaths = resolveDaemonStatePaths(resolvedRepo, { rootDir: stateRoot });
        ensureStateDir(targetPaths);
        writeDaemonMetadata(
          targetPaths,
          buildDaemonMetadata({
            paths: targetPaths,
            pid: 424244,
            repoRealpath: resolvedRepo,
            repoRoot: resolvedRepo,
          }),
        );
        writeFileSync(targetPaths.socketPath, "");
        return { pid: 424244 };
      },
      stopProcess: () => {
        stopCalled = true;
        return Promise.resolve(true);
      },
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("restart skipped");
    expect(result.output).toContain("state preserved");
    expect(stopCalled).toBe(false);
    expect(spawnCalled).toBe(false);
    expect(existsSync(pathsFor(repoA).stateDir)).toBe(true);
  });

  it("stops an unresponsive daemon after verifying process identity", async () => {
    seedRunningDaemon(repoA, process.pid);
    const paths = pathsFor(repoA);
    let stopCalled = false;

    const stop = await runServerCliCommand(["stop"], {
      repoRoot: repoA,
      state: { rootDir: stateRoot },
      isAlive: () => true,
      probeDaemon: failedProbe,
      stopProcess: () => {
        stopCalled = true;
        return Promise.resolve(true);
      },
      verifyProcessIdentity: () => ({ kind: "verified" }),
    });
    expect(stop.exitCode).toBe(0);
    expect(stop.output).toContain("stopped");
    expect(stop.output).toContain("verifying process identity");
    expect(stopCalled).toBe(true);
    expect(existsSync(paths.stateDir)).toBe(false);
  });

  it("rejects unknown server subcommands with a usage hint", async () => {
    await expect(
      runServerCliCommand(["bogus"], { repoRoot: repoA, state: { rootDir: stateRoot } }),
    ).rejects.toThrow(/Unknown server command/u);
    await expect(
      runServerCliCommand([], { repoRoot: repoA, state: { rootDir: stateRoot } }),
    ).rejects.toThrow(/Usage:/u);
  });
});

describe("resolveGitDir", () => {
  const longGitdirPaddingLength = 4_000;

  let tempRoot: string;
  let fixtureRepoRoot: string;
  let gitPath: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), "code-intel-gitdir-"));
    fixtureRepoRoot = path.join(tempRoot, "repo");
    gitPath = path.join(fixtureRepoRoot, ".git");
    mkdirSync(fixtureRepoRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true });
  });

  function writeGitFile(content: string): void {
    writeFileSync(gitPath, content);
  }

  it("resolves gitfile paths with a separating space", () => {
    writeGitFile("gitdir: ../.git/worktrees/x\n");

    expect(graphCacheTest.resolveGitDir(fixtureRepoRoot, gitPath)).toBe(
      path.resolve(fixtureRepoRoot, "../.git/worktrees/x"),
    );
  });

  it("resolves gitfile paths without a separating space", () => {
    writeGitFile("gitdir:../x\n");

    expect(graphCacheTest.resolveGitDir(fixtureRepoRoot, gitPath)).toBe(
      path.resolve(fixtureRepoRoot, "../x"),
    );
  });

  it("resolves gitfile paths with a tab separator", () => {
    writeGitFile("gitdir:\t../x\n");

    expect(graphCacheTest.resolveGitDir(fixtureRepoRoot, gitPath)).toBe(
      path.resolve(fixtureRepoRoot, "../x"),
    );
  });

  it("rejects gitfile values split onto the next line", () => {
    writeGitFile("gitdir:\n../x");

    expect(graphCacheTest.resolveGitDir(fixtureRepoRoot, gitPath)).toBeUndefined();
  });

  it("falls back to no-git for empty gitfile values", () => {
    writeGitFile("gitdir:   \n");

    expect(graphCacheTest.resolveGitDir(fixtureRepoRoot, gitPath)).toBeUndefined();
    expect(graphCacheTest.readGitHead(fixtureRepoRoot)).toBe("no-git");
  });

  it("handles pathological gitfile whitespace without backtracking pressure", () => {
    writeGitFile(`gitdir: ${" ".repeat(longGitdirPaddingLength)}x\ny`);

    expect(graphCacheTest.readGitHead(fixtureRepoRoot)).toBe("no-git");
  });
});

describe("code:intel daemon query route", () => {
  const residentDaemonTestTimeoutMs = 20_000;

  let tempRoot: string;
  let stateRoot: string;
  let repoRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), "code-intel-daemon-"));
    stateRoot = path.join(tempRoot, "state");
    repoRoot = path.join(tempRoot, "repo");
    mkdirSync(repoRoot, { recursive: true });
    mkdirSync(stateRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true });
  });

  function writeRepoFile(file: string, text: string): void {
    const target = path.join(repoRoot, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
  }

  function writeRepoJson(file: string, value: unknown): void {
    writeRepoFile(file, `${JSON.stringify(value, null, 2)}\n`);
  }

  function createSymbolWorkspace(): void {
    writeRepoJson("package.json", { name: "code-intel-fixture", type: "module" });
    writeRepoFile("bun.lock", "");
    writeRepoJson("tsconfig.json", {
      files: [],
      references: [
        { path: "packages/shared" },
        { path: "packages/server" },
        { path: "packages/client" },
      ],
    });
    writeRepoJson("tsconfig.base.json", {
      compilerOptions: {
        composite: true,
        declaration: true,
        declarationMap: true,
        esModuleInterop: true,
        module: "Node16",
        moduleResolution: "Node16",
        skipLibCheck: true,
        strict: true,
        target: "ES2024",
      },
    });
    writeRepoJson("tsconfig.scripts.json", {
      compilerOptions: { composite: false, noEmit: true },
      extends: "./tsconfig.base.json",
      include: ["scripts/**/*.ts"],
    });
    writeRepoJson("packages/shared/package.json", {
      exports: {
        "./public-core": {
          default: "./dist/rules/core.js",
          types: "./dist/rules/core.d.ts",
        },
        "./rules/*.js": {
          default: "./dist/rules/*.js",
          types: "./dist/rules/*.d.ts",
        },
      },
      name: "@musi/shared",
      type: "module",
      version: "0.0.0",
    });
    writeRepoJson("packages/shared/tsconfig.json", {
      compilerOptions: { outDir: "dist", rootDir: "src" },
      extends: "../../tsconfig.base.json",
      include: ["src"],
    });
    writeRepoJson("packages/server/package.json", {
      dependencies: { "@musi/shared": "workspace:*" },
      name: "@musi/server",
      type: "module",
      version: "0.0.0",
    });
    writeRepoJson("packages/server/tsconfig.json", {
      extends: "../../tsconfig.base.json",
      include: ["src"],
      references: [{ path: "../shared" }],
    });
    writeRepoJson("packages/client/package.json", {
      dependencies: { "@musi/shared": "workspace:*" },
      name: "@musi/client",
      type: "module",
      version: "0.0.0",
    });
    writeRepoJson("packages/client/tsconfig.json", {
      compilerOptions: {
        baseUrl: ".",
        composite: false,
        declaration: false,
        declarationMap: false,
        jsx: "react-jsx",
        module: "ESNext",
        moduleResolution: "Bundler",
        noEmit: true,
        paths: { "@/*": ["./src/*"] },
        rootDir: "src",
      },
      extends: "../../tsconfig.base.json",
      include: ["src"],
      references: [{ path: "../shared" }],
    });
    writeRepoFile("packages/shared/src/rules/core.ts", "export const coreValue = () => 1;\n");
    writeRepoFile(
      "packages/shared/src/rules/index.ts",
      'export { coreValue as publicCoreValue } from "./core.js";\nexport const directShared = 2;\n',
    );
    writeRepoFile("packages/shared/src/rules/mutable.ts", "export const mutableValue = 1;\n");
    writeRepoFile(
      "packages/shared/dist/rules/core.d.ts",
      "export declare const coreValue: () => number;\n",
    );
    writeRepoFile(
      "packages/shared/dist/rules/index.d.ts",
      'export { coreValue as publicCoreValue } from "./core.js";\nexport declare const directShared: number;\n',
    );
    writeRepoFile(
      "packages/server/src/renamed.ts",
      'import { coreValue as renamedCoreValue } from "@musi/shared/rules/core.js";\nexport const serverValue = renamedCoreValue();\n',
    );
    writeRepoFile(
      "packages/server/src/public-core.ts",
      'import { coreValue as publicCoreValue } from "@musi/shared/public-core";\nexport const publicServerValue = publicCoreValue();\n',
    );
    writeRepoFile(
      "packages/client/src/lib/local-helper.ts",
      "export const localHelper = () => 2;\n",
    );
    writeRepoFile(
      "packages/client/src/components/view.tsx",
      'import { coreValue as clientCore } from "@musi/shared/rules/core.js";\nimport { localHelper as renamedLocalHelper } from "@/lib/local-helper.js";\nexport const View = () => clientCore() + renamedLocalHelper();\n',
    );
    writeRepoFile("scripts/tool.ts", "export const scriptTool = () => 1;\n");
    mkdirSync(path.join(repoRoot, "node_modules/@musi"), { recursive: true });
    symlinkSync(
      path.join(repoRoot, "packages/shared"),
      path.join(repoRoot, "node_modules/@musi/shared"),
      "dir",
    );
  }

  function defCommandAtSymbol(
    file: string,
    symbol: string,
    colOffset = 0,
  ): Extract<ExecutableCliCommand, { kind: "def" }> {
    const text = readFileSync(path.join(repoRoot, file), "utf8");
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line === undefined) continue;
      const column = line.indexOf(symbol);
      if (column === -1) continue;
      return {
        kind: "def",
        location: { col: column + 1 + colOffset, file, line: index + 1 },
      };
    }
    throw new Error(`Could not find ${symbol} in ${file}`);
  }

  async function startDiskDaemon(): Promise<RunningDaemon> {
    return runDaemon({
      paths: resolveDaemonStatePaths(repoRoot, { rootDir: stateRoot }),
      repoRealpath: repoRoot,
      repoRoot,
      signalEvents: [],
    });
  }

  async function expectDaemonMatchesOneShot(command: ExecutableCliCommand): Promise<string> {
    const oneShot = executeCodeIntelQuery(command, { repoRoot });
    const outcome = await requestDaemonQuery(command, {
      repoRoot,
      state: { rootDir: stateRoot },
    });
    const daemonResult = expectDaemonResult(outcome);
    expect(formatCodeIntelQueryResult(daemonResult, "text")).toBe(
      formatCodeIntelQueryResult(oneShot, "text"),
    );
    expect(formatCodeIntelQueryResult(daemonResult, "json")).toBe(
      formatCodeIntelQueryResult(oneShot, "json"),
    );
    return formatCodeIntelQueryResult(daemonResult, "text");
  }

  function expectDaemonResult(
    outcome: Awaited<ReturnType<typeof requestDaemonQuery>>,
  ): CodeIntelQueryResult {
    if (outcome.kind === "result") return outcome.result;
    throw new Error(`Expected daemon result, got fallback: ${outcome.reason}`);
  }

  function buildFixture(): {
    project: ReturnType<typeof createFixtureProject>;
    resolver: ReturnType<typeof createFixtureResolver>;
    graph: ReturnType<typeof graphFor>;
  } {
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
      "packages/server/src/core.test.ts",
      'import { core } from "@musi/shared/rules/core.js"; test("core", () => core());\n',
    );
    const resolver = createFixtureResolver(project);
    return { project, resolver, graph: graphFor(project, resolver) };
  }

  async function startFixtureDaemon(
    fixture: ReturnType<typeof buildFixture>,
  ): Promise<RunningDaemon> {
    const paths = resolveDaemonStatePaths(repoRoot, { rootDir: stateRoot });
    const graphCache = new GraphCache(repoRoot, {
      computeManifest: () => "fixture",
      rebuild: () => ({
        graph: fixture.graph,
        manifest: "fixture",
        resolver: fixture.resolver,
      }),
    });
    const projectCache = new ProjectCache(repoRoot, {
      computeManifest: () => "fixture",
      rebuild: () => ({
        graphProject: fixture.project,
        manifest: "fixture",
        projects: {
          client: fixture.project,
          scripts: fixture.project,
          server: fixture.project,
          shared: fixture.project,
        },
        resolver: fixture.resolver,
      }),
    });
    return runDaemon({
      graphCache,
      paths,
      projectCache,
      repoRealpath: repoRoot,
      repoRoot,
      signalEvents: [],
    });
  }

  it("answers dependents and tests from the daemon and matches one-shot output", async () => {
    const fixture = buildFixture();
    const daemon = await startFixtureDaemon(fixture);
    try {
      const dependents: ExecutableCliCommand = {
        depth: 2,
        excludeTests: false,
        file: "packages/shared/src/rules/core.ts",
        kind: "dependents",
      };
      const oneShot = executeCodeIntelQuery(dependents, {
        graphProject: fixture.project,
        repoRoot: "/repo",
        resolver: fixture.resolver,
      });
      const outcome = await requestDaemonQuery(dependents, {
        repoRoot,
        state: { rootDir: stateRoot },
      });
      expect(outcome).toEqual({ kind: "result", result: oneShot });

      const tests: ExecutableCliCommand = {
        depth: 3,
        file: "packages/shared/src/rules/core.ts",
        kind: "tests",
      };
      const oneShotTests = executeCodeIntelQuery(tests, {
        graphProject: fixture.project,
        repoRoot: "/repo",
        resolver: fixture.resolver,
      });
      const testsOutcome = await requestDaemonQuery(tests, {
        repoRoot,
        state: { rootDir: stateRoot },
      });
      expect(testsOutcome).toEqual({ kind: "result", result: oneShotTests });
    } finally {
      await daemon.shutdown();
    }
  });

  it(
    "answers definition modes from resident projects and matches one-shot output",
    async () => {
      createSymbolWorkspace();
      const daemon = await startDiskDaemon();
      try {
        const renamedImport = await expectDaemonMatchesOneShot(
          defCommandAtSymbol("packages/server/src/renamed.ts", "renamedCoreValue"),
        );
        expect(renamedImport).toContain("packages/shared/src/rules/core.ts:1:14 value export");
        expect(renamedImport).not.toContain("dist/rules/core.d.ts");

        const snappedImport = await expectDaemonMatchesOneShot(
          defCommandAtSymbol("packages/server/src/renamed.ts", "renamedCoreValue", -1),
        );
        expect(snappedImport).toBe(renamedImport);

        const clientAlias = await expectDaemonMatchesOneShot(
          defCommandAtSymbol("packages/client/src/components/view.tsx", "renamedLocalHelper"),
        );
        expect(clientAlias).toContain("packages/client/src/lib/local-helper.ts:1:14 value export");

        const byName = await expectDaemonMatchesOneShot({ kind: "defName", name: "coreValue" });
        expect(byName).toContain("packages/shared/src/rules/core.ts:1:14 value export");

        const nearMatch = await expectDaemonMatchesOneShot({ kind: "defName", name: "coreVal" });
        expect(nearMatch).toContain("near matches (1 total): coreValue");
      } finally {
        await daemon.shutdown();
      }
    },
    residentDaemonTestTimeoutMs,
  );

  it(
    "answers exports from resident projects and matches one-shot output",
    async () => {
      createSymbolWorkspace();
      const daemon = await startDiskDaemon();
      try {
        const directExports = await expectDaemonMatchesOneShot({
          file: "packages/shared/src/rules/core.ts",
          kind: "exports",
        });
        expect(directExports).toContain("coreValue value export");

        const reexports = await expectDaemonMatchesOneShot({
          file: "packages/shared/src/rules/index.ts",
          kind: "exports",
        });
        expect(reexports).toContain("directShared value export");
        expect(reexports).toContain("publicCoreValue value re-export");
      } finally {
        await daemon.shutdown();
      }
    },
    residentDaemonTestTimeoutMs,
  );

  it(
    "answers refs from the resident reference project and matches one-shot output",
    async () => {
      createSymbolWorkspace();
      const daemon = await startDiskDaemon();
      try {
        const refs = await expectDaemonMatchesOneShot({
          kind: "refs",
          location: { col: 14, file: "packages/shared/src/rules/core.ts", line: 1 },
        });
        expect(refs).toContain("references coreValue");
        expect(refs).toContain("packages/server/src/renamed.ts:1:10 import");
        expect(refs).toContain("packages/server/src/public-core.ts:1:10 import");
        expect(refs).toContain("packages/client/src/components/view.tsx:1:10 import");
        expect(refs).toContain("packages/shared/src/rules/index.ts:1:10 import");
        expect(refs).not.toContain("packages/shared/src/rules/core.ts:1:14");

        const snapped = await expectDaemonMatchesOneShot({
          kind: "refs",
          location: { col: 13, file: "packages/shared/src/rules/core.ts", line: 1 },
        });
        expect(snapped).toBe(refs);
      } finally {
        await daemon.shutdown();
      }
    },
    residentDaemonTestTimeoutMs,
  );

  it(
    "rebuilds resident projects on the first query after a manifest change",
    async () => {
      createSymbolWorkspace();
      const daemon = await startDiskDaemon();
      try {
        const initial = await expectDaemonMatchesOneShot({
          kind: "defName",
          name: "mutableValue",
        });
        expect(initial).toContain("packages/shared/src/rules/mutable.ts:1:14 value export");

        writeRepoFile(
          "packages/shared/src/rules/mutable.ts",
          "export const mutableValueAfterInvalidation = 2;\n",
        );

        const afterMutation = await expectDaemonMatchesOneShot({
          kind: "defName",
          name: "mutableValueAfterInvalidation",
        });
        expect(afterMutation).toContain("packages/shared/src/rules/mutable.ts:1:14 value export");
      } finally {
        await daemon.shutdown();
      }
    },
    residentDaemonTestTimeoutMs,
  );

  it("falls back when no daemon is running", async () => {
    const outcome = await requestDaemonQuery(
      {
        depth: 1,
        excludeTests: false,
        file: "packages/shared/src/rules/core.ts",
        kind: "dependents",
      },
      { repoRoot, state: { rootDir: stateRoot } },
    );
    expect(outcome.kind).toBe("fallback");
    if (outcome.kind === "fallback") expect(outcome.reason).toContain("absent");

    const symbolOutcome = await requestDaemonQuery(
      { kind: "defName", name: "coreValue" },
      { repoRoot, state: { rootDir: stateRoot } },
    );
    expect(symbolOutcome.kind).toBe("fallback");
    if (symbolOutcome.kind === "fallback") expect(symbolOutcome.reason).toContain("absent");
  });

  it("falls back when metadata advertises a different protocol version", async () => {
    const paths = resolveDaemonStatePaths(repoRoot, { rootDir: stateRoot });
    ensureStateDir(paths);
    writeDaemonMetadata(paths, {
      ...buildDaemonMetadata({ paths, pid: process.pid, repoRealpath: repoRoot, repoRoot }),
      protocolVersion: (CODE_INTEL_DAEMON_PROTOCOL_VERSION + 1) as 1,
    });
    writeFileSync(paths.socketPath, "");

    const outcome = await requestDaemonQuery(
      {
        depth: 1,
        excludeTests: false,
        file: "packages/shared/src/rules/core.ts",
        kind: "dependents",
      },
      { repoRoot, isAlive: () => true, state: { rootDir: stateRoot } },
    );
    expect(outcome.kind).toBe("fallback");
    if (outcome.kind === "fallback") expect(outcome.reason).toContain("protocol");

    const symbolOutcome = await requestDaemonQuery(
      { kind: "defName", name: "coreValue" },
      { repoRoot, isAlive: () => true, state: { rootDir: stateRoot } },
    );
    expect(symbolOutcome.kind).toBe("fallback");
    if (symbolOutcome.kind === "fallback") expect(symbolOutcome.reason).toContain("protocol");
  });

  it("falls back when daemon metadata is malformed instead of throwing", async () => {
    const paths = resolveDaemonStatePaths(repoRoot, { rootDir: stateRoot });
    ensureStateDir(paths);
    writeFileSync(paths.metadataPath, "{ not valid json");
    writeFileSync(paths.socketPath, "");

    const outcome = await requestDaemonQuery(
      {
        depth: 1,
        excludeTests: false,
        file: "packages/shared/src/rules/core.ts",
        kind: "dependents",
      },
      { repoRoot, isAlive: () => true, state: { rootDir: stateRoot } },
    );
    expect(outcome.kind).toBe("fallback");
    if (outcome.kind === "fallback") expect(outcome.reason).toContain("metadata");
  });

  it("falls back when daemon metadata fails the shape check", async () => {
    const paths = resolveDaemonStatePaths(repoRoot, { rootDir: stateRoot });
    ensureStateDir(paths);
    writeFileSync(paths.metadataPath, JSON.stringify({ pid: "not-a-number" }));
    writeFileSync(paths.socketPath, "");

    const outcome = await requestDaemonQuery(
      {
        depth: 1,
        excludeTests: false,
        file: "packages/shared/src/rules/core.ts",
        kind: "dependents",
      },
      { repoRoot, isAlive: () => true, state: { rootDir: stateRoot } },
    );
    expect(outcome.kind).toBe("fallback");
    if (outcome.kind === "fallback") expect(outcome.reason).toContain("metadata");
  });

  it("uses a longer refs timeout and avoids one-shot fallback after timeout", async () => {
    const paths = resolveDaemonStatePaths(repoRoot, { rootDir: stateRoot });
    ensureStateDir(paths);
    writeDaemonMetadata(
      paths,
      buildDaemonMetadata({ paths, pid: process.pid, repoRealpath: repoRoot, repoRoot }),
    );
    writeFileSync(paths.socketPath, "");

    let refsTimeout = 0;
    await expect(
      requestDaemonQuery(
        {
          kind: "refs",
          location: { col: 14, file: "packages/shared/src/rules/core.ts", line: 1 },
        },
        {
          isAlive: () => true,
          repoRoot,
          state: { rootDir: stateRoot },
          transport: (_socketPath, _payload, timeoutMs) => {
            refsTimeout = timeoutMs;
            return Promise.reject(new DaemonRequestTimeoutError(timeoutMs));
          },
        },
      ),
    ).rejects.toThrow(/Retry the query/u);
    expect(refsTimeout).toBe(30000);

    let graphTimeout = 0;
    const graphOutcome = await requestDaemonQuery(
      {
        depth: 1,
        excludeTests: false,
        file: "packages/shared/src/rules/core.ts",
        kind: "dependents",
      },
      {
        isAlive: () => true,
        repoRoot,
        state: { rootDir: stateRoot },
        transport: (_socketPath, _payload, timeoutMs) => {
          graphTimeout = timeoutMs;
          return Promise.reject(new DaemonRequestTimeoutError(timeoutMs));
        },
      },
    );
    expect(graphTimeout).toBe(5000);
    expect(graphOutcome.kind).toBe("fallback");
  });

  it("answers exports from the daemon and matches one-shot output", async () => {
    const fixture = buildFixture();
    const daemon = await startFixtureDaemon(fixture);
    try {
      const exportsCommand: ExecutableCliCommand = {
        file: "packages/shared/src/rules/core.ts",
        kind: "exports",
      };
      const oneShot = executeCodeIntelQuery(exportsCommand, {
        project: fixture.project,
        repoRoot: "/repo",
        resolver: fixture.resolver,
      });
      const outcome = await requestDaemonQuery(exportsCommand, {
        repoRoot,
        state: { rootDir: stateRoot },
      });
      expect(outcome).toEqual({ kind: "result", result: oneShot });
    } finally {
      await daemon.shutdown();
    }
  });

  it("propagates application errors from the daemon as CodeIntelError", async () => {
    const fixture = buildFixture();
    const daemon = await startFixtureDaemon(fixture);
    try {
      let caught: unknown;
      try {
        await requestDaemonQuery(
          {
            depth: 1,
            excludeTests: false,
            file: "packages/shared/src/rules/missing.ts",
            kind: "dependents",
          },
          { repoRoot, state: { rootDir: stateRoot } },
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(CodeIntelError);
      if (!(caught instanceof Error)) throw new Error("expected CodeIntelError");
      expect(caught.message).toBe(
        "code:intel: File not found: packages/shared/src/rules/missing.ts",
      );
    } finally {
      await daemon.shutdown();
    }
  });

  it("rebuilds cached state when the manifest fingerprint changes", () => {
    let manifest = "first";
    let rebuildCount = 0;
    const fixture = buildFixture();
    const cache = new GraphCache(repoRoot, {
      computeManifest: () => manifest,
      rebuild: () => {
        rebuildCount += 1;
        return { graph: fixture.graph, manifest, resolver: fixture.resolver };
      },
    });
    cache.ensure();
    cache.ensure();
    expect(rebuildCount).toBe(1);
    manifest = "second";
    cache.ensure();
    expect(rebuildCount).toBe(2);
  });

  it("fingerprints source contents for same-size edits", () => {
    createSymbolWorkspace();
    const target = path.join(repoRoot, "packages/shared/src/rules/mutable.ts");
    const originalStat = statSync(target);
    const before = computeWorkspaceManifest(repoRoot);

    writeFileSync(target, "export const mutableValue = 2;\n");
    utimesSync(target, originalStat.atime, originalStat.mtime);

    expect(computeWorkspaceManifest(repoRoot)).not.toBe(before);
  });

  it("preserves daemon metadata after a query", async () => {
    const fixture = buildFixture();
    const daemon = await startFixtureDaemon(fixture);
    try {
      await requestDaemonQuery(
        {
          depth: 1,
          excludeTests: false,
          file: "packages/shared/src/rules/core.ts",
          kind: "dependents",
        },
        { repoRoot, state: { rootDir: stateRoot } },
      );
      const metadata = readDaemonMetadata(
        resolveDaemonStatePaths(repoRoot, { rootDir: stateRoot }),
      );
      expect(metadata?.protocolVersion).toBe(CODE_INTEL_DAEMON_PROTOCOL_VERSION);
    } finally {
      await daemon.shutdown();
    }
  });
});
