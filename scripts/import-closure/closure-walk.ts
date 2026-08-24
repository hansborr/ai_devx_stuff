import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

import { analyzeRuntimeSource, type RuntimeSourceOptions } from "./runtime-imports.js";
import {
  runtimeFileShouldBeTraversed,
  runtimeResolutionCandidates,
  sourceResolutionExtensions,
} from "./runtime-resolution.js";

export interface ClosureOptions {
  readonly root: string;
  readonly entry: string;
  readonly allowedRoots: readonly string[];
  readonly allowedFiles: readonly string[];
  /**
   * Bare package specifiers to treat as external (resolved via node_modules at
   * runtime, e.g. a workspace package symlink): matching imports are skipped
   * instead of resolved into the repository-local closure. Matches the exact
   * package name or any subpath under it. Defaults to none, preserving the
   * historical behavior where unexpected `@musi/*` imports throw.
   */
  readonly externalPackages?: readonly string[];
  /** Exact bare specifiers that resolve to repository-owned source files. */
  readonly repositoryPackageImports?: Readonly<Record<string, string>>;
  /** Static process.env keys permitted to affect seed behavior. Undefined disables this policy. */
  readonly allowedEnvironmentVariables?: readonly string[];
  /**
   * Repository-relative paths the consumer replaces with its own stub, so the
   * walk records them but stops instead of following the real file's imports.
   * Used by fixture copy-set checks where a sandbox synthesizes a minimal
   * stand-in (a stub config module) whose real transitive inputs the sandbox
   * never needs. Paths that do not exist are ignored.
   */
  readonly terminalFiles?: readonly string[];
  /**
   * Forwarded to the source policy: `"throw"` (default) rejects runtime
   * imports without a static string specifier; `"skip"` ignores them for
   * closure walks over code that loads runtime-configured inputs.
   */
  readonly nonStaticSpecifiers?: "throw" | "skip";
}

export interface ClosureValidation {
  readonly files: readonly string[];
  readonly violations: readonly string[];
}

const fingerprintableExtensionSet: ReadonlySet<string> = new Set(sourceResolutionExtensions);
const nodeArgvUserArgumentOffset = 2;
const isWithin = (parent: string, child: string): boolean => {
  const pathFromParent = relative(parent, child);
  return pathFromParent === "" || (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent));
};

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const specifierMatchesPackage = (specifier: string, packageName: string): boolean =>
  specifier === packageName || specifier.startsWith(`${packageName}/`);

const localImportBase = (root: string, importer: string, specifier: string): string | undefined => {
  if (specifier.startsWith(".")) return resolve(dirname(importer), specifier);
  if (specifier === "@musi/shared") return resolve(root, "packages/shared/src/index");
  if (specifier.startsWith("@musi/shared/")) {
    return resolve(root, "packages/shared/src", specifier.slice("@musi/shared/".length));
  }
  if (specifier === "@musi/server") return resolve(root, "packages/server/src/index");
  if (specifier.startsWith("@musi/server/")) {
    return resolve(root, "packages/server/src", specifier.slice("@musi/server/".length));
  }
  if (specifier.startsWith("@musi/")) {
    throw new Error(`unsupported repository-local package import ${specifier}`);
  }
  return undefined;
};

interface ImportResolutionContext {
  readonly externalPackages: ReadonlySet<string>;
  readonly repositoryPackageImports: ReadonlyMap<string, string>;
  readonly root: string;
}

const resolveLocalImport = (
  context: ImportResolutionContext,
  importer: string,
  specifier: string,
): string | undefined => {
  const { externalPackages, root } = context;
  const repositoryPackageImport = context.repositoryPackageImports.get(specifier);
  if (repositoryPackageImport !== undefined) {
    if (!isFile(repositoryPackageImport)) {
      throw new Error(`repository package import does not resolve to a file: ${specifier}`);
    }
    return validateResolvedLocalImport(root, specifier, importer, repositoryPackageImport);
  }
  for (const packageName of externalPackages) {
    if (specifierMatchesPackage(specifier, packageName)) return undefined;
  }
  const base = localImportBase(root, importer, specifier);
  if (base === undefined) {
    return resolveUnmappedRuntimeImport(root, importer, specifier);
  }
  const candidate = runtimeResolutionCandidates(base).find(isFile);
  if (candidate === undefined) {
    throw new Error(
      `cannot resolve repository-local import ${specifier} from ${relative(root, importer)}`,
    );
  }
  return validateResolvedLocalImport(root, specifier, importer, candidate);
};

