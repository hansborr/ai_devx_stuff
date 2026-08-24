import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { isRecord } from "../lib/records.js";
import { arrayProperty, readJsonObject, recordProperty, stringProperty } from "./json-utils.js";
import { isInside, toSlash } from "./path-utils.js";
import type {
  AliasRule,
  ExportRule,
  ResolverOptions,
  WorkspaceModel,
  WorkspacePackageConfig,
} from "./types.js";
import { APPLICATION_PACKAGE_DIRS, CLIENT_ALIAS_FALLBACK, JS_EXTENSIONS } from "./types.js";

const DOT_SLASH_PREFIX = "./";
const EXPORT_PATTERN_PART_COUNT = 2;

export class WorkspaceResolver {
  private readonly aliases: AliasRule[];
  private readonly fileExists: (filePath: string) => boolean;
  private readonly fileIsFile: (filePath: string) => boolean;
  private readonly packageRoots: Map<string, string>;
  private readonly repoRoot: string;
  private readonly rules: ExportRule[];

  constructor(repoRoot: string, rules: ExportRule[], options: ResolverOptions = {}) {
    this.repoRoot = path.resolve(repoRoot);
    this.rules = rules;
    this.fileExists = options.fileExists ?? existsSync;
    this.fileIsFile = options.fileIsFile ?? options.fileExists ?? isFilesystemFile;
    this.aliases = options.aliases ?? [CLIENT_ALIAS_FALLBACK];
    this.packageRoots = new Map(
      rules.map((rule) => [rule.packageName, path.join(this.repoRoot, rule.packageRoot)]),
    );
  }

  fileExistsRelative(file: string): boolean {
    return this.fileExists(path.join(this.repoRoot, file));
  }

  fileIsFileRelative(file: string): boolean {
    return this.fileIsFile(path.join(this.repoRoot, file));
  }

  mapFileToSource(filePath: string): string {
    const absolutePath = this.absolute(filePath);
    const packageSourcePath = this.mapPackagePathToSource(absolutePath);
    if (packageSourcePath) return packageSourcePath;
    return absolutePath;
  }

  relative(filePath: string): string {
    const sourcePath = this.mapFileToSource(filePath);
    return toSlash(path.relative(this.repoRoot, sourcePath));
  }

  // Repo-relative form of filePath without the dist -> src source mapping
  // that relative() applies. Scope guards must judge the path the caller
  // actually named: mapping a build artifact into src/ first would silently
  // accept out-of-scope input (docs/guides/code-intel.md#supported-scope).
  relativeRaw(filePath: string): string {
    return toSlash(path.relative(this.repoRoot, this.absolute(filePath)));
  }

  resolveModule(specifier: string, importerFile?: string): string | undefined {
    const packagePath = this.resolvePackageSpecifier(specifier);
    if (packagePath) return this.relative(packagePath);

    const aliasPath = this.resolveAliasSpecifier(specifier);
    if (aliasPath) return this.relative(aliasPath);

    if (specifier.startsWith(".") && importerFile) {
      const importerPath = this.absolute(importerFile);
      const resolved = this.probeSourcePath(path.resolve(path.dirname(importerPath), specifier));
      if (resolved) return this.relative(resolved);
    }

    return undefined;
  }

  private absolute(filePath: string): string {
    if (path.isAbsolute(filePath)) return path.resolve(filePath);
    return path.resolve(this.repoRoot, filePath);
  }

  private mapPackagePathToSource(filePath: string): string | undefined {
    for (const packageRoot of this.packageRoots.values()) {
      const distRoot = path.join(packageRoot, "dist");
      const relativeToDist = path.relative(distRoot, filePath);
      if (isInside(relativeToDist)) {
        const sourceBase = path.join(packageRoot, "src", sourceEquivalentPath(relativeToDist));
        return this.probeSourcePath(sourceBase) ?? sourceBase;
      }
    }
    return this.mapNodeModulesPackagePathToSource(filePath);
  }

