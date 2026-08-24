import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultDaemonTransport, requestDaemonQuery } from "./daemon-client.js";
import {
  CODE_INTEL_DAEMON_PROTOCOL_VERSION,
  DAEMON_FALLBACK_ERROR_NAME,
} from "./daemon-protocol.js";
import { runDaemon, type RunningDaemon } from "./daemon-server.js";
import { readDaemonMetadata, resolveDaemonStatePaths } from "./daemon-state.js";
import { CodeIntelError } from "./errors.js";
import { formatCodeIntelQueryResult } from "./format.js";
import { GraphCache } from "./graph-cache.js";
import { ProjectCache } from "./project-cache.js";
import { executeCodeIntelQuery } from "./query-executor.js";
import {
  addSource,
  createFixtureProject,
  createFixtureResolver,
  graphFor,
} from "./test-fixtures.test-helper.js";
import type { CodeIntelQueryResult, ExecutableCliCommand } from "./types.js";

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
      timeoutMs: 15_000,
    });
    const daemonResult = expectDaemonResult(outcome);
    expect(formatCodeIntelQueryResult(daemonResult, "text", command.kind)).toBe(
      formatCodeIntelQueryResult(oneShot, "text", command.kind),
    );
    expect(formatCodeIntelQueryResult(daemonResult, "json", command.kind)).toBe(
      formatCodeIntelQueryResult(oneShot, "json", command.kind),
    );
    return formatCodeIntelQueryResult(daemonResult, "text", command.kind);
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

  it("maps every undecodable request to one-shot fallback semantics", async () => {
    const daemon = await startDiskDaemon();
    try {
      const malformedCommand = await requestDaemonQuery(
        { kind: "defName", name: "example" },
        {
          repoRoot,
          state: { rootDir: stateRoot },
          transport: (socketPath, payload, timeoutMs) => {
            const request = JSON.parse(payload) as { id: string; protocolVersion: number };
            return defaultDaemonTransport(
              socketPath,
              JSON.stringify({
                command: { kind: "def" },
                id: request.id,
                protocolVersion: request.protocolVersion,
              }),
              timeoutMs,
            );
          },
        },
      );
      expect(malformedCommand.kind).toBe("fallback");
      if (malformedCommand.kind === "fallback") {
        expect(malformedCommand.reason).toContain("Request does not match daemon protocol");
      }

      const nonStringId = await defaultDaemonTransport(
        daemon.paths.socketPath,
        JSON.stringify({
          command: { kind: "defName", name: "example" },
          id: 42,
          protocolVersion: CODE_INTEL_DAEMON_PROTOCOL_VERSION,
        }),
        1000,
      );
      expect(JSON.parse(nonStringId)).toMatchObject({
        error: { name: DAEMON_FALLBACK_ERROR_NAME },
        id: "unknown",
        ok: false,
      });
    } finally {
      await daemon.shutdown();
    }
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
