import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import type { SourceFile } from "ts-morph";
import { Project } from "ts-morph";

import { CodeIntelError } from "./errors.js";
import { isSameOrInside, samePath, toSlash } from "./path-utils.js";
import {
  SCRIPT_FIXTURE_DIR,
  SCRIPT_SOURCE_DIR,
  WORKSPACE_PACKAGE_DIRS,
} from "./types.js";
import type { WorkspaceResolver } from "./workspace-resolver.js";

export type CodeIntelContext = {
  graphProject?: Project;
  project?: Project;
  repoRoot?: string;
  resolver?: WorkspaceResolver;
  sourceFiles?: SourceFile[];
};

export function sourceFilesForGraph(repoRoot: string, context: CodeIntelContext): SourceFile[] {
  if (context.sourceFiles) return context.sourceFiles;
  if (context.graphProject) return workspaceSourceFiles(context.graphProject.getSourceFiles());

  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const sourcePaths = discoverWorkspaceSourcePaths(repoRoot);
  project.addSourceFilesAtPaths(sourcePaths);
  return workspaceSourceFiles(project.getSourceFiles());
}

export function createProjectForFile(repoRoot: string, file: string): Project {
  const relative = toSlash(path.relative(repoRoot, path.resolve(repoRoot, file)));
  const packageDir = WORKSPACE_PACKAGE_DIRS.find((candidate) =>
    relative.startsWith(`${candidate}/`),
  );
  if (packageDir) {
    return new Project({ tsConfigFilePath: path.join(repoRoot, packageDir, "tsconfig.json") });
  }
  if (relative.startsWith(`${SCRIPT_SOURCE_DIR}/`)) {
    return new Project({ tsConfigFilePath: path.join(repoRoot, "tsconfig.scripts.json") });
  }
  throw new CodeIntelError(
    `File must be under ${WORKSPACE_PACKAGE_DIRS.join(", ")} or ${SCRIPT_SOURCE_DIR}: ${file}`,
  );
}

export function getProjectSourceFile(project: Project, file: string): SourceFile {
  const targetPath = path.resolve(file);
  const existing = project
    .getSourceFiles()
    .find((sourceFile) => samePath(sourceFile.getFilePath(), targetPath));
  if (existing) return existing;
  const added = project.addSourceFileAtPathIfExists(targetPath);
  if (added) return added;
  throw new CodeIntelError(`File is not in the TypeScript project: ${file}`);
}

export function getOptionalProjectSourceFile(
  project: Project,
  file: string,
): SourceFile | undefined {
  const targetPath = path.resolve(file);
  const existing = project
    .getSourceFiles()
    .find((sourceFile) => samePath(sourceFile.getFilePath(), targetPath));
  if (existing) return existing;
  return project.addSourceFileAtPathIfExists(targetPath);
}

export function existingRelativeFile(resolver: WorkspaceResolver, file: string): string {
  const target = resolver.relative(file);
  if (!isSourceFilePath(target)) {
    throw new CodeIntelError(`File must be a TypeScript source file: ${target}`);
  }
  if (!resolver.fileExistsRelative(target)) throw new CodeIntelError(`File not found: ${target}`);
  if (!resolver.fileIsFileRelative(target))
    throw new CodeIntelError(`File is not a file: ${target}`);
  return target;
}

function discoverWorkspaceSourcePaths(repoRoot: string): string[] {
  const paths: string[] = [];
  for (const packageDir of WORKSPACE_PACKAGE_DIRS) {
    const sourceRoot = path.join(repoRoot, packageDir, "src");
    if (!existsSync(sourceRoot)) continue;
    collectSourcePaths(sourceRoot, paths);
  }
  const scriptRoot = path.join(repoRoot, SCRIPT_SOURCE_DIR);
  if (existsSync(scriptRoot)) {
    collectSourcePaths(scriptRoot, paths, [path.join(repoRoot, SCRIPT_FIXTURE_DIR)]);
  }
  return paths.sort((left, right) => left.localeCompare(right, "en"));
}

function collectSourcePaths(directory: string, paths: string[], ignoredDirs: string[] = []): void {
  if (ignoredDirs.some((ignoredDir) => isSameOrInside(directory, ignoredDir))) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const currentPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSourcePaths(currentPath, paths, ignoredDirs);
      continue;
    }
    if (!entry.isFile() && !statSync(currentPath).isFile()) continue;
    if (!isSourceFilePath(currentPath)) continue;
    paths.push(currentPath);
  }
}

function workspaceSourceFiles(sourceFiles: SourceFile[]): SourceFile[] {
  return sourceFiles.filter((sourceFile) => {
    const filePath = toSlash(sourceFile.getFilePath());
    return (
      WORKSPACE_PACKAGE_DIRS.some((packageDir) => filePath.includes(`${packageDir}/src/`)) ||
      filePath.includes(`/${SCRIPT_SOURCE_DIR}/`)
    );
  });
}

function isSourceFilePath(file: string): boolean {
  return /\.tsx?$/u.test(file) && !file.endsWith(".d.ts");
}
