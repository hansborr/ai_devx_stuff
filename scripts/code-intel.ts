#!/usr/bin/env bun
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Node, Project, SyntaxKind } from "ts-morph";
import type {
  DefinitionInfo,
  ExportDeclaration,
  Identifier,
  ImportDeclaration,
  SourceFile,
} from "ts-morph";

const WORKSPACE_PACKAGE_DIRS = ["packages/shared", "packages/server", "packages/client"];
const CLIENT_ALIAS_FALLBACK: AliasRule = {
  sourcePrefix: "@/",
  targetPrefix: "packages/client/src/",
};
const JS_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs"];

type Via = "direct" | "re-export" | "dynamic";
type TestReason = "co-located" | "direct" | "transitive";
type TestProject = "client" | "server" | "shared";
type ExportSpace = "type" | "value";

export type IntelResult =
  | {
      kind: "definition";
      name: string;
      file: string;
      line: number;
      col: number;
      exportKind: string;
    }
  | { kind: "export"; name: string; exportKind: string }
  | { kind: "dependent"; file: string; depth: number; via: Via }
  | {
      kind: "test";
      file: string;
      reason: TestReason;
      slow: boolean;
      depth?: number;
      via?: Via;
    };

type WorkspacePackageConfig = {
  exports: unknown;
  name: string;
  packageRoot: string;
};

type ExportRule = {
  exportPattern: string;
  packageName: string;
  packageRoot: string;
  sourcePatterns: string[];
};

type AliasRule = {
  sourcePrefix: string;
  targetPrefix: string;
};

type ResolverOptions = {
  aliases?: AliasRule[];
  fileExists?: (filePath: string) => boolean;
  packages?: WorkspacePackageConfig[];
};

type CodeIntelContext = {
  graphProject?: Project;
  project?: Project;
  repoRoot?: string;
  resolver?: WorkspaceResolver;
  sourceFiles?: SourceFile[];
};

type QueryTestsOptions = {
  depth?: number;
  project?: TestProject;
};

type CliCommand =
  | { kind: "help" }
  | { kind: "def"; location: SourceLocation }
  | { kind: "exports"; file: string }
  | { kind: "dependents"; file: string; depth: number }
  | { kind: "tests"; file: string; depth: number; project?: TestProject };

type SourceLocation = {
  col: number;
  file: string;
  line: number;
};

type ImportEdge = {
  from: string;
  runtime: boolean;
  to: string;
  via: Via;
};

type ImportGraph = {
  incoming: Map<string, ImportEdge[]>;
};

type BfsVisit = {
  depth: number;
  file: string;
  via: Via;
};

type JsonRecord = Record<string, unknown>;

export class CodeIntelError extends Error {
  constructor(message: string) {
    super(`code:intel: ${message}`);
    this.name = "CodeIntelError";
  }
}

export class WorkspaceResolver {
  private readonly aliases: AliasRule[];
  private readonly fileExists: (filePath: string) => boolean;
  private readonly packageRoots: Map<string, string>;
  private readonly repoRoot: string;
  private readonly rules: ExportRule[];

  constructor(repoRoot: string, rules: ExportRule[], options: ResolverOptions = {}) {
    this.repoRoot = path.resolve(repoRoot);
    this.rules = rules;
    this.fileExists = options.fileExists ?? existsSync;
    this.aliases = options.aliases ?? [CLIENT_ALIAS_FALLBACK];
    this.packageRoots = new Map(
      rules.map((rule) => [rule.packageName, path.join(this.repoRoot, rule.packageRoot)]),
    );
  }