const validateResolvedLocalImport = (
  root: string,
  specifier: string,
  importer: string,
  candidate: string,
): string => {
  const resolved = realpathSync(candidate);
  if (!isWithin(root, resolved)) {
    throw new Error(
      `repository-local import escapes root: ${specifier} from ${relative(root, importer)}`,
    );
  }
  if (!fingerprintableExtensionSet.has(extname(resolved))) {
    throw new Error(
      `repository-local runtime import has unsupported extension: ${relative(root, resolved)}`,
    );
  }
  return resolved;
};

const pathUsesNodeModules = (path: string): boolean =>
  resolve(path).split(sep).includes("node_modules");

const resolveUnmappedRuntimeImport = (
  root: string,
  importer: string,
  specifier: string,
): string | undefined => {
  if (specifier === "bun") return undefined;
  let resolvedUrl: string;
  try {
    resolvedUrl = import.meta.resolve(specifier, pathToFileURL(importer).href);
  } catch {
    throw new Error(
      `cannot classify runtime import ${specifier} from ${relative(root, importer)}; ` +
        "install the package if it is external, declare it through the consumer's externalPackages policy in a synthetic tree, or use a supported repository-local relative/package mapping",
    );
  }
  if (resolvedUrl.startsWith("node:") || resolvedUrl.startsWith("bun:")) return undefined;
  if (!resolvedUrl.startsWith("file:")) {
    throw new Error(
      `runtime import resolves to unsupported URL ${resolvedUrl} from ${relative(root, importer)}`,
    );
  }
  const resolved = fileURLToPath(resolvedUrl);
  // Installed dependencies are fingerprinted at lockfile granularity by the
  // consumer, so the walk records nothing beyond "this edge left the tree".
  if (pathUsesNodeModules(resolved)) return undefined;
  if (!isFile(resolved)) {
    throw new Error(
      `resolved runtime import is not a regular file: ${specifier} from ${relative(root, importer)}`,
    );
  }
  return validateResolvedLocalImport(root, specifier, importer, resolved);
};

const resolveTerminalFiles = (
  root: string,
  terminalFiles: readonly string[] | undefined,
): ReadonlySet<string> =>
  new Set(
    (terminalFiles ?? [])
      .map((path) => resolve(root, path))
      .filter(isFile)
      .map((path) => realpathSync(path)),
  );

interface MemoizedAnalysis {
  readonly imports: readonly string[];
  readonly source: string;
}

const sourceAnalysisCache = new Map<string, MemoizedAnalysis>();
/** Bounds the cache for long-lived processes; the working set is far smaller. */
const sourceAnalysisCacheLimit = 4096;

/**
 * Parsing dominates a closure walk, and the fixture copy-set checks walk the
 * same shared `scripts/**` modules from many entry points at once (the live
 * smoke corpus visits 508 files that are only 36 distinct modules). The
 * analysis is a pure function of the file's bytes and the policy options, so it
 * is memoized per (options, path) and the memo is only reused when the freshly
 * read source is byte-identical. A file rewritten in place — which the scripts
 * suites do constantly against synthetic trees — is therefore re-parsed rather
 * than answered from a stale entry, and the walk keeps reading every file on
 * every call exactly as before. Failures are never memoized, so a file that
 * throws throws every time.
 */
