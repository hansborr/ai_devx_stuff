import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * `scripts/typecheck.sh` runs the `tsc -p tsconfig.e2e.json` lane concurrently
 * with `tsc -b`. The e2e project maps `@musi/server/router-type` to server
 * source, and that source imports `@musi/shared`, whose `package.json#exports`
 * point at the gitignored `dist/`. Unless the e2e project maps those specifiers
 * to source as well, the lane's result depends on whether the concurrent build
 * happens to have (re)written `dist/` first: TS2307 on a cold tree, a stale
 * contract on a warm one.
 *
 * These tests resolve the e2e project's real module graph against a compiler
 * host that hides every package `dist/`, which is what a cold checkout looks
 * like.
 */
const REPO_ROOT = path.resolve(__dirname, "..");
const E2E_TSCONFIG = path.join(REPO_ROOT, "tsconfig.e2e.json");
const SERVER_SRC = path.join(REPO_ROOT, "packages/server/src");

function loadE2eCompilerConfig(): ts.ParsedCommandLine {
  const configFile = ts.readConfigFile(E2E_TSCONFIG, (fileName) => ts.sys.readFile(fileName));
  if (configFile.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
  }
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    REPO_ROOT,
    undefined,
    E2E_TSCONFIG,
  );
  if (parsed.errors.length > 0) {
    throw new Error(
      parsed.errors
        .map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n"))
        .join("\n"),
    );
  }
  return parsed;
}

/**
 * Emulates a cold checkout: every workspace package's built `dist/` tree is
 * missing. Both spellings matter — TypeScript probes the package through the
 * `node_modules/@musi/*` install symlink and only reports the realpath under
 * `packages/*` once a candidate file exists.
 */
function isBuildOutput(candidate: string): boolean {
  return /[\\/](?:packages|@musi)[\\/][^\\/]+[\\/]dist(?:[\\/]|$)/.test(candidate);
}

/** The tree as it stands, built output included. */
const warmTreeHost: ts.ModuleResolutionHost = {
  fileExists: (fileName) => ts.sys.fileExists(fileName),
  readFile: (fileName) => ts.sys.readFile(fileName),
  directoryExists: (directoryName) => ts.sys.directoryExists(directoryName),
  getDirectories: (directoryName) => ts.sys.getDirectories(directoryName),
  realpath: (candidate) => ts.sys.realpath?.(candidate) ?? candidate,
  getCurrentDirectory: () => REPO_ROOT,
  useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
};

/** The same tree before `tsc -b` has run, or while it is rewriting `dist/`. */
const coldTreeHost: ts.ModuleResolutionHost = {
  ...warmTreeHost,
  fileExists: (fileName) => !isBuildOutput(fileName) && ts.sys.fileExists(fileName),
  readFile: (fileName) => (isBuildOutput(fileName) ? undefined : ts.sys.readFile(fileName)),
  directoryExists: (directoryName) =>
    !isBuildOutput(directoryName) && ts.sys.directoryExists(directoryName),
};

interface WorkspaceImport {
  containingFile: string;
  specifier: string;
}

/**
 * Every source file the e2e lane compiles directly, plus the server source it
 * reaches through the mapped router type. Server test files are excluded: they
 * are not part of the `AppRouter` graph.
 */
function collectE2eLaneContainingFiles(): string[] {
  const serverSourceFiles = ts.sys
    .readDirectory(SERVER_SRC, [".ts"])
    .filter((file) => !/\.(?:test|spec|test-helper)\.ts$/.test(file))
    .filter((file) => !/[\\/]src[\\/]test[\\/]/.test(file));
  return [...new Set([...serverSourceFiles, ...loadE2eCompilerConfig().fileNames])];
}

function collectE2eLaneWorkspaceImports(): WorkspaceImport[] {
  const imports: WorkspaceImport[] = [];
  for (const containingFile of collectE2eLaneContainingFiles()) {
    const text = ts.sys.readFile(containingFile);
    if (text === undefined) continue;
    for (const imported of ts.preProcessFile(text, true, true).importedFiles) {
      if (!imported.fileName.startsWith("@musi/")) continue;
      imports.push({ containingFile, specifier: imported.fileName });
    }
  }
  return imports;
}

function resolveFromE2eProject(
  specifier: string,
  containingFile: string,
  options: ts.CompilerOptions,
  host: ts.ModuleResolutionHost,
): string | undefined {
  return ts.resolveModuleName(specifier, containingFile, options, host).resolvedModule
    ?.resolvedFileName;
}

describe("tsconfig.e2e.json module resolution", () => {
  const options = loadE2eCompilerConfig().options;

  it("scans e2e sources and the Playwright config", () => {
    const containingFiles = collectE2eLaneContainingFiles();

    expect(containingFiles).toEqual(
      expect.arrayContaining([
        path.join(REPO_ROOT, "e2e/helpers/api.ts"),
        path.join(REPO_ROOT, "playwright.config.ts"),
      ]),
    );
  });

  it("resolves the router type entry point to server source", () => {
    const resolved = resolveFromE2eProject(
      "@musi/server/router-type",
      path.join(REPO_ROOT, "e2e/helpers/api.ts"),
      options,
      warmTreeHost,
    );

    expect(resolved).toBe(path.join(REPO_ROOT, "packages/server/src/routers/app-router.ts"));
  });

  it("resolves every e2e-lane workspace import without a built dist", () => {
    // Cold checkout: the lane must not depend on the concurrent `tsc -b`.
    const workspaceImports = collectE2eLaneWorkspaceImports();
    // Guards against the scan silently matching nothing (e.g. a moved src dir).
    expect(workspaceImports.length).toBeGreaterThan(0);

    const unresolved = workspaceImports.filter(
      ({ containingFile, specifier }) =>
        resolveFromE2eProject(specifier, containingFile, options, coldTreeHost) === undefined,
    );

    expect(unresolved).toEqual([]);
  });

  it("never resolves a workspace import to build output when one exists", () => {
    // Warm tree: a `dist/` the concurrent build is rewriting must not be the
    // contract the e2e lane typechecks against.
    const resolvedToDist = collectE2eLaneWorkspaceImports()
      .map(({ containingFile, specifier }) => ({
        specifier,
        resolved: resolveFromE2eProject(specifier, containingFile, options, warmTreeHost),
      }))
      .filter(({ resolved }) => resolved !== undefined && isBuildOutput(resolved));

    expect(resolvedToDist).toEqual([]);
  });
});
