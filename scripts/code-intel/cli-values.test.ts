import { describe, expect, it } from "vitest";

import { parseLocation, parseProjectFilter } from "./cli-values.js";
import { CodeIntelError } from "./errors.js";

describe("parseLocation", () => {
  it("returns the parsed file, line, and column for a valid location", () => {
    expect(parseLocation("f.ts:2:3")).toEqual({ file: "f.ts", line: 2, col: 3 });
  });

  it("preserves earlier colons in the file segment", () => {
    // Only the LAST two colons delimit line/col, so a colon inside the file stays.
    expect(parseLocation("a:b.ts:4:5")).toEqual({ file: "a:b.ts", line: 4, col: 5 });
  });

  it.each([
    ["empty file", ":2:3"],
    ["non-integer line", "f.ts:x:3"],
    ["non-integer column", "f.ts:2:y"],
    ["zero line", "f.ts:0:3"],
    ["zero column", "f.ts:2:0"],
    ["negative line", "f.ts:-1:3"],
    ["negative column", "f.ts:2:-1"],
  ])("rejects the %s boundary case", (_label, raw) => {
    // Each clause of the L42 guard must hold: bad file/line/col reaches the
    // <file>:<positive-line>:<positive-col> error, not the earlier colon-count one.
    expect(() => parseLocation(raw)).toThrow(/<positive-line>:<positive-col>/u);
    expect(() => parseLocation(raw)).toThrow(CodeIntelError);
  });

  it("uses the provided label in the boundary error", () => {
    expect(() => parseLocation("f.ts:0:3", "Definition")).toThrow(
      /Definition location must be <file>:<positive-line>:<positive-col>/u,
    );
  });
});

describe("parseProjectFilter", () => {
  it.each(["shared", "server", "client"] as const)("round-trips the %s filter", (value) => {
    expect(parseProjectFilter(value)).toBe(value);
  });

  it("rejects an unknown project filter", () => {
    expect(() => parseProjectFilter("bogus")).toThrow(CodeIntelError);
    expect(() => parseProjectFilter("bogus")).toThrow(/shared, server, or client/u);
  });
});
