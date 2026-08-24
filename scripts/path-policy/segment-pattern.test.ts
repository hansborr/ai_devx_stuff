import { describe, expect, it } from "vitest";

import {
  compileShellSegmentGlob,
  hasShellGlobSyntax,
  matchStarOnlySegmentPattern,
} from "./segment-pattern.js";

describe("star-only path-policy segment patterns", () => {
  it("matches ordinary literals and escapes regular-expression punctuation", () => {
    expect(matchStarOnlySegmentPattern("config+(local).ts", "config+(local).ts")).toBe(true);
    expect(matchStarOnlySegmentPattern("config-local.ts", "config+(local).ts")).toBe(false);
    expect(matchStarOnlySegmentPattern("file].ts", "file].ts")).toBe(true);
  });

  it("expands stars without allowing them to cross path separators", () => {
    expect(
      matchStarOnlySegmentPattern("packages/client/package.json", "packages/*/package.json"),
    ).toBe(true);
    expect(
      matchStarOnlySegmentPattern("packages/client/nested/package.json", "packages/*/package.json"),
    ).toBe(false);
  });

  it.each(["file?.ts", "file[ab].ts"])("rejects unsupported policy syntax in %s", (pattern) => {
    expect(() => matchStarOnlySegmentPattern("filea.ts", pattern)).toThrow(
      "star-only segment pattern",
    );
  });
});

describe("fixture shell segment globs", () => {
  it("matches ordinary literals and escapes regular-expression punctuation", () => {
    const matcher = compileShellSegmentGlob("config+(local).ts");

    expect(matcher.test("config+(local).ts")).toBe(true);
    expect(matcher.test("config-local.ts")).toBe(false);
  });

  it("supports stars and question marks without crossing path separators", () => {
    const starMatcher = compileShellSegmentGlob("file*.ts");
    const questionMatcher = compileShellSegmentGlob("file?.ts");

    expect(starMatcher.test("file-long.ts")).toBe(true);
    expect(starMatcher.test("file/sub.ts")).toBe(false);
    expect(questionMatcher.test("file1.ts")).toBe(true);
    expect(questionMatcher.test("file12.ts")).toBe(false);
    expect(questionMatcher.test("file/.ts")).toBe(false);
  });

  it("preserves the existing JavaScript RegExp bracket approximation", () => {
    const matcher = compileShellSegmentGlob("file[ab].ts");

    expect(matcher.test("filea.ts")).toBe(true);
    expect(matcher.test("fileb.ts")).toBe(true);
    expect(matcher.test("filec.ts")).toBe(false);
  });

  it("preserves malformed bracket failures from RegExp construction", () => {
    expect(() => compileShellSegmentGlob("file[ab.ts")).toThrow(SyntaxError);
  });
});

describe("fixture glob-shape detection", () => {
  it.each(["file*.ts", "file?.ts", "file[ab].ts"])("recognizes shell syntax in %s", (value) => {
    expect(hasShellGlobSyntax(value)).toBe(true);
  });

  it.each(["file.ts", "file].ts"])("leaves ordinary values unshaped in %s", (value) => {
    expect(hasShellGlobSyntax(value)).toBe(false);
  });
});