const analysisOf = (
  path: string,
  source: string,
  options: RuntimeSourceOptions,
): readonly string[] => {
  const environmentPolicy = (options.allowedEnvironmentVariables ?? []).join(",");
  const key = `${options.nonStaticSpecifiers ?? "throw"} ${environmentPolicy} ${path}`;
  const memoized = sourceAnalysisCache.get(key);
  if (memoized !== undefined && memoized.source === source) return memoized.imports;
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const imports = analyzeRuntimeSource(sourceFile, options);
  if (sourceAnalysisCache.size >= sourceAnalysisCacheLimit) sourceAnalysisCache.clear();
  sourceAnalysisCache.set(key, { imports, source });
  return imports;
};

export const validateSeedImportClosure = (options: ClosureOptions): ClosureValidation => {
  const root = realpathSync(options.root);
  const entry = realpathSync(resolve(root, options.entry));
  const resolutionContext = {
    externalPackages: new Set(options.externalPackages ?? []),
    repositoryPackageImports: new Map(
      Object.entries(options.repositoryPackageImports ?? {}).map(([specifier, path]) => [
        specifier,
        resolve(root, path),
      ]),
    ),
    root,
  };
  const allowedRoots = options.allowedRoots.map((path) => resolve(root, path));
  const allowedFiles = new Set([
    entry,
    ...options.allowedFiles.map((path) => realpathSync(resolve(root, path))),
  ]);
  const terminalFiles = resolveTerminalFiles(root, options.terminalFiles);
  const violations: string[] = [];
  const visited = new Set<string>();
  const traversed = new Set<string>();
  const pending: string[] = [entry];

  while (pending.length > 0) {
    const importer = pending.pop();
    if (importer === undefined) continue;
    visited.add(importer);
    if (
      !runtimeFileShouldBeTraversed(
        extname(importer),
        terminalFiles.has(importer),
        traversed.has(importer),
      )
    )
      continue;
    traversed.add(importer);

    const source = readFileSync(importer, "utf8");
    for (const specifier of analysisOf(importer, source, options)) {
      const imported = resolveLocalImport(resolutionContext, importer, specifier);
      if (imported === undefined) continue;
      const allowed =
        allowedFiles.has(imported) ||
        allowedRoots.some((allowedRoot) => isWithin(allowedRoot, imported));
      if (!allowed) {
        violations.push(`${relative(root, imported)} imported by ${relative(root, importer)}`);
      }
      pending.push(imported);
    }
  }

  return {
    files: [...visited].map((path) => relative(root, path)).sort(),
    violations: violations.sort(),
  };
};

const repeatedCliOption = (argv: readonly string[], option: string): readonly string[] => {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== option) continue;
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${option} requires a value`);
    values.push(value);
    index += 1;
  }
  return values;
};

const singleCliOption = (argv: readonly string[], option: string): string => {
  const [value, ...rest] = repeatedCliOption(argv, option);
  if (value === undefined || rest.length > 0) {
    throw new Error(`${option} must be provided exactly once`);
  }
  return value;
};

/** `scripts/worktree-db.sh` is the only caller; the walk is the library surface. */
const runCli = (argv: readonly string[]): void => {
  try {
    const root = singleCliOption(argv, "--root");
    const entry = singleCliOption(argv, "--entry");
    const allowedFiles = repeatedCliOption(argv, "--allowed-file");
    const allowedEnvironmentVariables = repeatedCliOption(argv, "--allowed-environment-variable");
    for (const path of [entry, ...allowedFiles]) {
      if (!existsSync(resolve(root, path))) throw new Error(`missing seed import input: ${path}`);
    }
    const { files, violations } = validateSeedImportClosure({
      root,
      entry,
      allowedRoots: repeatedCliOption(argv, "--allowed-root"),
      allowedFiles,
      ...(allowedEnvironmentVariables.length === 0 ? {} : { allowedEnvironmentVariables }),
    });
    if (violations.length > 0) {
      throw new Error(
        `closure contains unlisted repository-local runtime input(s):\n${violations
          .map((violation) => `  - ${violation}`)
          .join("\n")}`,
      );
    }
    if (argv.includes("--emit-closure-nul")) process.stdout.write(`${files.join("\0")}\0`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`seed import closure check failed: ${message}\n`);
    process.exitCode = 1;
  }
};

if (import.meta.main) runCli(process.argv.slice(nodeArgvUserArgumentOffset));
