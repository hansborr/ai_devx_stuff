import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

import {
  computeCoreLintRatchetRuleSourceHash,
  LINT_RATCHET_CONFIG_HASH_PREFIX,
  type LintRatchetRuleSourceHashesById,
  ruleNamespace,
} from "./lint-ratchet-baseline.js";
import {
  type LintRatchetConfig,
  lintRatchetThirdPartyPluginAllowlist,
  type LintRatchetThirdPartyPluginAllowlistEntry,
} from "./lint-ratchet-config.js";
import { ConfigError } from "./lint-ratchet-metrics.js";
import { repoRoot } from "./paths.js";
import { assertNever, ratchetSource } from "./runtime-config.js";

// Static `import … from`, bare `import "./x"`, and `export … from` re-exports
// all pull the referenced file into the rule's behavior, so all three belong
// in the closure. Dynamic `import()`/`require()` stay out of scope: local
// rules are static ES modules and a conditional load cannot be resolved
// textually anyway.
const RELATIVE_STATIC_IMPORT_PATTERN =
  /^\s*(?:import(?:\s[^'"]+\sfrom\s+|\s*)|export\s[^'"]*?\sfrom\s+)["'](\.{1,2}\/[^"']+)["']/gmu;

interface LocalRuleSourceFileSystem {
  readonly exists: (path: string) => boolean;
  readonly readFile: (path: string) => Buffer;
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

export function localRulePath(ratchet: LintRatchetConfig): string {
  return join(repoRoot, "eslint-rules", `${localRuleName(ratchet.ruleId)}.js`);
}

export function thirdPartySupportFor(
  ratchet: LintRatchetConfig,
): LintRatchetThirdPartyPluginAllowlistEntry {
  const source = ratchetSource(ratchet);
  if (source.kind !== "third-party") {
    throw new ConfigError(`ratchet ${ratchet.id}: expected third-party source`);
  }
  const namespace = ruleNamespace(ratchet.ruleId);
  const support = lintRatchetThirdPartyPluginAllowlist.find(
    (entry) => entry.pluginModule === source.pluginModule && entry.ruleNamespace === namespace,
  );
  if (support === undefined) {
    throw new ConfigError(
      `ratchet ${ratchet.id}: third-party plugin ${source.pluginModule} for namespace ${namespace ?? "(unknown)"} is not allowlisted`,
    );
  }
  return support;
}

function packageJsonPath(packageName: string): string {
  return join(repoRoot, "node_modules", ...packageName.split("/"), "package.json");
}

function readPackageVersion(packageName: string, packageLabel: string): string {
  const packageJsonFile = packageJsonPath(packageName);
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

function readThirdPartyPluginVersion(pluginModule: string): string {
  return readPackageVersion(pluginModule, "third-party plugin package");
}

function readEslintPackageVersion(): string {
  return readPackageVersion("eslint", "ESLint package");
}

function relativeStaticImportSpecifiers(source: string): readonly string[] {
  return [...source.matchAll(RELATIVE_STATIC_IMPORT_PATTERN)].map((match) => match[1] ?? "");
}

function resolveLocalRuleImport(
  importerPath: string,
  specifier: string,
  fileSystem: LocalRuleSourceFileSystem,
): string {
  const resolved = resolve(dirname(importerPath), specifier);
  if (extname(resolved) !== "" || fileSystem.exists(resolved)) return resolved;
  return `${resolved}.js`;
}

function collectLocalRuleSourceClosure(
  path: string,
  fileSystem: LocalRuleSourceFileSystem,
  filesByPath: Map<string, LocalRuleSourceFile>,
): void {
  if (filesByPath.has(path)) return;
  if (!fileSystem.exists(path)) {
    throw new ConfigError(`local rule source not found at ${path}`);
  }
  const source = fileSystem.readFile(path);
  filesByPath.set(path, { path, source });
  for (const specifier of relativeStaticImportSpecifiers(source.toString("utf8"))) {
    collectLocalRuleSourceClosure(
      resolveLocalRuleImport(path, specifier, fileSystem),
      fileSystem,
      filesByPath,
    );
  }
}

export function computeLocalRuleSourceClosureHash(
  options: ComputeLocalRuleSourceClosureHashOptions,
): string {
  const filesByPath = new Map<string, LocalRuleSourceFile>();
  collectLocalRuleSourceClosure(options.entryPath, options.fileSystem, filesByPath);
  const sortedFiles = [...filesByPath.values()].sort((left, right) => {
    if (left.path < right.path) return -1;
    if (left.path > right.path) return 1;
    return 0;
  });
  if (sortedFiles.length === 1 && sortedFiles[0] !== undefined) {
    const hash = createHash("sha256").update(sortedFiles[0].source).digest("hex");
    return `${LINT_RATCHET_CONFIG_HASH_PREFIX}${hash}`;
  }
  const hash = createHash("sha256");
  for (const file of sortedFiles) {
    hash.update(relative(options.repoRootPath, file.path).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(file.source);
    hash.update("\0");
  }
  return `${LINT_RATCHET_CONFIG_HASH_PREFIX}${hash.digest("hex")}`;
}

function computeLocalLintRatchetRuleSourceHash(ratchet: LintRatchetConfig): string {
  const path = localRulePath(ratchet);
  try {
    return computeLocalRuleSourceClosureHash({
      entryPath: path,
      repoRootPath: repoRoot,
      fileSystem: nodeLocalRuleSourceFileSystem,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(
      `ratchet ${ratchet.id}: could not compute local rule source hash: ${message}`,
    );
  }
}

function computeLintRatchetRuleSourceHash(ratchet: LintRatchetConfig): string {
  const source = ratchetSource(ratchet);
  switch (source.kind) {
    case "local":
      return computeLocalLintRatchetRuleSourceHash(ratchet);
    case "third-party": {
      const support = thirdPartySupportFor(ratchet);
      const sourceIdentity = {
        kind: "third-party",
        pluginExport: support.pluginExport ?? "default",
        pluginModule: source.pluginModule,
        pluginVersion: readThirdPartyPluginVersion(source.pluginModule),
        ruleNamespace: support.ruleNamespace,
      };
      const hash = createHash("sha256").update(JSON.stringify(sourceIdentity)).digest("hex");
      return `${LINT_RATCHET_CONFIG_HASH_PREFIX}${hash}`;
    }
    case "core":
      return computeCoreLintRatchetRuleSourceHash(ratchet, readEslintPackageVersion());
    default:
      return assertNever(source);
  }
}

export function buildRuleSourceHashesById(
  ratchets: readonly LintRatchetConfig[],
): LintRatchetRuleSourceHashesById {
  const map = new Map<string, string>();
  for (const ratchet of ratchets) map.set(ratchet.id, computeLintRatchetRuleSourceHash(ratchet));
  return map;
}
