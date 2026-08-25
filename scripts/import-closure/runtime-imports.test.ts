import ts from "typescript";
import { describe, expect, it } from "vitest";

import { analyzeRuntimeSource } from "./runtime-imports.js";

const parse = (source: string, fileName = "seed-source-fixture.ts"): ts.SourceFile =>
  ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);

const specifiersOf = (
  source: string,
  fileName?: string,
  nonStaticSpecifiers: "throw" | "skip" = "throw",
): readonly string[] => analyzeRuntimeSource(parse(source, fileName), { nonStaticSpecifiers });

const checkEnvironment = (
  source: string,
  allowedEnvironmentVariables: readonly string[] = ["DATABASE_URL"],
): void => {
  analyzeRuntimeSource(parse(source), { allowedEnvironmentVariables });
};

const commonJsMessage = /CommonJS runtime loading is not supported.*static ESM import/is;
const coarsePolicyMessage = /deliberately coarse/i;

describe("analyzeRuntimeSource imports", () => {
  it("collects value-space static imports, exports, and dynamic imports", () => {
    expect(
      specifiersOf(
        'import type { TypeOnly } from "./types.js";\n' +
          'import value from "./value.js";\n' +
          'export type { TypeOnly } from "./other-types.js";\n' +
          'export { runtimeValue } from "./runtime.js";\n' +
          'await import("./dynamic.js");\nvoid value;',
      ),
    ).toEqual(["./value.js", "./runtime.js", "./dynamic.js"]);
  });

  it("requires a static dynamic-import specifier unless the consumer explicitly skips it", () => {
    const source = 'const target = "./runtime.js";\nawait import(target);';
    expect(() => specifiersOf(source)).toThrow(/must use a static string specifier/u);
    expect(specifiersOf(source, undefined, "skip")).toEqual([]);
  });

  it("accepts the one import attribute the tree uses", () => {
    expect(
      specifiersOf('import data from "./taxonomy.json" with { type: "json" };\nvoid data;'),
    ).toEqual(["./taxonomy.json"]);
  });

  it.each([
    ["a non-literal attribute value", 'import "./x.json" with { type: loaderName };'],
    ["duplicate type attributes", 'import "./x.json" with { type: "json", type: "json" };'],
    ["an unmodelled Bun loader", 'import "./x.txt" with { type: "text" };'],
    ["a non-type attribute", 'import "./x.json" with { assert: "json" };'],
    ["the legacy assert keyword", 'import "./x.json" assert { type: "json" };'],
    ["a JSON type on a source specifier", 'import "./x.ts" with { type: "json" };'],
  ])("fails closed on %s instead of modelling Bun's loaders", (_label, source) => {
    expect(() => specifiersOf(source)).toThrow(/only supported import attribute/i);
  });

  it("rejects dynamic-import attributes rather than reconstructing the options object", () => {
    expect(() =>
      specifiersOf('await import("./taxonomy.json", { with: { type: "json" } });'),
    ).toThrow(/exactly one static specifier/i);
  });
});

