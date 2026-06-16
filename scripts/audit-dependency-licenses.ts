import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, join, resolve } from "node:path";

interface PackageInfo {
  name: string;
  version: string;
  license: string;
  manifestPath: string;
}

interface DependencyRequest {
  fromManifestPath: string;
  dependencyName: string;
}

interface ProductionCollectionState {
  packagesByKey: Map<string, PackageInfo>;
  visitedManifests: Set<string>;
  queue: DependencyRequest[];
  workspaceByName: Map<string, RootPackage>;
}

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const STRONG_COPYLEFT_RE = /\b(?:AGPL|GPL|SSPL)\b/i;
const REVIEW_COPYLEFT_RE = /\b(?:LGPL|MPL|EPL|CDDL|CPL|OSL|RPL)\b/i;
const ALL_MODE = process.argv.includes("--all");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(filePath: string): Record<string, unknown> | null {
  const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  return isRecord(parsed) ? parsed : null;
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};

  const result: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue === "string") result[key] = rawValue;
  }
  return result;
}

function licenseValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const values = value.map(licenseValue).filter((entry): entry is string => entry !== null);
    return values.length > 0 ? values.join(" OR ") : null;
  }
  if (isRecord(value) && typeof value["type"] === "string") return value["type"];
  return null;
}

function licenseFromNearbyFile(packageDir: string): string | null {
  for (const filename of ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"]) {
    const licensePath = join(packageDir, filename);
    if (!existsSync(licensePath)) continue;

    const text = readFileSync(licensePath, "utf8").toLowerCase();
    if (text.includes("permission is hereby granted") && text.includes("mit license")) {
      return "MIT";
    }
    if (text.includes("apache license") && text.includes("version 2.0")) {
      return "Apache-2.0";
    }
    if (text.includes("bsd 3-clause")) {
      return "BSD-3-Clause";
    }
    if (text.includes("bsd 2-clause")) {
      return "BSD-2-Clause";
    }
    if (text.includes("isc license")) {
      return "ISC";
    }
  }

  return null;
}

interface RootPackage {
  name: string | null;
  manifestPath: string;
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
}

function readRootPackage(manifestPath: string): RootPackage | null {
  const pkg = readJson(manifestPath);
  if (!pkg) return null;

  return {
    name: typeof pkg["name"] === "string" ? pkg["name"] : null,
    manifestPath,
    dependencies: stringRecord(pkg["dependencies"]),
    optionalDependencies: stringRecord(pkg["optionalDependencies"]),
    peerDependencies: stringRecord(pkg["peerDependencies"]),
  };
}

function readPackageInfo(manifestPath: string): PackageInfo | null {
  const pkg = readJson(manifestPath);
  if (!pkg) return null;

  const name = typeof pkg["name"] === "string" ? pkg["name"] : null;
  const version = typeof pkg["version"] === "string" ? pkg["version"] : null;
  if (!name || !version || name.startsWith("@musi/")) return null;

  return {
    name,
    version,
    license:
      licenseValue(pkg["license"]) ??
      licenseValue(pkg["licenses"]) ??
      licenseFromNearbyFile(resolve(manifestPath, "..")) ??
      "UNKNOWN",
    manifestPath,
  };
}

function dependencyNames(pkg: RootPackage): string[] {
  return [
    ...Object.keys(pkg.dependencies),
    ...Object.keys(pkg.optionalDependencies),
    ...Object.keys(pkg.peerDependencies),
  ].sort();
}

function packageManifestPath(packageDir: string): string | null {
  const manifestPath = join(packageDir, "package.json");
  return existsSync(manifestPath) ? manifestPath : null;
}

function resolveDependencyManifest(
  fromManifestPath: string,
  dependencyName: string,
): string | null {
  let currentDir: string | null = resolve(fromManifestPath, "..");

  while (currentDir !== null) {
    const candidate = join(currentDir, "node_modules", dependencyName, "package.json");
    if (existsSync(candidate)) return realpathSync(candidate);

    const parentDir = resolve(currentDir, "..");
    currentDir = parentDir === currentDir ? null : parentDir;
  }

  return null;
}

function collectPackagesFromNodeModules(
  nodeModulesDir: string,
  packagesByKey: Map<string, PackageInfo>,
): string[] {
  const packageDirs: string[] = [];

  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".bin") continue;
    const entryPath = join(nodeModulesDir, entry.name);

    if (entry.name.startsWith("@")) {
      for (const scopedEntry of readdirSync(entryPath, { withFileTypes: true })) {
        if (!scopedEntry.isDirectory()) continue;
        packageDirs.push(join(entryPath, scopedEntry.name));
      }
      continue;
    }

    packageDirs.push(entryPath);
  }

  for (const packageDir of packageDirs) {
    const manifestPath = packageManifestPath(packageDir);
    if (!manifestPath) continue;

    const info = readPackageInfo(manifestPath);
    if (!info) continue;
    packagesByKey.set(`${info.name}@${info.version}`, info);
  }

  return packageDirs;
}

