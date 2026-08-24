import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

import ts from "typescript";

import {
  computeCoreLintRatchetRuleSourceHash,
  LINT_RATCHET_CONFIG_HASH_PREFIX,
  type LintRatchetRuleSourceHashesById,
  ruleNamespace,
} from "./baseline.js";
import type {
  LintRatchetConfig,
  LintRatchetThirdPartyPluginAllowlistEntry,
} from "./config-types.js";
import { type LintRatchetEngineBinding, localRulesRootFor } from "./engine-context.js";
import { ConfigError } from "./metrics-types.js";
import { assertNever, ratchetParserProfile, ratchetSource } from "./runtime-config.js";

// Static import declarations and re-exports all pull their module specifiers
// into the rule's behavior, so the TypeScript parser supplies the closure edges.
// Executable import()/require() cannot be resolved statically and is rejected
// from the same parsed tree rather than silently omitted from the identity hash.

// The versioned package root of a bare specifier: `@scope/name` for scoped
// packages, the first segment otherwise. Protocol specifiers (`node:`, `data:`)
// and empty captures return undefined — they have no package.json to version.
export function bareSpecifierPackageRoot(specifier: string): string | undefined {
  if (specifier.length === 0 || specifier.includes(":")) return undefined;
  const segments = specifier.split("/");
  if (specifier.startsWith("@")) {
    const [scope, name] = segments;
    return scope !== undefined && name !== undefined && name.length > 0
      ? `${scope}/${name}`
      : undefined;
  }
  return segments[0];
}

interface LocalRuleSourceFileSystem {
  readonly exists: (path: string) => boolean;
  readonly readFile: (path: string) => Buffer;
  readonly isDirectory: (path: string) => boolean;
}

interface ComputeLocalRuleSourceClosureHashOptions {
  readonly entryPath: string;
  readonly repoRootPath: string;
  readonly fileSystem: LocalRuleSourceFileSystem;
}

interface LocalRuleSourceFile {
  readonly path: string;
  readonly source: Buffer;
}

const nodeLocalRuleSourceFileSystem: LocalRuleSourceFileSystem = {
  exists: existsSync,
  readFile: readFileSync,
  isDirectory: (path) => existsSync(path) && statSync(path).isDirectory(),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function localRuleName(ruleId: string): string {
  const prefix = "local/";
  if (!ruleId.startsWith(prefix)) {
    throw new ConfigError(`local ratchet ruleId must start with local/: ${ruleId}`);
  }
  return ruleId.slice(prefix.length);
}

export function localRulePath(
  ratchet: LintRatchetConfig,
  binding: LintRatchetEngineBinding,
): string {
  return join(localRulesRootFor(binding), `${localRuleName(ratchet.ruleId)}.js`);
}

export function thirdPartySupportFor(
  ratchet: LintRatchetConfig,
  thirdPartyPluginAllowlist: readonly LintRatchetThirdPartyPluginAllowlistEntry[],
): LintRatchetThirdPartyPluginAllowlistEntry {
  const source = ratchetSource(ratchet);
  if (source.kind !== "third-party") {
    throw new ConfigError(`ratchet ${ratchet.id}: expected third-party source`);
  }
  const namespace = ruleNamespace(ratchet.ruleId);
  const support = thirdPartyPluginAllowlist.find(
    (entry) => entry.pluginModule === source.pluginModule && entry.ruleNamespace === namespace,
  );
  if (support === undefined) {
    throw new ConfigError(
      `ratchet ${ratchet.id}: third-party plugin ${source.pluginModule} for namespace ${namespace ?? "(unknown)"} is not allowlisted`,
    );
  }
  return support;
}

function packageJsonPath(packageName: string, repoRoot: string): string {
  return join(repoRoot, "node_modules", ...packageName.split("/"), "package.json");
}

function readPackageVersion(packageName: string, packageLabel: string, repoRoot: string): string {
  const packageJsonFile = packageJsonPath(packageName, repoRoot);
  const displayName = `${packageLabel} ${packageName}`;
  if (!existsSync(packageJsonFile)) {
    throw new ConfigError(`${displayName} was not found at ${packageJsonFile}`);
  }
  const parsed: unknown = JSON.parse(readFileSync(packageJsonFile, "utf8"));
  if (!isRecord(parsed) || typeof parsed.version !== "string") {
    throw new ConfigError(`${displayName} has no version`);
  }
  return parsed.version;
}

function readThirdPartyPluginVersion(pluginModule: string, repoRoot: string): string {
  return readPackageVersion(pluginModule, "third-party plugin package", repoRoot);
}

function readEslintPackageVersion(repoRoot: string): string {
  return readPackageVersion("eslint", "ESLint package", repoRoot);
}

// Every generated ratchet config parses with `tseslint.parser` (eslint-config.ts),
// so the typescript-eslint version is a findings input for every source kind —
// not only for ratchets whose plugin happens to be typescript-eslint.
function readTypescriptEslintPackageVersion(repoRoot: string): string {
  return readPackageVersion("typescript-eslint", "typescript-eslint package", repoRoot);
}

// Type-aware ratchets (parserProfile "type-aware-ts") resolve rule findings
// against the TypeScript compiler, so its version is a findings input for them.
function readTypescriptPackageVersion(repoRoot: string): string {
  return readPackageVersion("typescript", "TypeScript package", repoRoot);
}

function javaScriptKindForPath(path: string): ts.ScriptKind.JS | ts.ScriptKind.JSX | undefined {
  switch (extname(path)) {
    case "":
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    case ".jsx":
      return ts.ScriptKind.JSX;
    default:
      return undefined;
  }
}

function parseJavaScriptSource(
  path: string,
  source: string,
  scriptKind: ts.ScriptKind.JS | ts.ScriptKind.JSX,
): ts.SourceFile {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, scriptKind);
  const diagnosticFileName = extname(path) === "" ? `${path}.js` : path;
  const [diagnostic] =
    ts.transpileModule(source, { fileName: diagnosticFileName, reportDiagnostics: true })
      .diagnostics ?? [];
  if (diagnostic !== undefined) {
    let location = "";
    if (diagnostic.start !== undefined) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
      location = `:${String(line + 1)}:${String(character + 1)}`;
    }
    throw new ConfigError(
      `local rule source ${path}${location} contains malformed JavaScript: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`,
    );
  }
  return sourceFile;
}

