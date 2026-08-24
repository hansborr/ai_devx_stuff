import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ALLOWED_IGNORE_PATHS, checkPackageBoundary } from "./boundary/check-package-boundary.js";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The sealed exception set (repo test-runner integration only — the package's
// Vitest project config imports shared worker-coordination constants from the
// root `vitest.config.ts`, like `packages/shared/vitest.config.ts` and
// `scripts/vitest.config.ts`). The checker refuses any wider list, and the
// tests below pin it so `src/`/`test/` can never be excluded.
const REPO_INTEGRATION_IGNORES = { ignorePaths: ALLOWED_IGNORE_PATHS } as const;

function isUnderEngineOrTests(relPath: string): boolean {
  return (
    relPath === "src" ||
    relPath === "test" ||
    relPath.startsWith(`src${sep}`) ||
    relPath.startsWith(`test${sep}`)
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every((entry) => typeof entry === "string");
}

interface PackageExports {
  readonly packageName: string;
  readonly exportsMap: Record<string, string>;
}

function readPackageManifest(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("package.json must contain an object");
  }
  return parsed as Record<string, unknown>; // type-assertion-boundary: json - guarded JSON object
}

function readPackageExports(): PackageExports {
  const parsed: unknown = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const packageName =
    typeof parsed === "object" && parsed !== null && "name" in parsed ? parsed.name : undefined;
  const exportsField =
    typeof parsed === "object" && parsed !== null && "exports" in parsed
      ? parsed.exports
      : undefined;
  if (typeof packageName !== "string" || !isStringRecord(exportsField)) {
    throw new Error("package.json must declare a string name and a string-valued exports map");
  }
  return { packageName, exportsMap: exportsField };
}

/** Every non-test `.ts` module under `src/`, as a `./<layer>/<stem>.js` subpath. */
function sourceModuleSubpaths(): string[] {
  const srcDir = join(packageDir, "src");
  const subpaths: string[] = [];
  for (const entry of readdirSync(srcDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    const relDir = entry.parentPath
      .slice(srcDir.length + 1)
      .split(sep)
      .join("/");
    const stem = entry.name.slice(0, -".ts".length);
    subpaths.push(relDir === "" ? `./${stem}.js` : `./${relDir}/${stem}.js`);
  }
  return subpaths;
}

describe("package boundary", () => {
  it("has no imports that reach outside the package", () => {
    const report = checkPackageBoundary(packageDir, REPO_INTEGRATION_IGNORES);
    expect(report.scannedFiles).toBeGreaterThan(0);
    expect(report.violations).toEqual([]);
  });

  it("keeps the engine surface free of computed imports except the explicit adapter loader", () => {
    const report = checkPackageBoundary(packageDir, REPO_INTEGRATION_IGNORES);
    const inSrc = report.computedDynamic.filter((entry) => isUnderEngineOrTests(entry.file));
    // Engine + tests must be statically analyzable; test/ may carry computed
    // dynamics (the resolution proof below), but src/ may not.
    const inEngine = inSrc.filter(
      (entry) => entry.file === "src" || entry.file.startsWith(`src${sep}`),
    );
    expect(inEngine).toEqual([{ file: `src${sep}git-rail${sep}executable-cli.ts` }]);
  });
});

describe("git-rail executable contract", () => {
  it("publishes one explicit binary for every supported git-rail operation", () => {
    expect(readPackageManifest().bin).toEqual({
      "lint-ratchet-git-rail": "./bin/lint-ratchet-git-rail.ts",
    });
    expect(statSync(join(packageDir, "bin/lint-ratchet-git-rail.ts")).mode & 0o111).not.toBe(0);
  });

  it("executes the documented binary entrypoint", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "lint-ratchet-bin-"));
    try {
      expect(spawnSync("git", ["init", "-q"], { cwd: repoRoot }).status).toBe(0);
      const result = spawnSync(
        join(packageDir, "bin/lint-ratchet-git-rail.ts"),
        ["check", "--adapter", "missing-adapter.ts"],
        { cwd: repoRoot, encoding: "utf8" },
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("WARN: lint-ratchet merge driver is missing or stale");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

describe("sealed ignore mechanism", () => {
  it("pins the exception set to exactly the repo runner config", () => {
    expect([...ALLOWED_IGNORE_PATHS]).toEqual(["vitest.config.ts"]);
  });

  it("never lets the exception set exclude an engine or test file", () => {
    expect(ALLOWED_IGNORE_PATHS.filter(isUnderEngineOrTests)).toEqual([]);
  });

  it("reports exactly the ignored runner config and scans everything else", () => {
    const report = checkPackageBoundary(packageDir, REPO_INTEGRATION_IGNORES);
    expect([...report.ignoredFiles]).toEqual(["vitest.config.ts"]);
    expect(report.scannedFiles).toBeGreaterThan(0);
  });
});

// The enumerated exports contract (lint-arch-review leaf 14): the exports map
// is the reviewed inventory of supported entry points — exact keys only, each
// mirroring one `src/` module. Wildcards made every file API; they are gone,
// and this suite fails if one returns, if a key stops mirroring its target,
// or if the private majority of `src/` becomes importable again.
describe("enumerated exports contract", () => {
  const SUBPATH_KEY_PATTERN = /^\.\/(?:kernel|git-rail|governance)\/[a-z0-9-]+\.js$/u;

  it("declares exact keys only — no wildcard entries", () => {
    const { exportsMap } = readPackageExports();
    expect(Object.keys(exportsMap).length).toBeGreaterThan(0);
    for (const [key, target] of Object.entries(exportsMap)) {
      expect(key).not.toContain("*");
      expect(target).not.toContain("*");
    }
  });

  it("keys are layer subpaths whose targets mirror them into src/", () => {
    const { exportsMap } = readPackageExports();
    const sourceSet = new Set(sourceModuleSubpaths());
    for (const [key, target] of Object.entries(exportsMap)) {
      expect(key).toMatch(SUBPATH_KEY_PATTERN);
      expect(target).toBe(`./src${key.slice(1).replace(/\.js$/u, ".ts")}`);
      expect(sourceSet.has(key)).toBe(true);
    }
  });

  it("resolves and imports every enumerated entry", async () => {
    const { packageName, exportsMap } = readPackageExports();
    const keys = Object.keys(exportsMap);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const specifier = `${packageName}${key.slice(1)}`;
      // Resolution is the proof: the subpath export key must resolve to a real
      // module. A type-only kernel source (e.g. config-types.ts) resolves to an
      // empty runtime namespace, which is still a successful resolution — so
      // assert it imports as an object, not that it has runtime exports.
      const module: unknown = await import(specifier);
      expect(module).toBeTypeOf("object");
    }
  });

  it("keeps every private src module unimportable through the package name", async () => {
    const { packageName, exportsMap } = readPackageExports();
    const exported = new Set(Object.keys(exportsMap));
    const privateSubpaths = sourceModuleSubpaths().filter((subpath) => !exported.has(subpath));
    // The enumerated set is a deliberately smaller inventory than the tree:
    // most of src/ is private. If this drops to zero the exports map has
    // regressed to exporting everything and the contract review is void.
    expect(privateSubpaths.length).toBeGreaterThan(0);
    for (const subpath of privateSubpaths) {
      const specifier = `${packageName}${subpath.slice(1)}`;
      // The rejection must be an exports denial — the resolver refusing a
      // subpath the exports map does not declare — not some incidental
      // failure. Under this suite's runtime (vitest/vite module runner) that
      // surfaces as a plain Error whose message reads
      //   "./<layer>/<stem>.js" is not exported under the conditions [...]
      // (Node's ERR_PACKAGE_PATH_NOT_EXPORTED never appears here), so pin
      // the subpath-specific denial text via substring match.
      await expect(import(specifier), specifier).rejects.toThrow(
        `"${subpath}" is not exported under the conditions`,
      );
    }
  });
});
