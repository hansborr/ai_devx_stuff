import { existsSync } from "node:fs";
import path from "node:path";

import { KNOWN_PACKAGE_BARRELS, type KnownPackageBarrel } from "./constants.js";
import { fail } from "./errors.js";
import type { BarrelContext } from "./types.js";

export function contextForPackage(root: string, packageSpecifier: string): BarrelContext {
  const known = KNOWN_PACKAGE_BARRELS.find((candidate) => {
    return candidate.packageSpecifier === packageSpecifier;
  });
  if (!known) fail(`Unsupported package barrel: ${packageSpecifier}.`);
  const barrelPath = path.resolve(root, known.barrelRelativePath);
  if (!existsSync(barrelPath)) fail(`${known.barrelRelativePath} does not exist.`);
  return {
    barrelPath,
    relativeBarrelPath: known.barrelRelativePath,
    packageSpecifier,
  };
}

export function contextForKnown(root: string, known: KnownPackageBarrel): BarrelContext {
  const barrelPath = path.resolve(root, known.barrelRelativePath);
  return {
    barrelPath,
    relativeBarrelPath: known.barrelRelativePath,
    packageSpecifier: known.packageSpecifier,
  };
}

function knownPackageForBarrel(root: string, barrelPath: string): KnownPackageBarrel | undefined {
  const normalized = path.resolve(barrelPath);
  return KNOWN_PACKAGE_BARRELS.find((candidate) => {
    return path.resolve(root, candidate.barrelRelativePath) === normalized;
  });
}

export function contextForBarrel(root: string, barrelArg: string): BarrelContext {
  const barrelPath = path.resolve(root, barrelArg);
  const relativeBarrelPath = path.relative(root, barrelPath);
  if (relativeBarrelPath.startsWith("..") || path.isAbsolute(relativeBarrelPath)) {
    fail("Barrel file must be inside the current repository.");
  }
  if (!/index\.tsx?$/u.test(relativeBarrelPath)) fail("--barrel must point at an index.ts file.");
  if (!existsSync(barrelPath)) fail(`${relativeBarrelPath} does not exist.`);
  const known = knownPackageForBarrel(root, barrelPath);
  return {
    barrelPath,
    relativeBarrelPath,
    packageSpecifier: known?.packageSpecifier,
  };
}
