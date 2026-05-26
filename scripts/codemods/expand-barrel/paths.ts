import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import type { SourceFile } from "ts-morph";

import { contextForKnown } from "./barrel-context.js";
import {
  KNOWN_PACKAGE_BARRELS,
  PACKAGES_ROOT,
  SHARED_SRC_ROOT,
} from "./constants.js";
import { fail } from "./errors.js";
import type { BarrelContext } from "./types.js";

export function toPosix(filePath: string): string {
  return filePath.split(path.sep).join(path.posix.sep);
}

export function replaceTsExtensionWithJs(filePath: string): string {
  return filePath.replace(/\.tsx?$/u, ".js");
}

function sourcePathCandidates(resolvedModulePath: string): string[] {
  const extension = path.extname(resolvedModulePath);
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    const withoutExtension = resolvedModulePath.slice(0, -extension.length);
    return [`${withoutExtension}.ts`, `${withoutExtension}.tsx`];
  }
  if (extension === ".ts" || extension === ".tsx") return [resolvedModulePath];
  return [
    `${resolvedModulePath}.ts`,
    `${resolvedModulePath}.tsx`,
    path.join(resolvedModulePath, "index.ts"),
    path.join(resolvedModulePath, "index.tsx"),
  ];
}

export function resolveRelativeModulePath(
  fromFile: string,
  specifier: string,
): string | undefined {
  const resolvedModulePath = path.resolve(path.dirname(fromFile), specifier);
  return sourcePathCandidates(resolvedModulePath).find((candidate) => existsSync(candidate));
}

export function resolveExportModulePath(sourceFile: SourceFile, specifier: string): string {
  const resolved = resolveRelativeModulePath(sourceFile.getFilePath(), specifier);
  if (!resolved) {
    fail(
      `Could not resolve ${specifier} from ${path.relative(process.cwd(), sourceFile.getFilePath())}.`,
    );
  }
  return resolved;
}

export function discoverPackageFiles(root: string): string[] {
  const packageRoot = path.join(root, PACKAGES_ROOT);
  if (!existsSync(packageRoot)) return [];
  const files: string[] = [];
  const skippedDirectories = new Set(["dist", "generated", "node_modules"]);

  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const currentPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name)) visit(currentPath);
        continue;
      }
      if (!statSync(currentPath).isFile()) continue;
      if (currentPath.endsWith(".d.ts")) continue;
      if (!/\.tsx?$/u.test(currentPath)) continue;
      files.push(currentPath);
    }
  };

  visit(packageRoot);
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

export function specifierMatchesContext(
  context: BarrelContext,
  consumerPath: string,
  specifier: string,
): boolean {
  if (context.packageSpecifier && specifier === context.packageSpecifier) return true;
  if (!specifier.startsWith(".")) return false;
  const resolved = resolveRelativeModulePath(consumerPath, specifier);
  return resolved === context.barrelPath;
}

export function specifierMatchesKnownBarrel(
  consumerPath: string,
  specifier: string,
  root: string,
): boolean {
  return KNOWN_PACKAGE_BARRELS.some((known) => {
    return specifierMatchesContext(contextForKnown(root, known), consumerPath, specifier);
  });
}

function packageOutputSpecifier(context: BarrelContext, sourcePath: string, root: string): string {
  if (!context.packageSpecifier) fail("Internal error: missing package specifier.");
  const barrelDir = path.dirname(context.barrelPath);
  const relativeToBarrel = path.relative(barrelDir, sourcePath);
  if (!relativeToBarrel.startsWith("..") && !path.isAbsolute(relativeToBarrel)) {
    const source = toPosix(replaceTsExtensionWithJs(relativeToBarrel));
    return `${context.packageSpecifier}/${source}`;
  }

  const sharedRelativePath = path.relative(path.join(root, SHARED_SRC_ROOT), sourcePath);
  if (sharedRelativePath === "constants.ts") return "@musi/shared/constants";

  fail(
    `${path.relative(root, sourcePath)} resolves outside ${context.packageSpecifier}; add a package export or rewrite manually.`,
  );
}

function relativeOutputSpecifier(consumerPath: string, sourcePath: string): string {
  const relative = replaceTsExtensionWithJs(path.relative(path.dirname(consumerPath), sourcePath));
  const posix = toPosix(relative);
  return posix.startsWith(".") ? posix : `./${posix}`;
}

export function outputSpecifier(
  context: BarrelContext,
  consumerPath: string,
  sourcePath: string,
  root: string,
  originalSpecifier: string,
): string {
  if (!originalSpecifier.startsWith(".") && context.packageSpecifier) {
    return packageOutputSpecifier(context, sourcePath, root);
  }
  return relativeOutputSpecifier(consumerPath, sourcePath);
}
