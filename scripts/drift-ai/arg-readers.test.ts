import { describe, expect, it } from "vitest";

import { readNonEmpty, readPositiveInt, readRatio } from "./arg-readers.js";
import { DriftAiError } from "./errors.js";

describe("arg readers", () => {
  it("parses shared positive integer options with canonical errors", () => {
    expect(readPositiveInt(" 12 ", "--top")).toBe(12);
    expect(() => readPositiveInt("0", "--top")).toThrow(DriftAiError);
    expect(() => readPositiveInt("0", "--top")).toThrow(
      "--top requires a positive integer (got '0').",
    );
  });

  it("parses shared ratio options with canonical errors", () => {
    expect(readRatio("0.5", "--threshold")).toBe(0.5);
    expect(() => readRatio("1.5", "--threshold")).toThrow(
      "--threshold requires a number between 0 and 1 (got '1.5').",
    );
  });

  it("trims shared non-empty options with canonical errors", () => {
    expect(readNonEmpty(" value ", "--language")).toBe("value");
    expect(() => readNonEmpty("   ", "--language")).toThrow(
      "--language requires a non-empty value.",
    );
  });
});