  fileExistsRelative(file: string): boolean {
    return this.fileExists(path.join(this.repoRoot, file));
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
  const packages = options.packages ?? readWorkspacePackages(repoRoot);
  const rules = packages.flatMap(createExportRules);
  const aliases = options.aliases ?? readClientAliasRules(repoRoot);
  return new WorkspaceResolver(repoRoot, rules, { ...options, aliases });
}

export function runCodeIntel(args: string[], context: CodeIntelContext = {}): string {
  const command = parseArgs(args);
  if (command.kind === "help") return usage();

  const repoRoot = path.resolve(context.repoRoot ?? process.cwd());
  const resolver = context.resolver ?? createWorkspaceResolver(repoRoot);

  if (command.kind === "def") {
    const project = context.project ?? createProjectForFile(repoRoot, command.location.file);
    const results = queryDefinition(project, resolver, command.location);
    const headerName = results[0]?.kind === "definition" ? results[0].name : "unknown";
    return formatResults(`definition ${headerName}`, results);
  }

  if (command.kind === "exports") {
    const project = context.project ?? createProjectForFile(repoRoot, command.file);
    return formatResults(
      `exports ${resolver.relative(command.file)}`,
      queryExports(project, resolver, command.file),
    );
  }

  const sourceFiles = sourceFilesForGraph(repoRoot, context);
  const graph = buildImportGraph(sourceFiles, resolver);
  if (command.kind === "dependents") {
    return formatResults(
      `dependents ${resolver.relative(command.file)}`,
      queryDependents(resolver, graph, command.file, command.depth),
    );
  }

  return formatResults(
    `tests ${resolver.relative(command.file)}`,
    queryTests(resolver, graph, command.file, {
      depth: command.depth,
      project: command.project,
    }),
  );
}

export function queryDefinition(
  project: Project,
  resolver: WorkspaceResolver,
  location: SourceLocation,
): IntelResult[] {
  const sourceFile = getProjectSourceFile(project, resolver.mapFileToSource(location.file));
  const position = positionFromLineColumn(sourceFile, location);
  const node = sourceFile.getDescendantAtPos(position);
  if (!node) throw new CodeIntelError(`No node found at ${formatLocation(location)}.`);
  const identifier = identifierAtPosition(node, position);
  if (!identifier) throw new CodeIntelError(`No identifier found at ${formatLocation(location)}.`);

  return identifier
    .getDefinitions()
    .map((definition) => definitionResult(project, resolver, definition, identifier.getText()));
}

export function queryExports(
  project: Project,
  resolver: WorkspaceResolver,
  file: string,
): IntelResult[] {
  const sourceFile = getProjectSourceFile(project, resolver.mapFileToSource(file));
  const sourceRelative = resolver.relative(sourceFile.getFilePath());
  const exported = sourceFile.getExportedDeclarations();
  const results: IntelResult[] = [];

  for (const [name, declarations] of exported) {
    const declaration = declarations[0];
    if (!declaration) continue;
    const declarationFile = resolver.relative(declaration.getSourceFile().getFilePath());
    const reexportText = declarationFile === sourceRelative ? "export" : "re-export";
    results.push({
      kind: "export",
      name,
      exportKind: `${declarationSpace(declaration)} ${reexportText}`,
    });
  }

  return results.sort(compareNamedResults);
}

export function queryDependents(
  resolver: WorkspaceResolver,
  graph: ImportGraph,
  file: string,
  depthLimit: number,
): IntelResult[] {
  const target = existingRelativeFile(resolver, file);
  return reverseBfs(graph, target, depthLimit).map((visit) => ({
    kind: "dependent",
    file: visit.file,
    depth: visit.depth,
    via: visit.via,
  }));
}

export function queryTests(
  resolver: WorkspaceResolver,
  graph: ImportGraph,
  file: string,
  options: QueryTestsOptions = {},
): IntelResult[] {
  const target = existingRelativeFile(resolver, file);
  const depthLimit = options.depth ?? Number.POSITIVE_INFINITY;
  const results = new Map<string, IntelResult>();

  for (const candidate of colocatedTestCandidates(target)) {
    if (!resolver.fileExistsRelative(candidate)) continue;
    results.set(candidate, {
      kind: "test",
      file: candidate,
      reason: "co-located",
      slow: isSlowTestFile(candidate),
    });
  }

  for (const visit of reverseBfs(graph, target, depthLimit, true)) {
    if (!isTestFile(visit.file) || results.has(visit.file)) continue;
    results.set(visit.file, {
      kind: "test",
      file: visit.file,
      reason: visit.depth === 1 ? "direct" : "transitive",
      slow: isSlowTestFile(visit.file),
      depth: visit.depth,
      via: visit.via,
    });
  }

  return filterTestsByProject([...results.values()], options.project).sort(compareFileResults);
}

export function buildImportGraph(
  sourceFiles: SourceFile[],
  resolver: WorkspaceResolver,
): ImportGraph {
  const incoming = new Map<string, ImportEdge[]>();

  for (const sourceFile of sourceFiles) {
    const from = resolver.relative(sourceFile.getFilePath());
    for (const edge of collectImportEdges(sourceFile, resolver, from)) {
      const edges = incoming.get(edge.to) ?? [];
      edges.push(edge);
      incoming.set(edge.to, edges);
    }
  }

  for (const edges of incoming.values()) {
    edges.sort(compareEdges);
  }

  return { incoming };
}

export function runCodeIntelCli(): void {
  try {
    const output = runCodeIntel(process.argv.slice(2));
    if (output.length > 0) console.log(output);
  } catch (error) {
    if (error instanceof CodeIntelError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

function parseArgs(args: string[]): CliCommand {
  const command = args[0];
  if (!command) throw new CodeIntelError(usage());

  if (command === "--help" || command === "-h") return { kind: "help" };
  if (command === "def") return parseDefArgs(args.slice(1));
  if (command === "exports") return parseSingleFileArgs(args.slice(1));
  if (command === "dependents") return parseDependentsArgs(args.slice(1));
  if (command === "tests") return parseTestsArgs(args.slice(1));

  throw new CodeIntelError(`Unknown command: ${command}\n${usage()}`);
}

function parseDefArgs(args: string[]): CliCommand {
  if (args.length !== 1)
    throw new CodeIntelError("Usage: bun run code:intel -- def <file>:<line>:<col>");
  const rawLocation = args[0];
  if (!rawLocation) throw new CodeIntelError("Definition location is required.");
  return { kind: "def", location: parseLocation(rawLocation) };
}

function parseSingleFileArgs(args: string[]): CliCommand {
  if (args.length !== 1) throw new CodeIntelError("Usage: bun run code:intel -- exports <file>");
  const file = args[0];
  if (!file) throw new CodeIntelError("exports file argument is required.");
  return { kind: "exports", file };
}

function parseDependentsArgs(args: string[]): CliCommand {
  const positional: string[] = [];
  let depth = 1;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) throw new CodeIntelError("Empty arguments are not supported.");
    if (arg === "--depth") {
      const value = args[index + 1];
      if (!value) throw new CodeIntelError("--depth requires a positive integer.");
      depth = parseDepth(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--depth=")) {
      depth = parseDepth(arg.slice("--depth=".length));
      continue;
    }
    if (arg.startsWith("-")) throw new CodeIntelError(`Unknown argument: ${arg}`);
    positional.push(arg);
  }

  if (positional.length !== 1) {
    throw new CodeIntelError("Usage: bun run code:intel -- dependents <file> [--depth <N>]");
  }
  const file = positional[0];
  if (!file) throw new CodeIntelError("Dependents file argument is required.");
  return { kind: "dependents", file, depth };
}

function parseTestsArgs(args: string[]): CliCommand {
  const positional: string[] = [];
  let depth = Number.POSITIVE_INFINITY;
  let depthSpecified = false;
  let direct = false;
  let project: TestProject | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) throw new CodeIntelError("Empty arguments are not supported.");
    if (arg === "--direct") {
      direct = true;
      continue;
    }
    if (arg === "--depth") {
      const value = args[index + 1];
      if (!value) throw new CodeIntelError("--depth requires a positive integer.");
      depth = parseDepth(value);
      depthSpecified = true;
      index += 1;
      continue;
    }
    if (arg.startsWith("--depth=")) {
      depth = parseDepth(arg.slice("--depth=".length));
      depthSpecified = true;
      continue;
    }
    if (arg === "--project") {
      const value = args[index + 1];
      if (!value) throw new CodeIntelError("--project requires shared, server, or client.");
      project = parseTestProject(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--project=")) {
      project = parseTestProject(arg.slice("--project=".length));
      continue;
    }
    if (arg.startsWith("-")) throw new CodeIntelError(`Unknown argument: ${arg}`);
    positional.push(arg);
  }

  if (direct && depthSpecified) {
    throw new CodeIntelError("Use either --direct or --depth, not both.");
  }
  if (positional.length !== 1) {
    throw new CodeIntelError(
      "Usage: bun run code:intel -- tests <file> [--depth <N>] [--direct] [--project <shared|server|client>]",
    );
  }
  const file = positional[0];
  if (!file) throw new CodeIntelError("tests file argument is required.");
  return { kind: "tests", file, depth: direct ? 1 : depth, project };
}

function parseDepth(value: string): number {
  if (!/^[1-9]\d*$/u.test(value)) throw new CodeIntelError("--depth requires a positive integer.");
  return Number(value);
}

function parseTestProject(value: string): TestProject {
  if (value === "shared" || value === "server" || value === "client") return value;
  throw new CodeIntelError("--project requires shared, server, or client.");
}

function parseLocation(rawLocation: string): SourceLocation {
  const lastColon = rawLocation.lastIndexOf(":");
  if (lastColon < 0) throw new CodeIntelError("Definition location must include :line:col.");
  const secondLastColon = rawLocation.lastIndexOf(":", lastColon - 1);
  if (secondLastColon < 0) throw new CodeIntelError("Definition location must include :line:col.");
  const file = rawLocation.slice(0, secondLastColon);
  const line = Number(rawLocation.slice(secondLastColon + 1, lastColon));
  const col = Number(rawLocation.slice(lastColon + 1));
  if (!file || !Number.isInteger(line) || !Number.isInteger(col) || line < 1 || col < 1) {
    throw new CodeIntelError("Definition location must be <file>:<positive-line>:<positive-col>.");
  }
  return { file, line, col };
}

function usage(): string {
  return [
    "Usage:",
    "  bun run code:intel -- def <file>:<line>:<col>",
    "  bun run code:intel -- exports <file>",
    "  bun run code:intel -- dependents <file> [--depth <N>]",
    "  bun run code:intel -- tests <file> [--depth <N>] [--direct] [--project <shared|server|client>]",
    "",
    "Examples:",
    "  bun run code:intel -- tests packages/server/src/services/level-up.ts --direct",
    "  bun run code:intel -- tests packages/shared/src/schemas/character.ts --depth 2 --project server",
    "",
    "Note: tests finds candidate covering tests from runtime imports; it is not an exact coverage oracle.",
  ].join("\n");
}

function readWorkspacePackages(repoRoot: string): WorkspacePackageConfig[] {
  const packages: WorkspacePackageConfig[] = [];
  for (const packageRoot of WORKSPACE_PACKAGE_DIRS) {
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

function readJsonObject(filePath: string): JsonRecord {
  if (!existsSync(filePath)) return {};
  const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  if (!isRecord(parsed)) return {};
  return parsed;
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
  const normalized = target.startsWith("./") ? target.slice(2) : target;
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
  if (prefix === undefined || suffix === undefined || parts.length !== 2) return undefined;
  if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) return undefined;
  return subpath.slice(prefix.length, subpath.length - suffix.length);
}

function sourceFilesForGraph(repoRoot: string, context: CodeIntelContext): SourceFile[] {
  if (context.sourceFiles) return context.sourceFiles;
  if (context.graphProject) return workspaceSourceFiles(context.graphProject.getSourceFiles());

  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const sourcePaths = discoverWorkspaceSourcePaths(repoRoot);
  project.addSourceFilesAtPaths(sourcePaths);
  return workspaceSourceFiles(project.getSourceFiles());
}

function discoverWorkspaceSourcePaths(repoRoot: string): string[] {
  const paths: string[] = [];
  for (const packageDir of WORKSPACE_PACKAGE_DIRS) {
    const sourceRoot = path.join(repoRoot, packageDir, "src");
    if (!existsSync(sourceRoot)) continue;
    collectSourcePaths(sourceRoot, paths);
  }
  return paths.sort((left, right) => left.localeCompare(right, "en"));
}

function collectSourcePaths(directory: string, paths: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const currentPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSourcePaths(currentPath, paths);
      continue;
    }
    if (!entry.isFile() && !statSync(currentPath).isFile()) continue;
    if (!/\.tsx?$/u.test(currentPath) || currentPath.endsWith(".d.ts")) continue;
    paths.push(currentPath);
  }
}

function workspaceSourceFiles(sourceFiles: SourceFile[]): SourceFile[] {
  return sourceFiles.filter((sourceFile) => {
    const filePath = toSlash(sourceFile.getFilePath());
    return WORKSPACE_PACKAGE_DIRS.some((packageDir) => filePath.includes(`${packageDir}/src/`));
  });
}

function createProjectForFile(repoRoot: string, file: string): Project {
  const relative = toSlash(path.relative(repoRoot, path.resolve(repoRoot, file)));
  const packageDir = WORKSPACE_PACKAGE_DIRS.find((candidate) =>
    relative.startsWith(`${candidate}/`),
  );
  if (!packageDir) {
    throw new CodeIntelError(`File must be under ${WORKSPACE_PACKAGE_DIRS.join(", ")}: ${file}`);
  }
  return new Project({ tsConfigFilePath: path.join(repoRoot, packageDir, "tsconfig.json") });
}

function getProjectSourceFile(project: Project, file: string): SourceFile {
  const targetPath = path.resolve(file);
  const existing = project
    .getSourceFiles()
    .find((sourceFile) => samePath(sourceFile.getFilePath(), targetPath));
  if (existing) return existing;
  const added = project.addSourceFileAtPathIfExists(targetPath);
  if (added) return added;
  throw new CodeIntelError(`File is not in the TypeScript project: ${file}`);
}

function existingRelativeFile(resolver: WorkspaceResolver, file: string): string {
  const target = resolver.relative(file);
  if (!resolver.fileExistsRelative(target)) throw new CodeIntelError(`File not found: ${target}`);
  return target;
}

function identifierAtPosition(node: Node, position: number): Identifier | undefined {
  let current: Node | undefined = node;
  while (current) {
    if (Node.isIdentifier(current)) return current;
    current = current.getParent();
  }
  return node
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .find((identifier) => identifier.getStart() <= position && position <= identifier.getEnd());
}

function definitionResult(
  project: Project,
  resolver: WorkspaceResolver,
  definition: DefinitionInfo,
  fallbackName: string,
): IntelResult {
  const name = definition.getName() || fallbackName;
  const sourceFile = definition.getSourceFile();
  const mappedPath = resolver.mapFileToSource(sourceFile.getFilePath());
  const declaration = findDeclaration(project, mappedPath, name);
  const position = declaration
    ? declarationPosition(declaration, name)
    : definition.getTextSpan().getStart();
  const positionSourceFile = declaration?.getSourceFile() ?? sourceFile;
  const lineColumn = positionSourceFile.getLineAndColumnAtPos(position);

  return {
    kind: "definition",
    name,
    file: resolver.relative(mappedPath),
    line: lineColumn.line,
    col: lineColumn.column,
    exportKind: declaration
      ? `${declarationSpace(declaration)} ${exportLabel(declaration, name)}`
      : definition.getKind(),
  };
}

function findDeclaration(project: Project, file: string, name: string): Node | undefined {
  const sourceFile = getOptionalProjectSourceFile(project, file);
  if (!sourceFile) return undefined;
  const exportedDeclaration = sourceFile.getExportedDeclarations().get(name)?.[0];
  if (exportedDeclaration) return exportedDeclaration;
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .find((identifier) => identifier.getText() === name);
}

function getOptionalProjectSourceFile(project: Project, file: string): SourceFile | undefined {
  const targetPath = path.resolve(file);
  const existing = project
    .getSourceFiles()
    .find((sourceFile) => samePath(sourceFile.getFilePath(), targetPath));
  if (existing) return existing;
  return project.addSourceFileAtPathIfExists(targetPath);
}

function declarationPosition(declaration: Node, name: string): number {
  if (Node.isVariableDeclaration(declaration)) return declaration.getNameNode().getStart();
  if (Node.isFunctionDeclaration(declaration) && declaration.getNameNode()) {
    const nameNode = declaration.getNameNode();
    if (nameNode) return nameNode.getStart();
  }
  if (Node.isClassDeclaration(declaration) && declaration.getNameNode()) {
    const nameNode = declaration.getNameNode();
    if (nameNode) return nameNode.getStart();
  }
  if (Node.isInterfaceDeclaration(declaration)) return declaration.getNameNode().getStart();
  if (Node.isTypeAliasDeclaration(declaration)) return declaration.getNameNode().getStart();
  if (Node.isEnumDeclaration(declaration)) return declaration.getNameNode().getStart();
  const identifier = declaration
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .find((candidate) => candidate.getText() === name);
  return identifier?.getStart() ?? declaration.getStart();
}

function declarationSpace(declaration: Node): ExportSpace {
  if (
    Node.isInterfaceDeclaration(declaration) ||
    Node.isTypeAliasDeclaration(declaration) ||
    Node.isTypeParameterDeclaration(declaration)
  ) {
    return "type";
  }
  return "value";
}

function exportLabel(declaration: Node, name: string): string {
  const sourceFile = declaration.getSourceFile();
  if (sourceFile.getExportedDeclarations().has(name)) return "export";
  return "local";
}

function collectImportEdges(
  sourceFile: SourceFile,
  resolver: WorkspaceResolver,
  from: string,
): ImportEdge[] {
  const edges: ImportEdge[] = [];
  const mockedSpecifiers = isTestFile(from)
    ? collectViMockSpecifiers(sourceFile)
    : new Set<string>();

  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    const specifier = importDeclaration.getModuleSpecifierValue();
    if (mockedSpecifiers.has(specifier)) continue;
    addResolvedEdge(
      edges,
      resolver,
      from,
      specifier,
      "direct",
      importDeclarationHasRuntimeEdge(importDeclaration),
    );
  }