function staticModuleSpecifiers(sourceFile: ts.SourceFile): readonly string[] {
  const specifiers: string[] = [];
  for (const statement of sourceFile.statements) {
    const moduleSpecifier =
      ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
        ? statement.moduleSpecifier
        : undefined;
    if (moduleSpecifier !== undefined && ts.isStringLiteralLike(moduleSpecifier)) {
      specifiers.push(moduleSpecifier.text);
    }
  }
  return specifiers;
}

function assertStaticModuleLoading(path: string, sourceFile: ts.SourceFile): void {
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      throw new ConfigError(
        `local rule source ${path} uses dynamic import()/require(); rule-source closures must be static ES modules so every dependency is captured in the identity hash`,
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

function resolveLocalRuleImport(
  importerPath: string,
  specifier: string,
  fileSystem: LocalRuleSourceFileSystem,
): string {
  const resolved = resolve(dirname(importerPath), specifier);
  if (extname(resolved) !== "") return resolved;
  if (!fileSystem.exists(resolved)) return `${resolved}.js`;
  // `./x` that resolves to an existing directory means `./x/index.js`; reading
  // the directory itself would surface a raw EISDIR. Probe the index entry and
  // name the specifier and importer when even that is missing.
  if (!fileSystem.isDirectory(resolved)) return resolved;
  const indexPath = join(resolved, "index.js");
  if (fileSystem.exists(indexPath)) return indexPath;
  throw new ConfigError(
    `local rule import "${specifier}" from ${importerPath} resolves to a directory with no index.js`,
  );
}

interface LocalRuleClosure {
  readonly sortedFiles: readonly LocalRuleSourceFile[];
  readonly bareSpecifierRoots: readonly string[];
}

function collectLocalRuleSourceClosure(
  path: string,
  fileSystem: LocalRuleSourceFileSystem,
  filesByPath: Map<string, LocalRuleSourceFile>,
  bareRoots: Set<string>,
): void {
  if (filesByPath.has(path)) return;
  if (!fileSystem.exists(path)) {
    throw new ConfigError(`local rule source not found at ${path}`);
  }
  const source = fileSystem.readFile(path);
  filesByPath.set(path, { path, source });
  const scriptKind = javaScriptKindForPath(path);
  if (scriptKind === undefined) return;
  const rawSource = source.toString("utf8");
  const sourceFile = parseJavaScriptSource(path, rawSource, scriptKind);
  assertStaticModuleLoading(path, sourceFile);
  for (const specifier of staticModuleSpecifiers(sourceFile)) {
    if (!specifier.startsWith(".")) {
      const root = bareSpecifierPackageRoot(specifier);
      if (root !== undefined) bareRoots.add(root);
      continue;
    }
    collectLocalRuleSourceClosure(
      resolveLocalRuleImport(path, specifier, fileSystem),
      fileSystem,
      filesByPath,
      bareRoots,
    );
  }
}

function collectLocalRuleClosure(
  options: ComputeLocalRuleSourceClosureHashOptions,
): LocalRuleClosure {
  const filesByPath = new Map<string, LocalRuleSourceFile>();
  const bareRoots = new Set<string>();
  collectLocalRuleSourceClosure(options.entryPath, options.fileSystem, filesByPath, bareRoots);
  const sortedFiles = [...filesByPath.values()].sort((left, right) => {
    if (left.path < right.path) return -1;
    if (left.path > right.path) return 1;
    return 0;
  });
  const bareSpecifierRoots = [...bareRoots].sort((left, right) => {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
  return { sortedFiles, bareSpecifierRoots };
}

function hashLocalRuleClosureFiles(
  sortedFiles: readonly LocalRuleSourceFile[],
  repoRootPath: string,
): string {
  if (sortedFiles.length === 1 && sortedFiles[0] !== undefined) {
    const hash = createHash("sha256").update(sortedFiles[0].source).digest("hex");
    return `${LINT_RATCHET_CONFIG_HASH_PREFIX}${hash}`;
  }
  const hash = createHash("sha256");
  for (const file of sortedFiles) {
    hash.update(relative(repoRootPath, file.path).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(file.source);
    hash.update("\0");
  }
  return `${LINT_RATCHET_CONFIG_HASH_PREFIX}${hash.digest("hex")}`;
}

// Source-closure hash only (file paths + contents). Environment identities
// (ESLint, typescript-eslint, bare-import versions) are folded in one level up,
// in `computeLocalLintRatchetRuleSourceHash`, so this stays a pure function of
// the closure and its dedicated tests do not depend on installed versions.
export function computeLocalRuleSourceClosureHash(
  options: ComputeLocalRuleSourceClosureHashOptions,
): string {
  return hashLocalRuleClosureFiles(
    collectLocalRuleClosure(options).sortedFiles,
    options.repoRootPath,
  );
}

function computeLocalLintRatchetRuleSourceHash(
  ratchet: LintRatchetConfig,
  binding: LintRatchetEngineBinding,
): string {
  const { repoRoot } = binding;
  const path = localRulePath(ratchet, binding);
  try {
    const closure = collectLocalRuleClosure({
      entryPath: path,
      repoRootPath: repoRoot,
      fileSystem: nodeLocalRuleSourceFileSystem,
    });
    const sourceIdentity = {
      kind: "local",
      closureHash: hashLocalRuleClosureFiles(closure.sortedFiles, repoRoot),
      eslintVersion: readEslintPackageVersion(repoRoot),
      typescriptEslintVersion: readTypescriptEslintPackageVersion(repoRoot),
      bareSpecifierVersions: closure.bareSpecifierRoots.map((packageRoot) => ({
        package: packageRoot,
        version: readPackageVersion(packageRoot, "local rule dependency package", repoRoot),
      })),
    };
    const hash = createHash("sha256").update(JSON.stringify(sourceIdentity)).digest("hex");
    return `${LINT_RATCHET_CONFIG_HASH_PREFIX}${hash}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(
      `ratchet ${ratchet.id}: could not compute local rule source hash: ${message}`,
    );
  }
}

function computeLintRatchetRuleSourceHash(
  ratchet: LintRatchetConfig,
  binding: LintRatchetEngineBinding,
  localHashesByPath: Map<string, string>,
): string {
  const source = ratchetSource(ratchet);
  switch (source.kind) {
    case "local": {
      const path = localRulePath(ratchet, binding);
      const cached = localHashesByPath.get(path);
      if (cached !== undefined) return cached;
      const hash = computeLocalLintRatchetRuleSourceHash(ratchet, binding);
      localHashesByPath.set(path, hash);
      return hash;
    }
    case "third-party": {
      const support = thirdPartySupportFor(ratchet, binding.thirdPartyPluginAllowlist);
      const sourceIdentity = {
        kind: "third-party",
        pluginExport: support.pluginExport ?? "default",
        pluginModule: source.pluginModule,
        pluginVersion: readThirdPartyPluginVersion(source.pluginModule, binding.repoRoot),
        ruleNamespace: support.ruleNamespace,
        eslintVersion: readEslintPackageVersion(binding.repoRoot),
        parserTypescriptEslintVersion: readTypescriptEslintPackageVersion(binding.repoRoot),
        // TypeScript is a findings input only for type-aware rules; the key is
        // present exactly for those ratchets so their hash re-keys on TS upgrades.
        ...(ratchetParserProfile(ratchet) === "type-aware-ts"
          ? { typescriptVersion: readTypescriptPackageVersion(binding.repoRoot) }
          : {}),
      };
      const hash = createHash("sha256").update(JSON.stringify(sourceIdentity)).digest("hex");
      return `${LINT_RATCHET_CONFIG_HASH_PREFIX}${hash}`;
    }
    case "core":
      return computeCoreLintRatchetRuleSourceHash(
        ratchet,
        readEslintPackageVersion(binding.repoRoot),
        readTypescriptEslintPackageVersion(binding.repoRoot),
      );
    default:
      return assertNever(source);
  }
}

export function buildRuleSourceHashesById(
  ratchets: readonly LintRatchetConfig[],
  binding: LintRatchetEngineBinding,
): LintRatchetRuleSourceHashesById {
  const map = new Map<string, string>();
  const localHashesByPath = new Map<string, string>();
  for (const ratchet of ratchets) {
    map.set(ratchet.id, computeLintRatchetRuleSourceHash(ratchet, binding, localHashesByPath));
  }
  return map;
}
