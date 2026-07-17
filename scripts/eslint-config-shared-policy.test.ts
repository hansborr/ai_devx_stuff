import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import * as configSurfaces from "../eslint-config/config-surfaces.js";
import * as maxLinesExceptionsCodec from "../eslint-config/max-lines-exceptions-codec.js";
import * as sharedPolicy from "../eslint-config/shared-policy.js";
import * as maxLinesRule from "../eslint-rules/max-lines.js";
import * as sharedSchemaPrefix from "../eslint-rules/shared-schema-prefix.js";

// scripts/eslint-config-shared-policy.d.ts hand-restates the runtime shape of
// the eslint-config/eslint-rules JavaScript it declares (sanctioned resolver
// exception, see scripts/README.md). Nothing else compares the declaration to
// the real modules, so a runtime rename would leave every scripts/ consumer
// compiling clean against a stale shape and only fail when the gate runs.
// This test parses the declaration file and asserts each promised export
// exists at runtime with its declared shallow shape. The runtime modules may
// intentionally export more than the declaration exposes (shared-policy.js
// does), so export-set equality is deliberately not required.

const declarationPath = resolve(import.meta.dirname, "eslint-config-shared-policy.d.ts");

const runtimeModulesByDeclaredName: Record<string, Record<string, unknown>> = {
  "*eslint-config/shared-policy.js": sharedPolicy,
  "*eslint-config/config-surfaces.js": configSurfaces,
  "*eslint-config/max-lines-exceptions-codec.js": maxLinesExceptionsCodec,
  "*eslint-rules/max-lines.js": maxLinesRule,
  "*eslint-rules/shared-schema-prefix.js": sharedSchemaPrefix,
};

interface DeclaredModule {
  readonly runtimeExports: readonly string[];
  readonly stringArrayExports: readonly string[];
  readonly interfaceProperties: ReadonlyMap<string, readonly string[]>;
}

