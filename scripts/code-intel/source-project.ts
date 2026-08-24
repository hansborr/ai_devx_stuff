import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import type { SourceFile } from "ts-morph";
import { ModuleKind, ModuleResolutionKind, Project, ScriptTarget, ts } from "ts-morph";

import { CodeIntelError } from "./errors.js";
import { isSameOrInside, samePath, toSlash } from "./path-utils.js";
import type { ImportGraph } from "./types.js";
import {
  APPLICATION_PACKAGE_DIRS,
  APPLICATION_SOURCE_ROOTS,
  SCRIPT_FIXTURE_DIR,
  SCRIPT_SOURCE_DIR,
} from "./types.js";
import { createWorkspaceModel, type WorkspaceResolver } from "./workspace-resolver.js";

const RELATIVE_EXPORT_PREFIX = "./";

export type CodeIntelContext = {
  graph?: ImportGraph;
  graphProject?: Project;
  project?: Project;
  referenceProject?: Project;
  repoRoot?: string;
  resolver?: WorkspaceResolver;
  sourceFiles?: SourceFile[];
};

export function sourceFilesForGraph(repoRoot: string, context: CodeIntelContext): SourceFile[] {
  if (context.sourceFiles) return context.sourceFiles;
  if (context.graphProject) {
    return supportedSourceFiles(repoRoot, context.graphProject.getSourceFiles());
  }

  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const sourcePaths = discoverSupportedSourcePaths(repoRoot);
  project.addSourceFilesAtPaths(sourcePaths);
  return supportedSourceFiles(repoRoot, project.getSourceFiles());
}

export function createReferenceProject(repoRoot: string): Project {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: false,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ModuleKind.Node16,
      moduleResolution: ModuleResolutionKind.Node16,
      paths: referenceProjectCompilerPaths(repoRoot),
      resolveJsonModule: true,
      target: ScriptTarget.ES2024,
    },
  });
  project.addSourceFilesAtPaths(discoverSupportedSourcePaths(repoRoot));
  return project;
}

export function createProjectForFile(repoRoot: string, file: string): Project {
  const relative = toSlash(path.relative(repoRoot, path.resolve(repoRoot, file)));
  // Repo-relative in the error, matching existingRelativeFile, so the same
  // out-of-scope path reports identically across every command.
  if (!isSupportedRelativePath(relative)) throw unsupportedScopeError(relative);
  const packageDir = APPLICATION_PACKAGE_DIRS.find((candidate) =>
    relative.startsWith(`${candidate}/`),
  );
  if (packageDir) {
    return new Project({ tsConfigFilePath: path.join(repoRoot, packageDir, "tsconfig.json") });
  }
  return new Project({ tsConfigFilePath: path.join(repoRoot, "tsconfig.scripts.json") });
}

// Shared supported-scope failure so every single-file query path (positional
// def/exports/overview via one-shot createProjectForFile, daemon def/exports
// via projectBucketForFile — overview is not daemon-routable and always runs
// one-shot — and dependents/tests/refs via existingRelativeFile) fails loudly
// on out-of-scope targets instead of returning empty or incomplete output
// (docs/guides/code-intel.md#supported-scope).
export function unsupportedScopeError(file: string): CodeIntelError {
  return new CodeIntelError(
    `File must be under ${APPLICATION_SOURCE_ROOTS.join(", ")}, or ${SCRIPT_SOURCE_DIR} (excluding ${SCRIPT_FIXTURE_DIR}): ${file}`,
  );
}

// Mirrors discoverSupportedSourcePaths exactly: accepting a file the graph
// never loads would turn the loud scope error back into a silent empty result.
export function isSupportedRelativePath(relative: string): boolean {
  if (relative.startsWith(`${SCRIPT_FIXTURE_DIR}/`)) return false;
  return (
    APPLICATION_SOURCE_ROOTS.some((sourceRoot) => relative.startsWith(`${sourceRoot}/`)) ||
    relative.startsWith(`${SCRIPT_SOURCE_DIR}/`)
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
  // relativeRaw, not relative: the resolver's dist -> src source mapping
  // would rewrite dist/ and node_modules build artifacts into src/ before the
  // guard, accepting inputs that def/exports/overview reject. Scope-check
  // first so out-of-scope paths get the same rejection on every command.
  const target = resolver.relativeRaw(file);
  // Extensionless inputs (directories, bare discovery roots) fail the
  // trailing-slash scope predicate, and the scope error would then tell the
  // caller their path "must be under" the very root they passed. They can
  // never be source files, so report the file-shape failure directly.
  // Extension-shaped paths still hit the scope guard first so dist/ and
  // node_modules artifacts keep the supported-scope error.
  if (path.extname(target) === "") {
    throw new CodeIntelError(`File must be a TypeScript source file: ${target}`);
  }
  if (!isSupportedRelativePath(target)) throw unsupportedScopeError(target);
  if (!isSourceFilePath(target)) {
    throw new CodeIntelError(`File must be a TypeScript source file: ${target}`);
  }
  if (!resolver.fileExistsRelative(target)) throw new CodeIntelError(`File not found: ${target}`);
  if (!resolver.fileIsFileRelative(target))
    throw new CodeIntelError(`File is not a file: ${target}`);
  return target;
}

export function discoverSupportedSourcePaths(repoRoot: string): string[] {
  const paths: string[] = [];
  for (const packageDir of APPLICATION_PACKAGE_DIRS) {
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

// Filters through the same anchored predicate as the scope guard so the two
// "supported set" definitions cannot drift: an unanchored substring match
// would admit out-of-root files (e.g. examples/*/scripts/*) if a caller ever
// seeded the project from a wider set than discoverSupportedSourcePaths.
function supportedSourceFiles(repoRoot: string, sourceFiles: SourceFile[]): SourceFile[] {
  return sourceFiles.filter((sourceFile) =>
    isSupportedRelativePath(toSlash(path.relative(repoRoot, sourceFile.getFilePath()))),
  );
}

function referenceProjectCompilerPaths(repoRoot: string): Record<string, string[]> {
  const model = createWorkspaceModel(repoRoot);
  const compilerPaths: Record<string, string[]> = {};
  for (const alias of model.aliases) {
    addCompilerPath(
      compilerPaths,
      `${alias.sourcePrefix}*`,
      path.join(repoRoot, alias.targetPrefix, "*"),
    );
  }
  for (const rule of model.exportRules) {
    for (const sourcePattern of rule.sourcePatterns) {
      addCompilerPath(
        compilerPaths,
        packageSpecifierPattern(rule.packageName, rule.exportPattern),
        path.join(repoRoot, rule.packageRoot, sourcePattern),
      );
    }
  }
  return compilerPaths;
}

function addCompilerPath(
  compilerPaths: Record<string, string[]>,
  key: string,
  value: string,
): void {
  const existing = compilerPaths[key] ?? [];
  if (!existing.includes(value)) compilerPaths[key] = [...existing, value];
}

function packageSpecifierPattern(packageName: string, exportPattern: string): string {
  if (exportPattern === ".") return packageName;
  if (exportPattern.startsWith(RELATIVE_EXPORT_PREFIX)) {
    return `${packageName}/${exportPattern.slice(RELATIVE_EXPORT_PREFIX.length)}`;
  }
  return `${packageName}/${exportPattern}`;
}

function isSourceFilePath(file: string): boolean {
  return /\.tsx?$/u.test(file) && !file.endsWith(".d.ts");
}
