import path from "node:path";

import { ModuleKind, ModuleResolutionKind, Project, ScriptTarget, ts } from "ts-morph";

import { buildImportGraph } from "./import-graph.js";
import type { IntelResult } from "./types.js";
import { createWorkspaceResolver, type WorkspaceResolver } from "./workspace-resolver.js";

export const repoRoot = "/repo";
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

export function createFixtureProject(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      module: ModuleKind.Node16,
      moduleResolution: ModuleResolutionKind.Node16,
      target: ScriptTarget.ES2024,
    },
  });
}

export function createReferenceFixtureProject(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      allowJs: false,
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

export function addSource(project: Project, file: string, text: string): void {
  project.createSourceFile(sourcePath(file), text, { overwrite: true });
}

export function createFixtureResolver(project: Project): WorkspaceResolver {
  return createWorkspaceResolver(repoRoot, {
    fileExists: (filePath) => project.getSourceFile(path.resolve(filePath)) !== undefined,
    fileIsFile: (filePath) => project.getSourceFile(path.resolve(filePath)) !== undefined,
    packages: packageConfigs,
  });
}

export function graphFor(
  project: Project,
  resolver: WorkspaceResolver,
): ReturnType<typeof buildImportGraph> {
  return buildImportGraph(project.getSourceFiles(), resolver);
}

export function fileResult(results: IntelResult[], file: string): IntelResult {
  const result = results.find((candidate) => "file" in candidate && candidate.file === file);
  if (!result) throw new Error(`Missing result for ${file}`);
  return result;
}

export function hasFileResult(results: IntelResult[], file: string): boolean {
  return results.some((candidate) => "file" in candidate && candidate.file === file);
}
