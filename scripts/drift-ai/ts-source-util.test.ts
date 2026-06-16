import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ts } from "ts-morph";
import { afterEach, describe, expect, it } from "vitest";

import {
  findAncestor,
  hasAncestor,
  tsSysModuleResolutionHost,
  tsSysReadFile,
} from "./ts-source-util.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true);
}

function firstIdentifier(sourceFile: ts.SourceFile, name: string): ts.Identifier {
  let found: ts.Identifier | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isIdentifier(node) && node.text === name) {
      found = node;
      return;
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  if (found === undefined) throw new Error(`identifier ${name} not found`);
  return found;
}

describe("findAncestor", () => {
  it("returns the nearest ancestor matching the predicate", () => {
    const sourceFile = parse("@Component()\nclass Widget { value = target; }\n");
    const target = firstIdentifier(sourceFile, "target");

    const decorator = findAncestor(target, ts.isClassDeclaration);

    expect(decorator).toBeDefined();
    expect(decorator && ts.isClassDeclaration(decorator)).toBe(true);
  });

  it("stops at the source file and returns undefined when no ancestor matches", () => {
    const sourceFile = parse("const value = target;\n");
    const target = firstIdentifier(sourceFile, "target");

    // A class declaration never appears above a top-level variable initializer.
    expect(findAncestor(target, ts.isClassDeclaration)).toBeUndefined();
  });

  it("does not start from the node itself", () => {
    const sourceFile = parse("const value = inner;\n");
    const inner = firstIdentifier(sourceFile, "inner");

    // The predicate matches the start node, but findAncestor walks strictly up.
    expect(findAncestor(inner, ts.isIdentifier)).toBeUndefined();
  });
});

describe("hasAncestor", () => {
  it("is true when a matching ancestor exists", () => {
    const sourceFile = parse("@Component(target)\nclass Widget {}\n");
    const target = firstIdentifier(sourceFile, "target");

    expect(hasAncestor(target, ts.isDecorator)).toBe(true);
  });

  it("is false when no matching ancestor exists", () => {
    const sourceFile = parse("const value = target;\n");
    const target = firstIdentifier(sourceFile, "target");

    expect(hasAncestor(target, ts.isDecorator)).toBe(false);
  });
});

describe("tsSysModuleResolutionHost", () => {
  it("reports the repo root as the current directory", () => {
    const host = tsSysModuleResolutionHost("/repo/root");
    expect(host.getCurrentDirectory?.()).toBe("/repo/root");
  });

  it("delegates fileExists/readFile to ts.sys", () => {
    const root = mkdtempSync(join(tmpdir(), "ts-source-util-"));
    tempRoots.push(root);
    const filePath = join(root, "present.ts");
    writeFileSync(filePath, "export const value = 1;\n");

    const host = tsSysModuleResolutionHost(root);

    expect(host.fileExists(filePath)).toBe(true);
    expect(host.fileExists(join(root, "absent.ts"))).toBe(false);
    expect(host.readFile(filePath)).toBe("export const value = 1;\n");
  });
});

describe("tsSysReadFile", () => {
  it("reads a file through ts.sys without an unbound method", () => {
    const root = mkdtempSync(join(tmpdir(), "ts-source-util-"));
    tempRoots.push(root);
    const filePath = join(root, "config.json");
    writeFileSync(filePath, '{ "ok": true }\n');

    expect(tsSysReadFile(filePath)).toBe('{ "ok": true }\n');
    expect(tsSysReadFile(join(root, "missing.json"))).toBeUndefined();
  });
});
