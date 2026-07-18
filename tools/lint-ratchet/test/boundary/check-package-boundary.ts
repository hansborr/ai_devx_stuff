import { readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";

import ts from "typescript";

/**
 * Resolver-aware, fail-closed boundary checker for the portable package (slice
 * plan §2.1). For every `.ts` under the package it enumerates both static and
 * dynamic module specifiers and classifies each. The only accepted categories:
 *
 *  - a relative or self (`@musi/lint-ratchet/…`) specifier that **resolves to an
 *    existing file inside the package** — through the package `exports` map for
 *    self-imports — with a `.js`→`.ts` source remap; a dangling one is rejected;
 *  - a `node:`/`bun:` built-in on the **explicit prefixed allowlist** (only what
 *    the engine actually imports; an unprefixed legacy builtin or an unknown
 *    `node:`/`bun:` name is rejected);
 *  - a bare specifier whose package root is a declared dependency of this
 *    package's own `package.json`, declared with a portable version (a
 *    `file:`/`link:`/`workspace:`/`portal:`/`local:` protocol is rejected) **and
 *    which actually resolves** from the package directory.
 *
 * Any other same-scope sibling (`@<own-scope>/<other>`) is rejected
 * unconditionally, even when declared: a portable package must never reach a
 * repo-internal package. Everything else is a violation. Computed
 * (non-string-literal) dynamic import
 * specifiers cannot be classified statically; they are reported separately so a
 * caller can forbid them on the engine surface while tolerating them in test
 * scaffolding.
 *
 * The ignore mechanism is sealed: {@link ALLOWED_IGNORE_PATHS} is the entire
 * exception set the checker will honor, and any caller-supplied path outside it
 * is refused (see {@link checkPackageBoundary}). Ignored files are reported on
 * the result so the exception is auditable.
 */

/**
 * The complete, hard-coded set of package-relative `.ts` files the boundary scan
 * may skip. Reserved for this-repo test-runner integration only: the package's
 * Vitest project config imports shared worker-coordination constants from the
 * root `vitest.config.ts` (the same convention as `packages/shared/vitest.config.ts`
 * and `scripts/vitest.config.ts`); an adopter of `tools/lint-ratchet` supplies
 * their own runner config. No `src/` or `test/` path is — or may be — a member,
 * so the portable engine and its tests are always scanned.
 */
export const ALLOWED_IGNORE_PATHS: readonly string[] = ["vitest.config.ts"];

/** `node:` built-ins the engine and its tests import. Grow as imports move in. */
const NODE_BUILTIN_ALLOWLIST = new Set([
  "child_process",
  "crypto",
  "fs",
  "fs/promises",
  "module",
  "os",
  "path",
  "url",
]);
/** `bun:` runtime built-ins a portable engine may use. */
const BUN_BUILTIN_ALLOWLIST = new Set(["test", "sqlite", "ffi", "jsc"]);

interface BoundaryViolation {
  readonly file: string;
  readonly specifier: string;
  readonly reason: string;
}

interface ComputedDynamicImport {
  readonly file: string;
}

export interface BoundaryReport {
  readonly violations: readonly BoundaryViolation[];
  readonly computedDynamic: readonly ComputedDynamicImport[];
  readonly ignoredFiles: readonly string[];
  readonly scannedFiles: number;
}

interface PackageManifest {
  readonly name: string;
  readonly dependencies: Record<string, string>;
  readonly exports: Record<string, string>;
}

const ALL_NODE_BUILTINS = new Set(builtinModules);
const BUN_BUILTIN_PREFIX = "bun:";
const NODE_BUILTIN_PREFIX = "node:";
const SCOPED_ROOT_SEGMENTS = 2;
const NON_PORTABLE_PROTOCOLS = ["file:", "link:", "workspace:", "portal:", "local:"];
const PRUNED_DIRECTORY_NAMES = new Set(["node_modules", "dist"]);
const SOURCE_EXTENSIONS = [".ts", ".tsx"];
const JS_EXTENSION_PATTERN = /\.(?:js|jsx|mjs|cjs)$/u;

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function readStringRecord(source: unknown): Record<string, string> {
  if (!isStringRecord(source)) return {};
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (typeof value === "string") out[name] = value;
  }
  return out;
}

function readManifest(packageDir: string): PackageManifest {
  const parsed: unknown = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  if (!isStringRecord(parsed) || typeof parsed.name !== "string") {
    throw new Error(`${packageDir}/package.json must declare a string "name"`);
  }
  return {
    name: parsed.name,
    dependencies: {
      ...readStringRecord(parsed.dependencies),
      ...readStringRecord(parsed.devDependencies),
    },
    exports: readStringRecord(parsed.exports),
  };
}

