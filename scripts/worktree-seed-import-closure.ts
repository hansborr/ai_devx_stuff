import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";

import ts from "typescript";

import { runtimeImportSpecifiers } from "./worktree-seed-runtime-loaders.js";

interface ClosureOptions {
  readonly root: string;
  readonly entry: string;
  readonly allowedRoots: readonly string[];
  readonly allowedFiles: readonly string[];
}

interface ClosureValidation {
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
): string | undefined => {
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

const validateSeedImportClosure = (options: ClosureOptions): ClosureValidation => {
  const root = realpathSync(options.root);
  const entry = realpathSync(resolve(root, options.entry));
  const allowedRoots = options.allowedRoots.map((path) => resolve(root, path));
  const allowedFiles = new Set([
    entry,
    ...options.allowedFiles.map((path) => realpathSync(resolve(root, path))),
  ]);
  const violations: string[] = [];
  const visited = new Set<string>();
  const pending = [entry];

  while (pending.length > 0) {
    const importer = pending.pop();
    if (importer === undefined || visited.has(importer)) continue;
    visited.add(importer);
    if (extname(importer) === ".json") continue;

    const source = readFileSync(importer, "utf8");
    const sourceFile = ts.createSourceFile(importer, source, ts.ScriptTarget.Latest, true);
    for (const specifier of runtimeImportSpecifiers(sourceFile)) {
      const imported = resolveLocalImport(root, importer, specifier);
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