  private mapNodeModulesPackagePathToSource(filePath: string): string | undefined {
    for (const [packageName, packageRoot] of this.packageRoots) {
      const nodeModuleRoot = path.join(this.repoRoot, "node_modules", ...packageName.split("/"));
      const relativeToPackage = path.relative(nodeModuleRoot, filePath);
      if (!isInside(relativeToPackage) || !relativeToPackage.startsWith(`dist${path.sep}`)) {
        continue;
      }
      const relativeToDist = relativeToPackage.slice(`dist${path.sep}`.length);
      const sourceBase = path.join(packageRoot, "src", sourceEquivalentPath(relativeToDist));
      return this.probeSourcePath(sourceBase) ?? sourceBase;
    }
    return undefined;
  }

  private probeSourcePath(basePath: string): string | undefined {
    for (const candidate of sourceCandidates(basePath)) {
      if (this.fileExists(candidate)) return path.resolve(candidate);
    }
    return undefined;
  }

  private resolveAliasSpecifier(specifier: string): string | undefined {
    for (const alias of this.aliases) {
      if (!specifier.startsWith(alias.sourcePrefix)) continue;
      const suffix = specifier.slice(alias.sourcePrefix.length);
      const target = path.join(this.repoRoot, alias.targetPrefix, suffix);
      const resolved = this.probeSourcePath(target);
      if (resolved) return resolved;
    }
    return undefined;
  }

  private resolvePackageSpecifier(specifier: string): string | undefined {
    for (const rule of this.rules) {
      const subpath = packageSubpath(specifier, rule.packageName);
      if (!subpath) continue;
      const capture = matchExportPattern(rule.exportPattern, subpath);
      if (capture === undefined) continue;
      for (const sourcePattern of rule.sourcePatterns) {
        const sourceRelative = sourcePattern.replaceAll("*", capture);
        const target = path.join(this.repoRoot, rule.packageRoot, sourceRelative);
        const resolved = this.probeSourcePath(target);
        if (resolved) return resolved;
      }
    }
    return undefined;
  }
}

export function createWorkspaceResolver(
  repoRoot = process.cwd(),
  options: ResolverOptions = {},
): WorkspaceResolver {
  const model = createWorkspaceModel(repoRoot, options);
  return new WorkspaceResolver(repoRoot, model.exportRules, { ...options, aliases: model.aliases });
}

export function createWorkspaceModel(
  repoRoot = process.cwd(),
  options: ResolverOptions = {},
): WorkspaceModel {
  const packages = options.packages ?? readWorkspacePackages(repoRoot);
  const aliases = options.aliases ?? readClientAliasRules(repoRoot);
  return {
    aliases,
    exportRules: packages.flatMap(createExportRules),
    packages,
  };
}

function readWorkspacePackages(repoRoot: string): WorkspacePackageConfig[] {
  const packages: WorkspacePackageConfig[] = [];
  for (const packageRoot of APPLICATION_PACKAGE_DIRS) {
    const packageJson = readJsonObject(path.join(repoRoot, packageRoot, "package.json"));
    const name = stringProperty(packageJson, "name");
    if (!name) continue;
    packages.push({ name, packageRoot, exports: packageJson.exports });
  }
  return packages;
}

function readClientAliasRules(repoRoot: string): AliasRule[] {
  const config = readJsonObject(path.join(repoRoot, "packages/client/tsconfig.json"));
  const compilerOptions = recordProperty(config, "compilerOptions");
  const paths = compilerOptions ? recordProperty(compilerOptions, "paths") : undefined;
  const aliasTargets = paths ? arrayProperty(paths, "@/*") : undefined;
  const firstTarget = aliasTargets?.find((value) => typeof value === "string");
  if (typeof firstTarget !== "string") return [CLIENT_ALIAS_FALLBACK];
  const targetPrefix = firstTarget.endsWith("*") ? firstTarget.slice(0, -1) : firstTarget;
  return [
    {
      sourcePrefix: "@/",
      targetPrefix: toSlash(path.join("packages/client", targetPrefix)),
    },
  ];
}

