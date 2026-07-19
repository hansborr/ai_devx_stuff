import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

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
import type { LintRatchetEngineBinding } from "./engine-context.js";
import { ConfigError } from "./metrics-types.js";
import { assertScannableImports } from "./rule-source-import-guard.js";
import { assertNever, ratchetParserProfile, ratchetSource } from "./runtime-config.js";

// Static `import … from`, bare `import "./x"`, and `export … from` re-exports
// all pull the referenced file into the rule's behavior, so all three belong
// in the closure. Dynamic `import()`/`require()` cannot be resolved textually,
// so they are not scanned here and are rejected outright by the import guard
// (see `assertScannableImports`) rather than silently excluded. The two
// patterns share their prefix and differ only in the
// captured specifier: relative (`./`, `../`) vs. bare (an npm package). Both are
// scanned over comment-stripped source (see `stripCommentsForImportScan`) so a
// commented-out `import … from "./missing"` no longer raises a spurious
// ConfigError and a commented bare import no longer over-covers versions.
const RELATIVE_STATIC_IMPORT_PATTERN =
  /^\s*(?:import(?:\s[^'"]+\sfrom\s+|\s*)|export\s[^'"]*?\sfrom\s+)["'](\.{1,2}\/[^"']+)["']/gmu;
// Bare specifier: not relative (`.`), not absolute (`/`), not a quote. Protocol
// specifiers like `node:fs` are captured here but filtered by
// `bareSpecifierPackageRoot`, which only yields real npm package roots.
const BARE_STATIC_IMPORT_PATTERN =
  /^\s*(?:import(?:\s[^'"]+\sfrom\s+|\s*)|export\s[^'"]*?\sfrom\s+)["']([^./"'][^"']*)["']/gmu;

// Blank out comments before import scanning. Block comments keep their newlines
// so the `^\s*` line anchors of the import patterns stay aligned; line comments
// are dropped to end-of-line. Naive by design — it only feeds import detection,
// never re-emitted source — so mangling comment-like bytes inside a string
// literal is harmless (such bytes never form a real import specifier).
function stripCommentsForImportScan(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//gu, (block) => block.replaceAll(/[^\n]/gu, " "))
    .replaceAll(/\/\/[^\n]*/gu, "");
}

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

export function localRulePath(ratchet: LintRatchetConfig, repoRoot: string): string {
  return join(repoRoot, "eslint-rules", `${localRuleName(ratchet.ruleId)}.js`);
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

function relativeStaticImportSpecifiers(source: string): readonly string[] {
  return [...source.matchAll(RELATIVE_STATIC_IMPORT_PATTERN)].map((match) => match[1] ?? "");
}

function bareStaticImportPackageRoots(source: string): readonly string[] {
  const roots: string[] = [];
  for (const match of source.matchAll(BARE_STATIC_IMPORT_PATTERN)) {
    const root = bareSpecifierPackageRoot(match[1] ?? "");
    if (root !== undefined) roots.push(root);
  }
  return roots;
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
  const rawSource = source.toString("utf8");
  // Guard on the raw source: the guard does its own literal-aware masking, and
  // comment-stripping first would reintroduce the `//`-in-string blind spot it
  // exists to close. Specifier extraction keeps using the comment-only strip so
  // closure hashes are byte-stable.
  assertScannableImports(path, rawSource);
  const scannable = stripCommentsForImportScan(rawSource);
  for (const root of bareStaticImportPackageRoots(scannable)) bareRoots.add(root);
  for (const specifier of relativeStaticImportSpecifiers(scannable)) {
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
  repoRoot: string,
): string {
  const path = localRulePath(ratchet, repoRoot);
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
): string {
  const source = ratchetSource(ratchet);
  switch (source.kind) {
    case "local":
      return computeLocalLintRatchetRuleSourceHash(ratchet, binding.repoRoot);
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
  for (const ratchet of ratchets) {
    map.set(ratchet.id, computeLintRatchetRuleSourceHash(ratchet, binding));
  }
  return map;
}