describe("analyzeRuntimeSource CommonJS policy", () => {
  it.each([
    ["a direct call", 'require("./runtime.js");'],
    ["a value alias", "const load = require;\nvoid load;"],
    ["a module method", "const load = module.require;\nvoid load;"],
    ["a createRequire import", 'import { createRequire } from "node:module";\nvoid createRequire;'],
    [
      "an aliased createRequire import",
      'import { createRequire as make } from "node:module";\nvoid make;',
    ],
    [
      "a node:module namespace import",
      'import * as nodeModule from "node:module";\nvoid nodeModule;',
    ],
    ["a node:module value re-export", 'export { isBuiltin } from "node:module";'],
    ["a dynamic node:module import", 'void import("node:module");'],
    ["an import-equals declaration", 'import fs = require("node:fs");\nvoid fs;'],
    ["an import.meta loader", 'void import.meta.require("./runtime.js");'],
  ])("rejects %s", (_label, source) => {
    expect(() => specifiersOf(source)).toThrow(commonJsMessage);
  });

  it.each(["fixture.cjs", "fixture.cts"])("rejects the CommonJS file extension %s", (fileName) => {
    expect(() => specifiersOf("export {};", fileName)).toThrow(commonJsMessage);
  });

  it.each(["./dependency.cjs", "./dependency.cts"])(
    "rejects the CommonJS specifier %s before resolving it",
    (specifier) => {
      expect(() => specifiersOf(`import "${specifier}";`)).toThrow(commonJsMessage);
    },
  );

  /**
   * The policy is a token scan, not a scope analysis: an innocent local binding
   * named `require` is rejected too. That false positive is the deliberate
   * trade — first-party seed code renames the binding.
   */
  it("rejects an innocent binding that merely reuses a CommonJS name", () => {
    expect(() => specifiersOf("const options = { require: false };\nvoid options;")).toThrow(
      commonJsMessage,
    );
  });

  it("accepts a type-only node:module import because it cannot load anything", () => {
    expect(specifiersOf('import type { Module } from "node:module";\nvoid 0;')).toEqual([]);
  });
});

/**
 * Copy sets differ from fingerprints: a fingerprint only has to name what
 * executes, while a copied checkout has to compile. Consumers deriving one opt
 * into the type edges the runtime walk drops.
 */
describe("analyzeRuntimeSource type-only edges", () => {
  const typeAwareSpecifiersOf = (
    source: string,
    nonStaticSpecifiers: "throw" | "skip" = "throw",
  ): readonly string[] =>
    analyzeRuntimeSource(parse(source), { nonStaticSpecifiers, typeOnlyImports: "include" });

  it("collects type-only imports and re-exports alongside the runtime edges", () => {
    const source =
      'import type { TypeOnly } from "./types.js";\n' +
      'import { type Mixed, mixedValue } from "./mixed.js";\n' +
      'export type { Reexported } from "./other-types.js";\n' +
      'import value from "./value.js";\n' +
      "void mixedValue;\nvoid value;\nexport type { TypeOnly, Mixed };";

    expect(specifiersOf(source)).toEqual(["./mixed.js", "./value.js"]);
    expect(typeAwareSpecifiersOf(source)).toEqual([
      "./types.js",
      "./mixed.js",
      "./other-types.js",
      "./value.js",
    ]);
  });

  it("follows an import-type node the runtime walk never sees", () => {
    const source = 'export type Shape = import("./deep-types.js").Shape;';

    expect(specifiersOf(source)).toEqual([]);
    expect(typeAwareSpecifiersOf(source)).toEqual(["./deep-types.js"]);
  });

  /**
   * Both shapes are a module edge the closure cannot follow, so both take the
   * caller's non-static policy rather than one throwing and the other vanishing.
   */
  it.each([
    ["an interpolated specifier", "export type Shape = import(`./${name}.js`).Shape;"],
    ["a non-string literal specifier", "export type Shape = import(0).Shape;"],
  ])("fails closed on an import-type node with %s", (_case, source) => {
    expect(() => typeAwareSpecifiersOf(source)).toThrow(/static string specifier/u);
    expect(typeAwareSpecifiersOf(source, "skip")).toEqual([]);
  });

  /**
   * The CommonJS value-space policy is about loading, and a type edge loads
   * nothing, so `node:module` stays legal in type space under both modes and is
   * merely recorded here.
   */
  it("records a type-only CommonJS-module import instead of rejecting it", () => {
    expect(typeAwareSpecifiersOf('import type { Module } from "node:module";\nvoid 0;')).toEqual([
      "node:module",
    ]);
  });
});