  for (const exportDeclaration of sourceFile.getExportDeclarations()) {
    const specifier = exportDeclaration.getModuleSpecifierValue();
    if (!specifier) continue;
    addResolvedEdge(
      edges,
      resolver,
      from,
      specifier,
      "re-export",
      exportDeclarationHasRuntimeEdge(exportDeclaration),
    );
  }

  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    if (node.getExpression().getKind() !== SyntaxKind.ImportKeyword) return;
    const specifier = literalFirstArgument(node);
    if (!specifier) return;
    addResolvedEdge(edges, resolver, from, specifier, "dynamic", true);
  });

  return uniqueEdges(edges);
}

function importDeclarationHasRuntimeEdge(importDeclaration: ImportDeclaration): boolean {
  if (importDeclaration.isTypeOnly()) return false;
  if (importDeclaration.getDefaultImport() || importDeclaration.getNamespaceImport()) return true;
  const namedImports = importDeclaration.getNamedImports();
  if (namedImports.length === 0) return true;
  return namedImports.some((specifier) => !specifier.isTypeOnly());
}

function exportDeclarationHasRuntimeEdge(exportDeclaration: ExportDeclaration): boolean {
  if (exportDeclaration.isTypeOnly()) return false;
  if (exportDeclaration.getNamespaceExport()) return true;
  const namedExports = exportDeclaration.getNamedExports();
  if (namedExports.length === 0) return true;
  return namedExports.some((specifier) => !specifier.isTypeOnly());
}

