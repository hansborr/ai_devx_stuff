import { readdirSync, readFileSync } from "node:fs";
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

interface WildcardExport {
  readonly specifierPrefix: string;
  readonly specifierSuffix: string;
  readonly sourceDir: string;
  readonly sourceSuffix: string;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every((entry) => typeof entry === "string");
}

function readWildcardExports(): WildcardExport[] {
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
  const wildcards: WildcardExport[] = [];
  for (const [key, target] of Object.entries(exportsField)) {
    if (!key.includes("*") || !target.includes("*")) continue;
    const [keyBefore = "", keyAfter = ""] = key.split("*");
    const [targetBefore = "", targetAfter = ""] = target.split("*");
    wildcards.push({
      specifierPrefix: `${packageName}${keyBefore.replace(/^\./u, "")}`,
      specifierSuffix: keyAfter,
      sourceDir: join(packageDir, targetBefore),
      sourceSuffix: targetAfter,
    });
  }
  return wildcards;
}

function exportedSpecifiers(wildcard: WildcardExport): string[] {
  const files = readdirSync(wildcard.sourceDir, { withFileTypes: true });
  const specifiers: string[] = [];
  for (const file of files) {
    if (!file.isFile()) continue;
    if (!file.name.endsWith(wildcard.sourceSuffix)) continue;
    if (file.name.endsWith(".test.ts")) continue;
    const stem = file.name.slice(0, file.name.length - wildcard.sourceSuffix.length);
    specifiers.push(`${wildcard.specifierPrefix}${stem}${wildcard.specifierSuffix}`);
  }
  return specifiers;
}

describe("package boundary", () => {
  it("has no imports that reach outside the package", () => {
    const report = checkPackageBoundary(packageDir, REPO_INTEGRATION_IGNORES);
    expect(report.scannedFiles).toBeGreaterThan(0);
    expect(report.violations).toEqual([]);
  });

  it("keeps the engine surface (src/) free of computed dynamic imports", () => {
    const report = checkPackageBoundary(packageDir, REPO_INTEGRATION_IGNORES);
    const inSrc = report.computedDynamic.filter((entry) => isUnderEngineOrTests(entry.file));
    // Engine + tests must be statically analyzable; test/ may carry computed
    // dynamics (the resolution proof below), but src/ may not.
    const inEngine = inSrc.filter(
      (entry) => entry.file === "src" || entry.file.startsWith(`src${sep}`),
    );
    expect(inEngine).toEqual([]);
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

describe("exports resolution", () => {
  it("resolves every exported source file through its subpath export key", async () => {
    const wildcards = readWildcardExports();
    expect(wildcards.length).toBeGreaterThan(0);
    let resolvedCount = 0;
    for (const wildcard of wildcards) {
      for (const specifier of exportedSpecifiers(wildcard)) {
        // Resolution is the proof: the subpath export key must resolve to a real
        // module. A type-only kernel source (e.g. config-types.ts) resolves to an
        // empty runtime namespace, which is still a successful resolution — so
        // assert it imports as an object, not that it has runtime exports.
        const module: unknown = await import(specifier);
        expect(module).toBeTypeOf("object");
        resolvedCount += 1;
      }
    }
    expect(resolvedCount).toBeGreaterThan(0);
  });
});