describe("analyzeRuntimeSource import.meta policy", () => {
  it("accepts allowlisted metadata members", () => {
    expect(
      specifiersOf("void import.meta.url;\nvoid import.meta.dirname;\nvoid import.meta.main;"),
    ).toEqual([]);
  });

  it.each([
    ["a whole-object alias", "const meta = import.meta;\nvoid meta.url;"],
    ["a spread copy", "const meta = { ...import.meta };\nvoid meta.url;"],
    ["a destructured binding", "const { url } = import.meta;\nvoid url;"],
    ["an argument escape", "inspect(import.meta);"],
    ["a computed member", 'const key = "url";\nvoid import.meta[key];'],
    ["an unlisted member", "void import.meta.filename2;"],
  ])("rejects %s", (_label, source) => {
    expect(() => specifiersOf(source)).toThrow(/import\.meta.*direct member/is);
  });
});

describe("analyzeRuntimeSource environment policy", () => {
  it.each([
    ["process.env member", "void process.env.DATABASE_URL;"],
    ["process.env index", 'void process.env["DATABASE_URL"];'],
    ["Bun.env member", "void Bun.env.DATABASE_URL;"],
    ["import.meta.env member", "void import.meta.env.DATABASE_URL;"],
  ])("accepts a statically named allowlisted key read through a %s", (_label, source) => {
    expect(() => {
      checkEnvironment(source);
    }).not.toThrow();
  });

  it("rejects a key outside the allowlist and names it", () => {
    expect(() => {
      checkEnvironment("void process.env.MUSI_SEED_MODE;");
    }).toThrow(/MUSI_SEED_MODE.*not allowlisted/is);
  });

  it.each([
    ["a computed key", "void process.env[seedModeKey];"],
    ["an escaped environment object", "inspect(process.env);"],
    ["an aliased environment object", "const environment = process.env;\nvoid environment;"],
    ["a destructured key", "const { DATABASE_URL } = process.env;\nvoid DATABASE_URL;"],
  ])("fails closed on %s", (_label, source) => {
    expect(() => {
      checkEnvironment(source);
    }).toThrow(coarsePolicyMessage);
  });

  /**
   * The capability token itself may only ever be read as `<token>.<static key>`.
   * That is a token rule, not an alias analysis: the scan never asks what a name
   * resolves to, so an unrelated binding spelled `process` is rejected too and
   * the fix is to rename it.
   */
  it.each([
    ["an aliased capability token", "const runtime = process;\nvoid runtime.env.DATABASE_URL;"],
    ["an escaped capability token", "inspect(process);"],
    ["a re-bound capability token", "const { env } = process;\nvoid env.DATABASE_URL;"],
    ["a globalThis alias", "const root = globalThis;\nvoid root.process.env.DATABASE_URL;"],
    [
      "a capability token reached through another object",
      "void globalThis.process.env.DATABASE_URL;",
    ],
    ["a shadowing local binding", "function inspect(process: Config) { void process.env.MODE; }"],
    ["a value import of the process module", 'import { env } from "node:process";\nvoid env;'],
    [
      "a renamed process namespace import",
      'import * as runtime from "node:process";\nvoid runtime;',
    ],
    ["a re-export of the process module", 'export { env } from "node:process";'],
  ])("fails closed on %s", (_label, source) => {
    expect(() => {
      checkEnvironment(source);
    }).toThrow(coarsePolicyMessage);
  });

  it("still names an unallowlisted key reached through a computed capability member", () => {
    expect(() => {
      checkEnvironment('void globalThis["process"].env.MUSI_SEED_MODE;');
    }).toThrow(/MUSI_SEED_MODE.*not allowlisted/is);
  });

  it("accepts a static globalThis member write, the shape generated clients emit", () => {
    expect(() => {
      checkEnvironment('globalThis["__dirname"] = seedDirectory;');
    }).not.toThrow();
  });

  it("reads a node:process namespace import like the global", () => {
    expect(() => {
      checkEnvironment('import * as process from "node:process";\nvoid process.env.DATABASE_URL;');
    }).not.toThrow();
  });

  it("leaves the environment policy disabled when no allowlist is supplied", () => {
    expect(() =>
      analyzeRuntimeSource(parse("void process.env[dynamicKey];\nvoid Bun.env.SECRET;")),
    ).not.toThrow();
  });
});