function addResolvedEdge(
  edges: ImportEdge[],
  resolver: WorkspaceResolver,
  from: string,
  specifier: string,
  via: Via,
  runtime: boolean,
): void {
  const to = resolver.resolveModule(specifier, from);
  if (!to || to === from) return;
  edges.push({ from, runtime, to, via });
}

function collectViMockSpecifiers(sourceFile: SourceFile): Set<string> {
  const specifiers = new Set<string>();
  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const expression = node.getExpression();
    if (!Node.isPropertyAccessExpression(expression)) return;
    if (expression.getExpression().getText() !== "vi" || expression.getName() !== "mock") return;
    const specifier = literalFirstArgument(node);
    if (specifier) specifiers.add(specifier);
  });
  return specifiers;
}

function literalFirstArgument(callExpression: Node): string | undefined {
  if (!Node.isCallExpression(callExpression)) return undefined;
  const firstArgument = callExpression.getArguments()[0];
  if (!firstArgument) return undefined;
  if (Node.isStringLiteral(firstArgument) || Node.isNoSubstitutionTemplateLiteral(firstArgument)) {
    return firstArgument.getLiteralText();
  }
  return undefined;
}

function uniqueEdges(edges: ImportEdge[]): ImportEdge[] {
  const unique = new Map<string, ImportEdge>();
  for (const edge of edges) {
    const key = `${edge.from}\0${edge.to}\0${edge.via}`;
    const previous = unique.get(key);
    if (!previous) {
      unique.set(key, edge);
      continue;
    }
    if (edge.runtime && !previous.runtime) unique.set(key, edge);
  }
  return [...unique.values()];
}

