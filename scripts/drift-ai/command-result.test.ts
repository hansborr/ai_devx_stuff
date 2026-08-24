import { describe, expect, it } from "vitest";

import { DriftAiHelp } from "./cli-args.js";
import { sentinelToCommandResult } from "./command-result.js";
import { DriftAiError } from "./errors.js";

describe("sentinelToCommandResult", () => {
  it("maps DriftAiHelp to a successful help result (exit 0, message on stdout)", () => {
    expect(sentinelToCommandResult(new DriftAiHelp("usage text"))).toEqual({
      exitCode: 0,
      stdout: "usage text",
    });
  });

  it("maps DriftAiError to a usage/config failure (exit 2, message on stdout)", () => {
    expect(sentinelToCommandResult(new DriftAiError("bad --format value"))).toEqual({
      exitCode: 2,
      stdout: "bad --format value",
    });
  });

  it("rethrows unexpected Error values unchanged", () => {
    const unexpected = new RangeError("not a sentinel");
    expect(() => sentinelToCommandResult(unexpected)).toThrow(unexpected);
  });

  it("rethrows non-Error thrown values unchanged", () => {
    expect(() => sentinelToCommandResult("thrown string")).toThrow("thrown string");
  });
});