function walkForNodeModules(
  dir: string,
  seenDirs: Set<string>,
  packagesByKey: Map<string, PackageInfo>,
): void {
  if (!existsSync(dir)) return;

  const realDir = realpathSync(dir);
  if (seenDirs.has(realDir)) return;
  seenDirs.add(realDir);

  const childDirs =
    basename(dir) === "node_modules" ? collectPackagesFromNodeModules(dir, packagesByKey) : [];

  const entries =
    childDirs.length > 0
      ? childDirs
      : readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => join(dir, entry.name));
  for (const entryPath of entries) {
    if (!existsSync(entryPath)) continue;
    const realEntry = realpathSync(entryPath);
    if (seenDirs.has(realEntry)) continue;
    if (basename(entryPath) === ".bin" || basename(entryPath) === ".cache") continue;
    walkForNodeModules(entryPath, seenDirs, packagesByKey);
  }
}

function workspaceNodeModules(): string[] {
  const packagesDir = join(PROJECT_ROOT, "packages");
  if (!existsSync(packagesDir)) return [];

  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesDir, entry.name, "node_modules"));
}

function workspacePackages(): RootPackage[] {
  const packagesDir = join(PROJECT_ROOT, "packages");
  if (!existsSync(packagesDir)) return [];

  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readRootPackage(join(packagesDir, entry.name, "package.json")))
    .filter((pkg): pkg is RootPackage => pkg !== null);
}

function collectInstalledPackages(): PackageInfo[] {
  const packagesByKey = new Map<string, PackageInfo>();
  const seenDirs = new Set<string>();
  const roots = [
    join(PROJECT_ROOT, "node_modules", ".bun"),
    join(PROJECT_ROOT, "node_modules"),
    ...workspaceNodeModules(),
  ];

  for (const root of roots) {
    walkForNodeModules(root, seenDirs, packagesByKey);
  }

  return [...packagesByKey.values()].sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
  );
}

function isNamedWorkspacePackage(pkg: RootPackage): pkg is RootPackage & { name: string } {
  return pkg.name !== null && pkg.name.startsWith("@musi/");
}

function buildWorkspaceMap(rootPackages: RootPackage[]): Map<string, RootPackage> {
  return new Map(rootPackages.filter(isNamedWorkspacePackage).map((pkg) => [pkg.name, pkg]));
}

function enqueueDependencies(queue: DependencyRequest[], pkg: RootPackage): void {
  for (const dependencyName of dependencyNames(pkg)) {
    queue.push({ fromManifestPath: pkg.manifestPath, dependencyName });
  }
}

function processDependencyRequest(
  state: ProductionCollectionState,
  request: DependencyRequest,
): void {
  const workspacePackage = state.workspaceByName.get(request.dependencyName);
  if (workspacePackage) {
    enqueueDependencies(state.queue, workspacePackage);
    return;
  }

  const manifestPath = resolveDependencyManifest(request.fromManifestPath, request.dependencyName);
  if (!manifestPath || state.visitedManifests.has(manifestPath)) return;
  state.visitedManifests.add(manifestPath);

  const info = readPackageInfo(manifestPath);
  const pkg = readRootPackage(manifestPath);
  if (!info || !pkg) return;

  state.packagesByKey.set(`${info.name}@${info.version}`, info);
  enqueueDependencies(state.queue, pkg);
}

function collectProductionPackages(): PackageInfo[] {
  const rootPackages = [
    readRootPackage(join(PROJECT_ROOT, "package.json")),
    ...workspacePackages(),
  ].filter((pkg): pkg is RootPackage => pkg !== null);
  const state: ProductionCollectionState = {
    packagesByKey: new Map<string, PackageInfo>(),
    visitedManifests: new Set<string>(),
    queue: [],
    workspaceByName: buildWorkspaceMap(rootPackages),
  };

  for (const pkg of rootPackages) enqueueDependencies(state.queue, pkg);

  while (state.queue.length > 0) {
    const next = state.queue.shift();
    if (!next) continue;
    processDependencyRequest(state, next);
  }

  return [...state.packagesByKey.values()].sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
  );
}

function summarizeLicenses(packages: PackageInfo[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const pkg of packages) {
    counts.set(pkg.license, (counts.get(pkg.license) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function printPackageList(title: string, packages: PackageInfo[]): void {
  if (packages.length === 0) {
    console.log(`${title}: none`);
    return;
  }

  console.log(`${title}:`);
  for (const pkg of packages) {
    console.log(`- ${pkg.name}@${pkg.version}: ${pkg.license}`);
  }
}

const packages = ALL_MODE ? collectInstalledPackages() : collectProductionPackages();
const strongCopyleft = packages.filter((pkg) => STRONG_COPYLEFT_RE.test(pkg.license));
const reviewCopyleft = packages.filter((pkg) => REVIEW_COPYLEFT_RE.test(pkg.license));
const unknown = packages.filter((pkg) => pkg.license === "UNKNOWN" || pkg.license === "UNLICENSED");

console.log("Dependency license audit");
console.log(`Mode: ${ALL_MODE ? "all installed packages" : "production dependency closure"}`);
console.log(`Packages audited: ${String(packages.length)}`);
console.log("");
console.log("License summary:");
for (const [license, count] of summarizeLicenses(packages)) {
  console.log(`- ${license}: ${String(count)}`);
}
console.log("");
printPackageList("Strong copyleft licenses", strongCopyleft);
printPackageList("Copyleft-review licenses", reviewCopyleft);
printPackageList("Unknown or unlicensed package metadata", unknown);

if (strongCopyleft.length > 0 || reviewCopyleft.length > 0) {
  process.exitCode = 1;
}