function reverseBfs(
  graph: ImportGraph,
  target: string,
  depthLimit = Number.POSITIVE_INFINITY,
  runtimeOnly = false,
): BfsVisit[] {
  const start: BfsVisit = { file: target, depth: 0, via: "direct" };
  const queue: BfsVisit[] = [start];
  const seen = new Map<string, BfsVisit>([[target, start]]);
  const results: BfsVisit[] = [];

  for (let index = 0; index < queue.length; index += 1) {
    const visit = queue[index];
    if (!visit) continue;
    const incoming = graph.incoming.get(visit.file) ?? [];
    for (const edge of incoming) {
      if (runtimeOnly && !edge.runtime) continue;
      const depth = visit.depth + 1;
      if (depth > depthLimit) continue;
      const previous = seen.get(edge.from);
      if (previous && previous.depth <= depth) continue;
      const next = { file: edge.from, depth, via: edge.via };
      seen.set(edge.from, next);
      results.push(next);
      queue.push(next);
    }
  }

  return results.sort(compareVisits);
}

function colocatedTestCandidates(file: string): string[] {
  const extension = path.extname(file);
  const withoutExtension = file.slice(0, -extension.length);
  return [
    `${withoutExtension}.test.ts`,
    `${withoutExtension}.test.tsx`,
    `${withoutExtension}.slow.test.ts`,
    `${withoutExtension}.slow.test.tsx`,
  ];
}

