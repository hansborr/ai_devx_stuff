import { describe, expect, it, vi } from "vitest";

import { type ESLintFileResult, parseEslintOutput } from "./eslint-json.js";

const validMessage = {
  ruleId: "local/example",
  severity: 2,
  message: "boom",
  line: 3,
};

describe("parseEslintOutput", () => {
  it("returns an empty array for empty or whitespace-only stdout", () => {
    expect(parseEslintOutput("")).toEqual([]);
    expect(parseEslintOutput("   \n\t ")).toEqual([]);
  });

  it("parses well-formed results, keeping only the recognised messages", () => {
    const stdout = JSON.stringify([{ filePath: "/repo/a.ts", messages: [validMessage] }]);
    const expected: readonly ESLintFileResult[] = [
      { filePath: "/repo/a.ts", messages: [validMessage] },
    ];
    expect(parseEslintOutput(stdout)).toEqual(expected);
  });

  it("throws via the injected error factory when the top level is not an array", () => {
    const makeError = vi.fn((message: string) => new RangeError(message));
    expect(() => parseEslintOutput(JSON.stringify({ filePath: "x" }), makeError)).toThrow(
      RangeError,
    );
    expect(makeError).toHaveBeenCalledWith("ESLint --format=json output is not an array");
  });

  it("defaults to a plain Error on the not-an-array path", () => {
    expect(() => parseEslintOutput(JSON.stringify("nope"))).toThrow(Error);
    expect(() => parseEslintOutput(JSON.stringify("nope"))).toThrow(
      "ESLint --format=json output is not an array",
    );
  });

  it("skips array entries instead of treating them as objects (array-guard regression)", () => {
    const stdout = JSON.stringify([[], { filePath: "/repo/a.ts", messages: [validMessage] }]);
    expect(parseEslintOutput(stdout)).toEqual([
      { filePath: "/repo/a.ts", messages: [validMessage] },
    ]);
  });

  it("skips null and primitive top-level entries via the isRecord guard", () => {
    const stdout = JSON.stringify([
      null,
      "x",
      42,
      { filePath: "/repo/a.ts", messages: [validMessage] },
    ]);
    expect(parseEslintOutput(stdout)).toEqual([
      { filePath: "/repo/a.ts", messages: [validMessage] },
    ]);
  });

  it("drops null, primitive, and array messages via the isRecord guard", () => {
    const stdout = JSON.stringify([
      {
        filePath: "/repo/a.ts",
        messages: [null, "x", 7, [validMessage], validMessage],
      },
    ]);
    expect(parseEslintOutput(stdout)).toEqual([
      { filePath: "/repo/a.ts", messages: [validMessage] },
    ]);
  });

  it("skips file entries whose messages field is not an array", () => {
    const stdout = JSON.stringify([{ filePath: "/repo/a.ts", messages: "oops" }]);
    expect(parseEslintOutput(stdout)).toEqual([]);
  });

  it("skips file entries with a non-string filePath", () => {
    const stdout = JSON.stringify([{ filePath: 42, messages: [validMessage] }]);
    expect(parseEslintOutput(stdout)).toEqual([]);
  });

  it("rejects messages whose ruleId is neither a string nor null", () => {
    const stdout = JSON.stringify([
      {
        filePath: "/repo/a.ts",
        messages: [{ ...validMessage, ruleId: 7 }, validMessage],
      },
    ]);
    expect(parseEslintOutput(stdout)).toEqual([
      { filePath: "/repo/a.ts", messages: [validMessage] },
    ]);
  });

  it("keeps a message with a null ruleId (parser-error shape)", () => {
    const fatal = { ruleId: null, severity: 2, message: "Parsing error", fatal: true };
    const stdout = JSON.stringify([{ filePath: "/repo/a.ts", messages: [fatal] }]);
    expect(parseEslintOutput(stdout)).toEqual([{ filePath: "/repo/a.ts", messages: [fatal] }]);
  });

  it("drops messages missing the required message/severity fields", () => {
    const stdout = JSON.stringify([
      {
        filePath: "/repo/a.ts",
        messages: [
          { ruleId: "local/x", severity: 2 },
          { ruleId: "local/x", message: "m" },
        ],
      },
    ]);
    expect(parseEslintOutput(stdout)).toEqual([{ filePath: "/repo/a.ts", messages: [] }]);
  });
});
