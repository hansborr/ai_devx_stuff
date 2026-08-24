import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import { validateSeedImportClosure } from "./closure-walk.js";

const repoRoot = resolve(import.meta.dirname, "../..");
const tmpRepo = registerTempRootCleanup();

const mappedWorkspaceSources = {
  "@musi/server": "packages/server/src",
  "@musi/shared": "packages/shared/src",
} as const;

const deliberatelyUnmappedWorkspacePackages = {
  "@musi/client": "the browser application is not a source-closure dependency",
  "@musi/harness-diagnostics":
    "portable consumers declare this package external or map an exact source subpath",
  "@musi/lint-ratchet":
    "portable consumers declare this package external or map an exact source subpath",
} as const;

function packageJsonField(path: string, field: "name" | "workspaces"): unknown {
  const packageJson: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof packageJson !== "object" || packageJson === null || !(field in packageJson)) {
    throw new Error(`${path} has no ${field} field`);
  }
  return Reflect.get(packageJson, field);
}

function rootWorkspaces(): readonly string[] {
  const workspaces = packageJsonField(join(repoRoot, "package.json"), "workspaces");
  if (!Array.isArray(workspaces) || !workspaces.every((entry) => typeof entry === "string")) {
    throw new Error("root package.json workspaces must be a string array");
  }
  return workspaces;
}

function workspacePackageNames(): readonly string[] {
  const wildcardRoots = ["packages", "tools"];
  const packageJsonPaths = wildcardRoots.flatMap((directory) =>
    readdirSync(join(repoRoot, directory), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(repoRoot, directory, entry.name, "package.json")),
  );
  packageJsonPaths.push(join(repoRoot, "examples/lint-ratchet-demo/package.json"));
  return packageJsonPaths.map((path) => {
    const name = packageJsonField(path, "name");
    if (typeof name !== "string") throw new Error(`${path} name must be a string`);
    return name;
  });
}

function workspaceImportEntryFixtures(packageNames: readonly string[]): Record<string, string> {
  const fixtures: Record<string, string> = {};
  for (const packageName of packageNames) {
    fixtures[`entry-${packageName.slice("@musi/".length)}.ts`] = `import "${packageName}";\n`;
  }
  return fixtures;
}

describe("built-in @musi workspace import mappings", () => {
  it("creates an import entry for every classified package", () => {
    const root = tmpRepo.writeRepo(workspaceImportEntryFixtures(["@musi/future-package"]));

    expect(() =>
      validateSeedImportClosure({
        root,
        entry: "entry-future-package.ts",
        allowedRoots: ["."],
        allowedFiles: [],
      }),
    ).toThrow("unsupported repository-local package import @musi/future-package");
  });

  it("classifies every @musi workspace and preserves mapped source roots", () => {
    expect(rootWorkspaces()).toEqual(["packages/*", "tools/*", "examples/lint-ratchet-demo"]);

    const workspacePackages = workspacePackageNames()
      .filter((name) => name.startsWith("@musi/"))
      .sort();
    const classifiedPackages = [
      ...Object.keys(mappedWorkspaceSources),
      ...Object.keys(deliberatelyUnmappedWorkspacePackages),
    ].sort();
    expect(classifiedPackages).toEqual(workspacePackages);

    const root = tmpRepo.writeRepo({
      ...workspaceImportEntryFixtures(classifiedPackages),
      "packages/server/src/index.ts": "export {};\n",
      "packages/shared/src/index.ts": "export {};\n",
    });

    for (const [packageName, sourceRoot] of Object.entries(mappedWorkspaceSources)) {
      expect(
        validateSeedImportClosure({
          root,
          entry: `entry-${packageName.slice("@musi/".length)}.ts`,
          allowedRoots: ["."],
          allowedFiles: [],
        }).files,
      ).toContain(`${sourceRoot}/index.ts`);
    }

    for (const packageName of Object.keys(deliberatelyUnmappedWorkspacePackages)) {
      expect(() =>
        validateSeedImportClosure({
          root,
          entry: `entry-${packageName.slice("@musi/".length)}.ts`,
          allowedRoots: ["."],
          allowedFiles: [],
        }),
      ).toThrow(`unsupported repository-local package import ${packageName}`);
    }
  });
});