function createExportRules(config: WorkspacePackageConfig): ExportRule[] {
  if (!isRecord(config.exports)) return [];
  const rules: ExportRule[] = [];

  for (const [exportPattern, exportTarget] of Object.entries(config.exports)) {
    const sourcePatterns = uniqueStrings(
      collectStringLeaves(exportTarget)
        .map(sourcePatternFromDistTarget)
        .filter((value) => value !== undefined),
    );
    if (sourcePatterns.length === 0) continue;
    rules.push({
      exportPattern,
      packageName: config.name,
      packageRoot: config.packageRoot,
      sourcePatterns,
    });
  }

  return rules;
}

function collectStringLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStringLeaves);
  if (!isRecord(value)) return [];
  return Object.values(value).flatMap(collectStringLeaves);
}

function sourcePatternFromDistTarget(target: string): string | undefined {
  const normalized = target.startsWith(DOT_SLASH_PREFIX)
    ? target.slice(DOT_SLASH_PREFIX.length)
    : target;
  if (!normalized.startsWith("dist/")) return undefined;
  return sourceEquivalentPath(normalized.replace(/^dist\//u, "src/"));
}

function sourceEquivalentPath(filePath: string): string {
  if (filePath.endsWith(".d.ts")) return `${filePath.slice(0, -".d.ts".length)}.ts`;
  if (filePath.endsWith(".jsx")) return `${filePath.slice(0, -".jsx".length)}.tsx`;
  for (const extension of JS_EXTENSIONS) {
    if (filePath.endsWith(extension)) return `${filePath.slice(0, -extension.length)}.ts`;
  }
  return filePath;
}

function sourceCandidates(basePath: string): string[] {
  const candidates: string[] = [];
  const add = (candidate: string): void => {
    const normalized = path.resolve(candidate);
    if (!candidates.includes(normalized)) candidates.push(normalized);
  };

  if (basePath.endsWith(".d.ts")) {
    const withoutDts = basePath.slice(0, -".d.ts".length);
    add(`${withoutDts}.ts`);
    add(`${withoutDts}.tsx`);
    return candidates;
  }

  for (const extension of JS_EXTENSIONS) {
    if (basePath.endsWith(extension)) {
      const withoutExtension = basePath.slice(0, -extension.length);
      add(`${withoutExtension}.ts`);
      add(`${withoutExtension}.tsx`);
      return candidates;
    }
  }

  if (basePath.endsWith(".ts")) {
    add(basePath);
    add(`${basePath.slice(0, -".ts".length)}.tsx`);
    return candidates;
  }

  if (basePath.endsWith(".tsx")) {
    add(basePath);
    return candidates;
  }

  add(`${basePath}.ts`);
  add(`${basePath}.tsx`);
  add(path.join(basePath, "index.ts"));
  add(path.join(basePath, "index.tsx"));
  return candidates;
}

function packageSubpath(specifier: string, packageName: string): string | undefined {
  if (specifier === packageName) return ".";
  const prefix = `${packageName}/`;
  if (!specifier.startsWith(prefix)) return undefined;
  return `./${specifier.slice(prefix.length)}`;
}

function matchExportPattern(pattern: string, subpath: string): string | undefined {
  if (!pattern.includes("*")) return pattern === subpath ? "" : undefined;
  const parts = pattern.split("*");
  const prefix = parts[0];
  const suffix = parts[1];
  if (prefix === undefined || suffix === undefined || parts.length !== EXPORT_PATTERN_PART_COUNT) {
    return undefined;
  }
  if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) return undefined;
  return subpath.slice(prefix.length, subpath.length - suffix.length);
}

function isFilesystemFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
