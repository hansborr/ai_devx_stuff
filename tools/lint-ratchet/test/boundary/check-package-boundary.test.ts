import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkPackageBoundary } from "./check-package-boundary.js";

const PACKAGE_NAME = "@acme/widget";

let root = "";

function write(relPath: string, contents: string): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

// Provision a resolvable (but empty) dependency in the fixture's node_modules so
// the checker's real `require.resolve` succeeds — no "skip resolution" flag.
function writeFakeModule(name: string): void {
  const dir = join(root, "node_modules", ...name.split("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
  );
  writeFileSync(join(dir, "index.js"), "module.exports = {};\n");
}

function writeManifest(options: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports?: Record<string, string>;
}): void {
  write(
    "package.json",
    JSON.stringify({
      name: PACKAGE_NAME,
      dependencies: options.dependencies ?? {},
      devDependencies: options.devDependencies ?? {},
      exports: options.exports ?? {},
    }),
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "boundary-fixture-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("checkPackageBoundary — accepted categories", () => {
  it("accepts allowlisted builtins, resolving self-imports, deps, and in-package relatives", () => {
    writeManifest({
      dependencies: { typescript: "~5.9.3" },
      devDependencies: { vitest: "^4.1.7" },
      exports: { "./kernel/*.js": "./src/kernel/*.ts" },
    });
    writeFakeModule("typescript");
    writeFakeModule("vitest");
    write("src/kernel/thing.ts", `export const widget = 1;\n`);
    write("src/a.ts", `import { readFileSync } from "node:fs";\nexport const a = readFileSync;\n`);
    write(
      "src/b.ts",
      `import ts from "typescript";\nimport { test } from "bun:test";\nexport const b = [ts, test];\n`,
    );
    write(
      "src/c.ts",
      `import { a } from "./a.js";\nimport { widget } from "${PACKAGE_NAME}/kernel/thing.js";\nimport { describe } from "vitest";\nexport const c = [a, widget, describe];\n`,
    );
    const report = checkPackageBoundary(root);
    expect(report.violations).toEqual([]);
    expect(report.computedDynamic).toEqual([]);
    expect(report.ignoredFiles).toEqual([]);
    expect(report.scannedFiles).toBe(4);
  });

  it("accepts a self-import through an exact (non-wildcard) export key", () => {
    writeManifest({ exports: { "./kernel/thing.js": "./src/kernel/thing.ts" } });
    write("src/kernel/thing.ts", `export const widget = 1;\n`);
    write(
      "src/c.ts",
      `import { widget } from "${PACKAGE_NAME}/kernel/thing.js";\nexport const c = widget;\n`,
    );
    const report = checkPackageBoundary(root);
    expect(report.violations).toEqual([]);
    expect(report.scannedFiles).toBe(2);
  });
});

