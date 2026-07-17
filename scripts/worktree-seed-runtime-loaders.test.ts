import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { runtimeImportSpecifiers } from "./worktree-seed-runtime-loaders.js";

const parse = (source: string): ts.SourceFile =>
  ts.createSourceFile("seed-loader-fixture.ts", source, ts.ScriptTarget.Latest, true);

const analyze = (source: string): readonly string[] => runtimeImportSpecifiers(parse(source));

const unsupportedLoaderMessage = /unsupported runtime loader usage.*supported form.*manifest/i;

describe("runtimeImportSpecifiers", () => {
  it.each([
    ["direct require", 'require("./direct.js");', ["./direct.js"]],
    ["simple require alias", 'const load = require;\nload("./alias.js");', ["./alias.js"]],
    ["direct module.require", 'module.require("./module.js");', ["./module.js"]],
    [
      "static createRequire import",
      'import { createRequire } from "node:module";\n' +
        'const load = createRequire(import.meta.url);\nload("./created.js");',
      ["node:module", "./created.js"],
    ],
    [
      "namespace createRequire import",
      'import * as nodeModule from "node:module";\n' +
        'const load = nodeModule.createRequire(import.meta.url);\nload("./namespace.js");',
      ["node:module", "./namespace.js"],
    ],
    [
      "simple createRequire alias",
      'import { createRequire } from "node:module";\n' +
        "const makeLoader = createRequire;\n" +
        'const load = makeLoader(import.meta.url);\nload("./factory-alias.js");',
      ["node:module", "./factory-alias.js"],
    ],
    [
      "TypeScript import-equals createRequire",
      'import nodeModule = require("node:module");\n' +
        'const load = nodeModule.createRequire(import.meta.url);\nload("./import-equals.js");',
      ["node:module", "./import-equals.js"],
    ],
  ])("accepts the supported %s form", (_label, source, expected) => {
    expect(analyze(source)).toEqual(expected);
  });

  it.each([
    ["require.bind", 'const load = require.bind(null);\nload("./x.js");'],
    ["require.call", 'require.call(null, "./x.js");'],
    ["require.apply", 'require.apply(null, ["./x.js"]);'],
    [
      "createRequire.bind",
      'import { createRequire } from "node:module";\n' +
        'createRequire(import.meta.url).bind(null)("./x.js");',
    ],
    ["module.require.call", 'module.require.call(module, "./x.js");'],
    ["module.require.apply", 'module.require.apply(module, ["./x.js"]);'],
    ["parenthesized require", '(require)("./x.js");'],
    ["comma-wrapped require", '(0, require)("./x.js");'],
    ["logical-or wrapped require", '(require || fallback)("./x.js");'],
    ["nullish-coalesced require", '(require ?? fallback)("./x.js");'],
    ["passed require", "consume(require);"],
    ["returned require", "function loader() { return require; }"],
    ["re-exported createRequire", 'export { createRequire } from "node:module";'],
    [
      "namespace destructuring",
      'import * as nodeModule from "node:module";\n' + "const { createRequire } = nodeModule;",
    ],
    [
      "import-equals namespace destructuring",
      'import nodeModule = require("node:module");\n' + "const { createRequire } = nodeModule;",
    ],
    [
      "createRequire destructured from require(module)",
      'const { createRequire } = require("module");\n' +
        "const load = createRequire(import.meta.url);",
    ],
    [
      "createRequire destructured from import(node:module)",
      'const { createRequire } = await import("node:module");\n' +
        "const load = createRequire(import.meta.url);",
    ],
    ["inline exported require alias", "export const load = require;"],
    [
      "inline exported createRequire alias",
      'import { createRequire } from "node:module";\nexport const makeLoader = createRequire;',
    ],
    ["exported import-equals namespace", 'export import nodeModule = require("node:module");'],
    ["export-list loader alias", "const load = require;\nexport { load };"],
    ["default-exported loader alias", "const load = require;\nexport default load;"],
    ["export-assigned loader alias", "const load = require;\nexport = load;"],
  ])("rejects unsupported loader-source use: %s", (_label, source) => {
    expect(() => analyze(source)).toThrow(unsupportedLoaderMessage);
  });

  it.each([
    ["direct require", "const path = './x.js';\nrequire(path);"],
    ["aliased require", "const load = require;\nconst path = './x.js';\nload(path);"],
    [
      "createRequire loader",
      'import { createRequire } from "node:module";\n' +
        "const load = createRequire(import.meta.url);\nconst path = './x.js';\nload(path);",
    ],
  ])("rejects a non-static specifier for %s", (_label, source) => {
    expect(() => analyze(source)).toThrow(/must use a static string specifier/);
  });

  it.each([
    ["interface property", "interface Options { require: boolean }"],
    ["type query", "type Loader = typeof require;"],
    ["nested type query", "type Factory = { loader: typeof require };"],
    ["object property", "const options = { require: false };"],
    ["class property", "class Options { require = false; }"],
    ["parameter declaration", "function inspect(require: unknown) { return true; }"],
    ["binding-element declaration", "const { require } = options;"],
    ["renamed binding property", "const { require: localRequire } = options;"],
  ])("ignores an innocent %s", (_label, source) => {
    expect(analyze(source)).toEqual([]);
  });

  it("fails closed when a shadowed require binding is used", () => {
    expect(() =>
      analyze('function inspect(require: (path: string) => unknown) { require("./x.js"); }'),
    ).toThrow(unsupportedLoaderMessage);
  });

  it.each([
    ["interface", 'interface require {}\nrequire("./global.js");'],
    ["type-only import", 'import type { require } from "./types.js";\nrequire("./global.js");'],
  ])("does not treat a type-only %s as a value shadow", (_label, source) => {
    expect(analyze(source)).toEqual(["./global.js"]);
  });

  it("rejects an exported loader alias before it can escape across files", () => {
    const root = mkdtempSync(join(tmpdir(), "musi-seed-loader-export-"));
    try {
      writeFileSync(
        join(root, "entry.ts"),
        'import { load } from "./loader.js";\nload("./dependency.js");\n',
      );
      writeFileSync(join(root, "loader.ts"), "export const load = require;\n");
      writeFileSync(join(root, "dependency.ts"), "export const dependency = true;\n");
      const result = spawnSync(
        "bun",
        [
          join(import.meta.dirname, "worktree-seed-import-closure.ts"),
          "--root",
          root,
          "--entry",
          "entry.ts",
          "--allowed-root",
          ".",
        ],
        { encoding: "utf8" },
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(unsupportedLoaderMessage);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
