import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";

import ts from "typescript";

import { runtimeImportSpecifiers } from "./worktree-seed-runtime-loaders.js";

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
  /**
   * Repository-relative paths the consumer replaces with its own stub, so the
   * walk records them but stops instead of following the real file's imports.
   * Used by fixture copy-set checks where a sandbox synthesizes a minimal
   * stand-in (a stub config module) whose real transitive inputs the sandbox
   * never needs. Paths that do not exist are ignored.
   */
  readonly terminalFiles?: readonly string[];
  /**
   * Forwarded to `runtimeImportSpecifiers`: `"throw"` (default) rejects
   * runtime imports without a static string specifier; `"skip"` ignores them
   * for closure walks over code that loads runtime-configured inputs.
   */
  readonly nonStaticSpecifiers?: "throw" | "skip";
}

export interface ClosureValidation {
  readonly files: readonly string[];
  readonly violations: readonly string[];
}

const fingerprintableExtensions = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
] as const;
const fingerprintableExtensionSet: ReadonlySet<string> = new Set(fingerprintableExtensions);
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

const resolutionCandidates = (base: string): readonly string[] => {
  const extension = extname(base);
  if (extension === ".js") {
    const stem = base.slice(0, -extension.length);
    return [`${stem}.ts`, `${stem}.tsx`, base];
  }
  if (extension === ".mjs") {
    const stem = base.slice(0, -extension.length);
    return [`${stem}.mts`, base];
  }
  if (extension === ".cjs") {
    const stem = base.slice(0, -extension.length);
    return [`${stem}.cts`, base];
  }
  if (extension !== "") return [base];
  return [
    ...fingerprintableExtensions.map((candidateExtension) => `${base}${candidateExtension}`),
    ...fingerprintableExtensions.map((candidateExtension) =>
      resolve(base, `index${candidateExtension}`),
    ),
  ];
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

const resolveLocalImport = (
  root: string,
  importer: string,
  specifier: string,
  externalPackages: ReadonlySet<string>,
): string | undefined => {
  for (const packageName of externalPackages) {
    if (specifierMatchesPackage(specifier, packageName)) return undefined;
  }
  const base = localImportBase(root, importer, specifier);
  if (base === undefined) return undefined;
  const candidate = resolutionCandidates(base).find(isFile);
  if (candidate === undefined) {
    throw new Error(
      `cannot resolve repository-local import ${specifier} from ${relative(root, importer)}`,
    );
  }
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

/**
 * JSON has no imports to follow, and a consumer-declared terminal file is
 * replaced by a stub in the tree being modelled, so its real imports are not
 * part of that tree's closure. Both are recorded, neither is traversed.
 */
const stopsTraversal = (path: string, terminalFiles: ReadonlySet<string>): boolean =>
  extname(path) === ".json" || terminalFiles.has(path);

interface MemoizedImportSpecifiers {
  readonly source: string;
  readonly specifiers: readonly string[];
}

const importSpecifierCache = new Map<string, MemoizedImportSpecifiers>();
/** Bounds the cache for long-lived processes; the working set is far smaller. */
const importSpecifierCacheLimit = 4096;

/**
 * Parsing dominates a closure walk, and the fixture copy-set checks walk the
 * same shared `scripts/**` modules from many entry points at once (the live
 * smoke corpus visits 508 files that are only 36 distinct modules). The
 * specifier list is a pure function of the file's bytes and the non-static
 * specifier mode, so it is memoized per (mode, path) and the memo is only
 * reused when the freshly read source is byte-identical. A file rewritten in
 * place — which the scripts suites do constantly against synthetic trees — is
 * therefore re-parsed rather than answered from a stale entry, and the walk
 * keeps reading every file on every call exactly as before. Failures are never
 * memoized, so a file that throws throws every time.
 */
const importSpecifiersOf = (
  path: string,
  source: string,
  nonStaticSpecifiers: "throw" | "skip" | undefined,
): readonly string[] => {
  const key = `${nonStaticSpecifiers ?? "throw"} ${path}`;
  const memoized = importSpecifierCache.get(key);
  if (memoized !== undefined && memoized.source === source) return memoized.specifiers;
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const specifiers = runtimeImportSpecifiers(sourceFile, { nonStaticSpecifiers });
  if (importSpecifierCache.size >= importSpecifierCacheLimit) importSpecifierCache.clear();
  importSpecifierCache.set(key, { source, specifiers });
  return specifiers;
};

export const validateSeedImportClosure = (options: ClosureOptions): ClosureValidation => {
  const root = realpathSync(options.root);
  const entry = realpathSync(resolve(root, options.entry));
  const externalPackages = new Set(options.externalPackages ?? []);
  const allowedRoots = options.allowedRoots.map((path) => resolve(root, path));
  const allowedFiles = new Set([
    entry,
    ...options.allowedFiles.map((path) => realpathSync(resolve(root, path))),
  ]);
  const terminalFiles = resolveTerminalFiles(root, options.terminalFiles);
  const violations: string[] = [];
  const visited = new Set<string>();
  const pending = [entry];

  while (pending.length > 0) {
    const importer = pending.pop();
    if (importer === undefined || visited.has(importer)) continue;
    visited.add(importer);
    if (stopsTraversal(importer, terminalFiles)) continue;

    const source = readFileSync(importer, "utf8");
    const specifiers = importSpecifiersOf(importer, source, options.nonStaticSpecifiers);
    for (const specifier of specifiers) {
      const imported = resolveLocalImport(root, importer, specifier, externalPackages);
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

const readRepeatedOption = (argv: readonly string[], option: string): readonly string[] => {
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

const readSingleOption = (argv: readonly string[], option: string): string => {
  const values = readRepeatedOption(argv, option);
  if (values.length !== 1) throw new Error(`${option} must be provided exactly once`);
  const value = values[0];
  if (value === undefined) throw new Error(`${option} requires a value`);
  return value;
};

if (import.meta.main) {
  try {
    const argv = process.argv.slice(nodeArgvUserArgumentOffset);
    const root = readSingleOption(argv, "--root");
    const entry = readSingleOption(argv, "--entry");
    const allowedRoots = readRepeatedOption(argv, "--allowed-root");
    const allowedFiles = readRepeatedOption(argv, "--allowed-file");
    const emitClosureNul = argv.includes("--emit-closure-nul");
    for (const path of [entry, ...allowedFiles]) {
      if (!existsSync(resolve(root, path))) throw new Error(`missing seed import input: ${path}`);
    }
    const { files, violations } = validateSeedImportClosure({
      root,
      entry,
      allowedRoots,
      allowedFiles,
    });
    if (violations.length > 0) {
      process.stderr.write(
        `seed import closure contains unlisted repository-local runtime input(s):\n${violations
          .map((violation) => `  - ${violation}`)
          .join("\n")}\n`,
      );
      process.exitCode = 1;
    } else if (emitClosureNul) {
      process.stdout.write(`${files.join("\0")}\0`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`seed import closure check failed: ${message}\n`);
    process.exitCode = 1;
  }
}