describe("checkPackageBoundary — rejections", () => {
  it("flags a relative import that escapes the package", () => {
    writeManifest({});
    write("src/leak.ts", `export { x } from "../../packages/shared/src/x.js";\n`);
    const report = checkPackageBoundary(root);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.file).toBe(join("src", "leak.ts"));
    expect(report.violations[0]?.reason).toContain("escapes the package");
  });

  it("flags a dangling relative import that resolves to no file", () => {
    writeManifest({});
    write("src/dangling.ts", `export { y } from "./missing.js";\n`);
    const report = checkPackageBoundary(root);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.reason).toContain("does not resolve to a file");
  });

  it("flags a self-import subpath that has no exports target on disk", () => {
    writeManifest({ exports: { "./kernel/*.js": "./src/kernel/*.ts" } });
    write("src/self.ts", `export { z } from "${PACKAGE_NAME}/kernel/nope.js";\n`);
    const report = checkPackageBoundary(root);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.reason).toContain(
      "does not resolve through the package exports map",
    );
  });

  it("flags a self-import of a subpath absent from an exact exports map", () => {
    writeManifest({ exports: { "./kernel/thing.js": "./src/kernel/thing.ts" } });
    write("src/kernel/thing.ts", `export const widget = 1;\n`);
    write("src/kernel/private.ts", `export const hidden = 1;\n`);
    write("src/self.ts", `export { hidden } from "${PACKAGE_NAME}/kernel/private.js";\n`);
    const report = checkPackageBoundary(root);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.reason).toContain(
      "does not resolve through the package exports map",
    );
  });

  it("flags an undeclared bare import", () => {
    writeManifest({ dependencies: { typescript: "~5.9.3" } });
    write("src/x.ts", `import react from "react";\nexport const x = react;\n`);
    const report = checkPackageBoundary(root);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.reason).toContain("not a declared dependency");
  });

  it("flags a same-scope sibling import even when it is declared", () => {
    writeManifest({ dependencies: { "@acme/shared": "1.0.0" } });
    writeFakeModule("@acme/shared");
    write("src/y.ts", `import { z } from "@acme/shared/schemas/z.js";\nexport const y = z;\n`);
    const report = checkPackageBoundary(root);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.reason).toContain("same-scope sibling import is forbidden");
  });

  it("flags a declared dependency whose subpath does not resolve", () => {
    writeManifest({ dependencies: { typescript: "~5.9.3" } });
    writeFakeModule("typescript");
    write("src/x.ts", `import { z } from "typescript/nonexistent.js";\nexport const x = z;\n`);
    const report = checkPackageBoundary(root);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.reason).toContain("declared dependency does not resolve");
  });

  it("flags a self-import whose exports target escapes the package directory", () => {
    const pkg = join(root, "pkg");
    mkdirSync(join(root, "outside"), { recursive: true });
    writeFileSync(join(root, "outside", "leak.ts"), "export const leak = 1;\n");
    mkdirSync(join(pkg, "src"), { recursive: true });
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({ name: PACKAGE_NAME, exports: { "./evil/*.js": "../outside/*.ts" } }),
    );
    writeFileSync(
      join(pkg, "src", "self.ts"),
      `export { leak } from "${PACKAGE_NAME}/evil/leak.js";\n`,
    );
    const report = checkPackageBoundary(pkg);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.reason).toContain("exports target escapes the package");
  });

  it("flags an unprefixed legacy node built-in", () => {
    writeManifest({});
    write("src/legacy.ts", `import { readFileSync } from "fs";\nexport const r = readFileSync;\n`);
    const report = checkPackageBoundary(root);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.reason).toContain("must use the node: prefix");
  });

  it("flags an unknown node: and unknown bun: built-in", () => {
    writeManifest({});
    write("src/n.ts", `import "node:worker_threads";\n`);
    write("src/u.ts", `import "bun:magic";\n`);
    const report = checkPackageBoundary(root);
    const reasons = report.violations.map((violation) => violation.reason).sort();
    expect(reasons).toEqual([
      "bun: built-in not on the engine allowlist: bun:magic",
      "node: built-in not on the engine allowlist: node:worker_threads",
    ]);
  });

  it("flags a declared dependency that uses a non-portable protocol", () => {
    writeManifest({ dependencies: { "@vendor/kernel": "workspace:*" } });
    write("src/w.ts", `import { k } from "@vendor/kernel";\nexport const w = k;\n`);
    const report = checkPackageBoundary(root);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.reason).toContain("non-portable protocol 'workspace:'");
  });

  it("flags a declared dependency that uses the local: protocol", () => {
    writeManifest({ dependencies: { "@vendor/kernel": "local:../kernel" } });
    write("src/w.ts", `import { k } from "@vendor/kernel";\nexport const w = k;\n`);
    const report = checkPackageBoundary(root);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.reason).toContain("non-portable protocol 'local:'");
  });
});

describe("checkPackageBoundary — dynamic imports and pruning", () => {
  it("classifies string-literal dynamic imports and records computed ones", () => {
    writeManifest({});
    write(
      "src/dyn.ts",
      `export async function load(name: string): Promise<unknown> {\n  const outside = await import("../../elsewhere/mod.js");\n  const dynamic = await import(name);\n  return [outside, dynamic];\n}\n`,
    );
    const report = checkPackageBoundary(root);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.specifier).toBe("../../elsewhere/mod.js");
    expect(report.computedDynamic).toEqual([{ file: join("src", "dyn.ts") }]);
  });

  it("skips node_modules and dist directories", () => {
    writeManifest({});
    write("dist/built.ts", `export { bad } from "../../outside.js";\n`);
    write("node_modules/dep/index.ts", `export { worse } from "../../outside.js";\n`);
    write("src/ok.ts", `export const ok = 1;\n`);
    const report = checkPackageBoundary(root);
    expect(report.violations).toEqual([]);
    expect(report.scannedFiles).toBe(1);
  });
});

describe("checkPackageBoundary — sealed ignore mechanism", () => {
  it("refuses a caller-supplied ignore path outside the allowed set", () => {
    writeManifest({});
    write("src/ok.ts", `export const ok = 1;\n`);
    expect(() =>
      checkPackageBoundary(root, { ignorePaths: ["src/kernel/engine-context.ts"] }),
    ).toThrow(/may only contain repo-runner integration files/u);
  });
});