function listTsFiles(packageDir: string): string[] {
  const entries = readdirSync(packageDir, { recursive: true, withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const full = join(entry.parentPath, entry.name);
    const segments = relative(packageDir, full).split(sep);
    if (segments.some((segment) => PRUNED_DIRECTORY_NAMES.has(segment))) continue;
    out.push(full);
  }
  return out.sort(compareStrings);
}

interface ExtractedSpecifiers {
  readonly strings: readonly string[];
  readonly computedDynamic: number;
}

function staticSpecifierOf(node: ts.Node): string | undefined {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier !== undefined &&
    ts.isStringLiteral(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier.text;
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    ts.isStringLiteral(node.moduleReference.expression)
  ) {
    return node.moduleReference.expression.text;
  }
  return undefined;
}

function isDynamicImportCall(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
}

function extractSpecifiers(fileAbs: string): ExtractedSpecifiers {
  const source = ts.createSourceFile(
    fileAbs,
    readFileSync(fileAbs, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const strings: string[] = [];
  let computedDynamic = 0;
  const visit = (node: ts.Node): void => {
    const staticSpecifier = staticSpecifierOf(node);
    if (staticSpecifier !== undefined) {
      strings.push(staticSpecifier);
    } else if (isDynamicImportCall(node)) {
      const [firstArgument] = node.arguments;
      if (firstArgument !== undefined && ts.isStringLiteral(firstArgument)) {
        strings.push(firstArgument.text);
      } else {
        computedDynamic += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { strings, computedDynamic };
}

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** Resolve a filesystem path to an existing source file, remapping `.js`→`.ts`. */
function resolveModuleFile(candidateAbs: string): string | undefined {
  const attempts = [candidateAbs];
  const jsMatch = JS_EXTENSION_PATTERN.exec(candidateAbs);
  if (jsMatch !== null) {
    const base = candidateAbs.slice(0, candidateAbs.length - jsMatch[0].length);
    for (const ext of SOURCE_EXTENSIONS) attempts.push(base + ext);
  }
  for (const ext of SOURCE_EXTENSIONS) attempts.push(candidateAbs + ext);
  for (const ext of SOURCE_EXTENSIONS) attempts.push(join(candidateAbs, `index${ext}`));
  return attempts.find(isFile);
}

function isInsidePackage(targetAbs: string, packageDir: string): boolean {
  const rel = relative(packageDir, targetAbs);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
}

function packageRootOf(specifier: string): string {
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) return parts.slice(0, SCOPED_ROOT_SEGMENTS).join("/");
  return parts[0] ?? specifier;
}

/** Map a self-import subpath (e.g. `./kernel/x.js`) to a target via the exports map. */
function resolveExportSubpath(
  subpath: string,
  packageDir: string,
  exportsMap: Record<string, string>,
): string | undefined {
  for (const [key, target] of Object.entries(exportsMap)) {
    const relativeTarget = matchExportPattern(key, target, subpath);
    if (relativeTarget === undefined) continue;
    const resolved = resolveModuleFile(join(packageDir, relativeTarget));
    if (resolved !== undefined) return resolved;
  }
  return undefined;
}

function matchExportPattern(key: string, target: string, subpath: string): string | undefined {
  if (!key.includes("*")) return key === subpath ? target : undefined;
  const [keyBefore = "", keyAfter = ""] = key.split("*");
  if (!subpath.startsWith(keyBefore) || !subpath.endsWith(keyAfter)) return undefined;
  const star = subpath.slice(keyBefore.length, subpath.length - keyAfter.length);
  if (star.length === 0) return undefined;
  const [targetBefore = "", targetAfter = ""] = target.split("*");
  return `${targetBefore}${star}${targetAfter}`;
}

function classifyRelative(
  specifier: string,
  fileAbs: string,
  packageDir: string,
): string | undefined {
  const candidate = resolve(dirname(fileAbs), specifier);
  if (!isInsidePackage(candidate, packageDir)) {
    return `relative import escapes the package: ${specifier}`;
  }
  const resolved = resolveModuleFile(candidate);
  if (resolved === undefined || !isInsidePackage(resolved, packageDir)) {
    return `relative import does not resolve to a file in the package: ${specifier}`;
  }
  return undefined;
}

function classifyBuiltin(specifier: string): string | undefined {
  if (specifier.startsWith(NODE_BUILTIN_PREFIX)) {
    const name = specifier.slice(NODE_BUILTIN_PREFIX.length);
    return NODE_BUILTIN_ALLOWLIST.has(name)
      ? undefined
      : `node: built-in not on the engine allowlist: ${specifier}`;
  }
  const name = specifier.slice(BUN_BUILTIN_PREFIX.length);
  return BUN_BUILTIN_ALLOWLIST.has(name)
    ? undefined
    : `bun: built-in not on the engine allowlist: ${specifier}`;
}

function isSameScopeSibling(root: string, packageName: string): boolean {
  if (!packageName.startsWith("@")) return false;
  const [scope] = packageName.split("/");
  return scope !== undefined && root !== packageName && root.startsWith(`${scope}/`);
}

function classifySelf(
  specifier: string,
  packageDir: string,
  manifest: PackageManifest,
): string | undefined {
  const subpath = `.${specifier.slice(manifest.name.length)}`;
  const resolved = resolveExportSubpath(subpath, packageDir, manifest.exports);
  if (resolved === undefined) {
    return `self-import does not resolve through the package exports map: ${specifier}`;
  }
  if (!isInsidePackage(resolved, packageDir)) {
    return `self-import exports target escapes the package: ${specifier}`;
  }
  return undefined;
}

/** Resolve a declared bare specifier from the package directory (root hoisting applies). */
function bareResolves(specifier: string, packageDir: string): boolean {
  try {
    createRequire(join(packageDir, "package.json")).resolve(specifier);
    return true;
  } catch {
    return false;
  }
}

function classifyBare(
  specifier: string,
  packageDir: string,
  manifest: PackageManifest,
): string | undefined {
  const root = packageRootOf(specifier);
  if (root === manifest.name) return classifySelf(specifier, packageDir, manifest);
  if (isSameScopeSibling(root, manifest.name)) {
    return `same-scope sibling import is forbidden (portable packages reach no repo-internal package): ${specifier}`;
  }
  if (ALL_NODE_BUILTINS.has(root)) {
    return `node built-in must use the node: prefix: ${specifier}`;
  }
  const versionSpec = manifest.dependencies[root];
  if (versionSpec === undefined) {
    return `bare import is not a declared dependency of ${manifest.name}: ${specifier}`;
  }
  const nonPortable = NON_PORTABLE_PROTOCOLS.find((proto) => versionSpec.startsWith(proto));
  if (nonPortable !== undefined) {
    return `dependency uses non-portable protocol '${nonPortable}': ${root}`;
  }
  if (!bareResolves(specifier, packageDir)) {
    return `declared dependency does not resolve: ${specifier}`;
  }
  return undefined;
}

function classifySpecifier(
  specifier: string,
  fileAbs: string,
  packageDir: string,
  manifest: PackageManifest,
): string | undefined {
  if (specifier.startsWith(".")) return classifyRelative(specifier, fileAbs, packageDir);
  if (specifier.startsWith(NODE_BUILTIN_PREFIX) || specifier.startsWith(BUN_BUILTIN_PREFIX)) {
    return classifyBuiltin(specifier);
  }
  return classifyBare(specifier, packageDir, manifest);
}

export interface BoundaryOptions {
  /**
   * Package-relative `.ts` files to skip. Every entry must be a member of
   * {@link ALLOWED_IGNORE_PATHS}; any other path is refused with a throw, so the
   * exception set cannot be widened from a call site to hide engine/test files.
   */
  readonly ignorePaths?: readonly string[];
}

export function checkPackageBoundary(
  packageDir: string,
  options: BoundaryOptions = {},
): BoundaryReport {
  const allowed = new Set(ALLOWED_IGNORE_PATHS);
  const requested = options.ignorePaths ?? [];
  for (const path of requested) {
    if (!allowed.has(path)) {
      throw new Error(
        `ignorePaths may only contain repo-runner integration files (${ALLOWED_IGNORE_PATHS.join(
          ", ",
        )}); refused: ${path}`,
      );
    }
  }
  const ignoreSet = new Set(requested);
  const manifest = readManifest(packageDir);
  const violations: BoundaryViolation[] = [];
  const computedDynamic: ComputedDynamicImport[] = [];
  const ignoredFiles: string[] = [];
  let scannedFiles = 0;
  for (const fileAbs of listTsFiles(packageDir)) {
    const rel = relative(packageDir, fileAbs);
    if (ignoreSet.has(rel)) {
      ignoredFiles.push(rel);
      continue;
    }
    scannedFiles += 1;
    const extracted = extractSpecifiers(fileAbs);
    for (const specifier of extracted.strings) {
      const reason = classifySpecifier(specifier, fileAbs, packageDir, manifest);
      if (reason !== undefined) violations.push({ file: rel, specifier, reason });
    }
    if (extracted.computedDynamic > 0) computedDynamic.push({ file: rel });
  }
  return { violations, computedDynamic, ignoredFiles, scannedFiles };
}
