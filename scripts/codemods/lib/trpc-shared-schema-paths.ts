import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { Project, type SourceFile } from "ts-morph";

import { fail, ROUTER_ROOT, SHARED_SCHEMA_PREFIX, SHARED_SCHEMA_ROOT } from "./trpc-shared-schema-types.js";

export function normalizeRelativeRouterPath(
  codemodName: string,
  root: string,
  routerPath: string,
): string {
  const relative = path.relative(root, routerPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(codemodName, "Router file must be inside the current repository.");
  }
  if (!relative.startsWith(`${ROUTER_ROOT}${path.sep}`)) {
    fail(codemodName, `Router file must be under ${ROUTER_ROOT}.`);
  }
  if (/\.test\.tsx?$/.test(relative)) fail(codemodName, "Test router files are not supported.");
  if (!relative.endsWith(".ts")) fail(codemodName, "Router file must be a .ts file.");
  return relative;
}

export function discoverRouterFiles(root: string): string[] {
  const routerRoot = path.join(root, ROUTER_ROOT);
  if (!existsSync(routerRoot)) return [];

  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const currentPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(currentPath);
        continue;
      }
      if (!statSync(currentPath).isFile()) continue;
      if (!currentPath.endsWith(".ts") || /\.test\.tsx?$/.test(currentPath)) continue;
      files.push(path.relative(root, currentPath));
    }
  };

  visit(routerRoot);
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

export function validateSharedSchemaSource(codemodName: string, source: string): void {
  if (!source.startsWith(SHARED_SCHEMA_PREFIX) || !source.endsWith(".js")) {
    fail(codemodName, "--target must be an @musi/shared/schemas/*.js module source.");
  }
  const suffix = source.slice(SHARED_SCHEMA_PREFIX.length);
  const segments = suffix.split("/");
  if (
    path.isAbsolute(suffix) ||
    path.win32.isAbsolute(suffix) ||
    suffix.includes("\\") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    fail(codemodName, `--target must stay under ${SHARED_SCHEMA_ROOT}.`);
  }
}

export function targetPathFromSource(root: string, source: string): string {
  const fileName = source.slice(SHARED_SCHEMA_PREFIX.length).replace(/\.[cm]?js$/u, ".ts");
  const schemaRoot = path.resolve(root, SHARED_SCHEMA_ROOT);
  const targetPath = path.resolve(schemaRoot, fileName);
  const relative = path.relative(schemaRoot, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Shared schema target escaped ${SHARED_SCHEMA_ROOT}: ${source}`);
  }
  return targetPath;
}

function relativeSharedModuleSource(targetSource: string, dependencyPath: string): string {
  const targetSuffix = targetSource.slice(SHARED_SCHEMA_PREFIX.length);
  const targetModulePath = path.posix.join("schemas", targetSuffix);
  const relativeSource = path.posix.relative(path.posix.dirname(targetModulePath), dependencyPath);
  return relativeSource.startsWith(".") ? relativeSource : `./${relativeSource}`;
}

export function rewriteAllowedSharedImportSource(
  codemodName: string,
  source: string,
  targetSource: string,
): string | undefined {
  validateSharedSchemaSource(codemodName, targetSource);
  if (source === "@musi/shared/constants") {
    return relativeSharedModuleSource(targetSource, "constants.js");
  }
  if (!source.startsWith(SHARED_SCHEMA_PREFIX) || !source.endsWith(".js")) return undefined;
  validateSharedSchemaSource(codemodName, source);
  const dependencyPath = path.posix.join("schemas", source.slice(SHARED_SCHEMA_PREFIX.length));
  return relativeSharedModuleSource(targetSource, dependencyPath);
}

export function getSourceFileAtPath(project: Project, filePath: string): SourceFile {
  return project.getSourceFile(filePath) ?? project.addSourceFileAtPath(filePath);
}