function isTestFile(file: string): boolean {
  return /\.test\.tsx?$/u.test(file);
}

function isSlowTestFile(file: string): boolean {
  return /\.slow\.test\.tsx?$/u.test(file);
}

function filterTestsByProject(
  results: IntelResult[],
  project: TestProject | undefined,
): IntelResult[] {
  if (!project) return results;
  return results.filter(
    (result) => result.kind === "test" && testFileMatchesProject(result.file, project),
  );
}

function testFileMatchesProject(file: string, project: TestProject): boolean {
  if (project === "shared") return file.startsWith("packages/shared/");
  if (project === "server") return file.startsWith("packages/server/");
  return file.startsWith("packages/client/");
}

function formatResults(header: string, results: IntelResult[]): string {
  return [header, ...results.map(formatResultLine)].join("\n");
}

function formatResultLine(result: IntelResult): string {
  if (result.kind === "definition") return formatDefinitionLine(result);
  if (result.kind === "export") return formatExportLine(result);
  if (result.kind === "dependent") return formatDependentLine(result);
  return formatTestLine(result);
}

function formatDefinitionLine(result: IntelResult): string {
  if (result.kind !== "definition") throw new Error("Expected definition result.");
  return `  ${result.file}:${result.line}:${result.col} ${result.exportKind}`;
}