function hasExportModifier(statement: ts.VariableStatement | ts.FunctionDeclaration): boolean {
  return statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function parseDeclaredModules(): Map<string, DeclaredModule> {
  const source = ts.createSourceFile(
    declarationPath,
    readFileSync(declarationPath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const modules = new Map<string, DeclaredModule>();
  for (const statement of source.statements) {
    if (!ts.isModuleDeclaration(statement) || !ts.isStringLiteral(statement.name)) continue;
    if (statement.body === undefined || !ts.isModuleBlock(statement.body)) continue;
    const runtimeExports: string[] = [];
    const stringArrayExports: string[] = [];
    const interfaceProperties = new Map<string, readonly string[]>();
    for (const member of statement.body.statements) {
      if (ts.isVariableStatement(member) && hasExportModifier(member)) {
        for (const declaration of member.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name)) continue;
          runtimeExports.push(declaration.name.text);
          if (declaration.type?.getText(source) === "readonly string[]") {
            stringArrayExports.push(declaration.name.text);
          }
        }
      } else if (ts.isFunctionDeclaration(member) && hasExportModifier(member) && member.name) {
        runtimeExports.push(member.name.text);
      } else if (ts.isExportAssignment(member) && !member.isExportEquals) {
        runtimeExports.push("default");
      } else if (ts.isInterfaceDeclaration(member)) {
        const properties = member.members
          .filter(ts.isPropertySignature)
          .map((property) => property.name)
          .filter(ts.isIdentifier)
          .map((name) => name.text);
        interfaceProperties.set(member.name.text, properties);
      }
    }
    modules.set(statement.name.text, { runtimeExports, stringArrayExports, interfaceProperties });
  }
  return modules;
}

const declaredModules = parseDeclaredModules();

function declaredModule(name: string): DeclaredModule {
  const module = declaredModules.get(name);
  if (module === undefined) throw new Error(`declaration file no longer declares ${name}`);
  return module;
}

function declaredInterfaceProperties(moduleName: string, interfaceName: string): string[] {
  const properties = declaredModule(moduleName).interfaceProperties.get(interfaceName);
  if (properties === undefined) {
    throw new Error(`declaration file no longer declares ${interfaceName} in ${moduleName}`);
  }
  return [...properties].sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstEntry(
  moduleName: string,
  exportName: string,
  value: unknown,
): Record<string, unknown> {
  expect(Array.isArray(value), `${moduleName} ${exportName} should be an array`).toBe(true);
  const entries: readonly unknown[] = Array.isArray(value) ? value : [];
  expect(entries.length, `${moduleName} ${exportName} should not be empty`).toBeGreaterThan(0);
  const entry: unknown = entries[0];
  if (!isRecord(entry)) throw new Error(`${moduleName} ${exportName}[0] is not an object`);
  return entry;
}

describe("eslint-config-shared-policy.d.ts runtime parity", () => {
  it("declares exactly the modules this test imports at runtime", () => {
    expect([...declaredModules.keys()].sort()).toEqual(
      Object.keys(runtimeModulesByDeclaredName).sort(),
    );
  });

  it.each(Object.keys(runtimeModulesByDeclaredName))(
    "every export declared for %s exists at runtime",
    (moduleName) => {
      const { runtimeExports } = declaredModule(moduleName);
      expect(runtimeExports.length).toBeGreaterThan(0);
      const runtime = runtimeModulesByDeclaredName[moduleName];
      const missing = runtimeExports.filter((name) => runtime?.[name] === undefined);
      expect(missing, `exports declared in the .d.ts but missing at runtime`).toEqual([]);
    },
  );

  it.each(Object.keys(runtimeModulesByDeclaredName))(
    "every export declared as readonly string[] for %s is a string array at runtime",
    (moduleName) => {
      const runtime = runtimeModulesByDeclaredName[moduleName];
      for (const name of declaredModule(moduleName).stringArrayExports) {
        const value = runtime?.[name];
        expect(Array.isArray(value), `${name} should be an array`).toBe(true);
        const entries: readonly unknown[] = Array.isArray(value) ? value : [];
        expect(entries.length, `${name} should not be empty`).toBeGreaterThan(0);
        for (const entry of entries) {
          expect(typeof entry, `${name} entries should be strings`).toBe("string");
        }
      }
    },
  );

  it.each([
    ["*eslint-config/shared-policy.js", sharedPolicy.configSurfaceEntries],
    ["*eslint-config/config-surfaces.js", configSurfaces.configSurfaceEntries],
  ] as const)(
    "configSurfaceEntries from %s match the declared entry shape",
    (moduleName, entries) => {
      const entry = firstEntry(moduleName, "configSurfaceEntries", entries);
      expect(Object.keys(entry).sort()).toEqual(
        declaredInterfaceProperties(moduleName, "ConfigSurfaceEntry"),
      );
      expect(typeof entry.path).toBe("string");
      expect(["js", "mjs", "ts"]).toContain(entry.language);
      expect(["root-js", "root-package-ts", "script-ts", "eslint-rules-ts"]).toContain(entry.group);
      expect(entry.coverageStatus).toBe("linted");
    },
  );

  it("maxLinesPolicy matches the declared policy and exception shapes", () => {
    const moduleName = "*eslint-config/shared-policy.js";
    const policy: unknown = sharedPolicy.maxLinesPolicy;
    if (!isRecord(policy)) throw new Error("maxLinesPolicy is not an object");
    expect(Object.keys(policy).sort()).toEqual(
      declaredInterfaceProperties(moduleName, "MaxLinesPolicy"),
    );
    expect(policy.counting).toEqual({ skipBlankLines: true, skipComments: true });
    expect(sharedPolicy.maxLinesPolicy.ratchetFloor.cap).toBeGreaterThan(0);
    expect(Array.isArray(policy.ratchets)).toBe(true);
    const exception = firstEntry(moduleName, "maxLinesPolicy.exceptions", policy.exceptions);
    expect(Object.keys(exception).sort()).toEqual(
      declaredInterfaceProperties(moduleName, "MaxLinesPolicyException"),
    );
    expect(typeof exception.path).toBe("string");
    expect(typeof exception.cap).toBe("number");
    expect(["error", "warn"]).toContain(exception.severity);
    expect(typeof exception.reason).toBe("string");
    expect(typeof exception.lifecycle).toBe("string");
    expect(typeof exception.ratchetExcluded).toBe("boolean");
  });

  it("max-lines rule exports match their declared shapes", () => {
    expect(typeof maxLinesRule.MAX_LINES_SPLIT_GUIDANCE).toBe("string");
    expect(maxLinesRule.MAX_LINES_SPLIT_GUIDANCE.length).toBeGreaterThan(0);
    expect(typeof maxLinesRule.MAX_LINES_METRIC_GUIDANCE).toBe("string");
    expect(maxLinesRule.MAX_LINES_METRIC_GUIDANCE.length).toBeGreaterThan(0);
    expect(typeof maxLinesRule.effectiveLines).toBe("function");
    const rule: unknown = maxLinesRule.default;
    if (!isRecord(rule)) throw new Error("max-lines default export is not an object");
    expect(isRecord(rule.meta), "rule.meta should be an object").toBe(true);
    expect(typeof rule.create).toBe("function");
  });
});