function formatExportLine(result: IntelResult): string {
  if (result.kind !== "export") throw new Error("Expected export result.");
  return `  ${result.name} ${result.exportKind}`;
}

function formatDependentLine(result: IntelResult): string {
  if (result.kind !== "dependent") throw new Error("Expected dependent result.");
  const reason =
    result.depth === 1 ? result.via : `transitive depth=${result.depth} via ${result.via}`;
  return `  ${result.file} ${reason}`;
}

function formatTestLine(result: IntelResult): string {
  if (result.kind !== "test") throw new Error("Expected test result.");
  const depth = result.reason === "transitive" && result.depth ? ` depth=${result.depth}` : "";
  const via = result.via && result.via !== "direct" ? ` via ${result.via}` : "";
  const slow = result.slow ? " slow" : "";
  return `  ${result.file} ${result.reason}${depth}${via}${slow}`;
}

function formatLocation(location: SourceLocation): string {
  return `${location.file}:${location.line}:${location.col}`;
}

function positionFromLineColumn(sourceFile: SourceFile, location: SourceLocation): number {
  const text = sourceFile.getFullText();
  let line = 1;
  let position = 0;

  while (line < location.line && position < text.length) {
    if (text.charAt(position) === "\n") line += 1;
    position += 1;
  }

  if (line !== location.line) {
    throw new CodeIntelError(`Line ${location.line} is outside ${location.file}.`);
  }

  return position + location.col - 1;
}

function compareNamedResults(left: IntelResult, right: IntelResult): number {
  const leftName = "name" in left ? left.name : "";
  const rightName = "name" in right ? right.name : "";
  return leftName.localeCompare(rightName, "en");
}

function compareFileResults(left: IntelResult, right: IntelResult): number {
  const leftFile = "file" in left ? left.file : "";
  const rightFile = "file" in right ? right.file : "";
  return leftFile.localeCompare(rightFile, "en");
}

function compareVisits(left: BfsVisit, right: BfsVisit): number {
  if (left.depth !== right.depth) return left.depth - right.depth;
  return left.file.localeCompare(right.file, "en");
}

function compareEdges(left: ImportEdge, right: ImportEdge): number {
  const fileComparison = left.from.localeCompare(right.from, "en");
  if (fileComparison !== 0) return fileComparison;
  return left.via.localeCompare(right.via, "en");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function recordProperty(record: JsonRecord, key: string): JsonRecord | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function arrayProperty(record: JsonRecord, key: string): unknown[] | undefined {
  const value = record[key];
  return Array.isArray(value) ? value : undefined;
}

function stringProperty(record: JsonRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function isInside(relativePath: string): boolean {
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function toSlash(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCodeIntelCli();
}
