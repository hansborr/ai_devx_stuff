import { describe, expect, it } from "vitest";

import { type ParsedOption, parseOption, readOptionValue } from "./cli-options.js";

function requiredParsedOption(arg: string): ParsedOption {
  const option = parseOption(arg);
  if (option === undefined) throw new Error(`expected ${arg} to parse as an option`);
  return option;
}

describe("code-intel CLI option reader", () => {
  it("rejects option-looking values", () => {
    expect(() =>
      readOptionValue(
        requiredParsedOption("--name"),
        ["--name", "--format=json"],
        0,
        "--name requires a symbol name.",
      ),
    ).toThrow(/--name requires a symbol name/u);
    expect(() =>
      readOptionValue(
        requiredParsedOption("--name=--format=json"),
        ["--name=--format=json"],
        0,
        "--name requires a symbol name.",
      ),
    ).toThrow(/--name requires a symbol name/u);
    expect(() =>
      readOptionValue(
        requiredParsedOption("--name="),
        ["--name="],
        0,
        "--name requires a symbol name.",
      ),
    ).toThrow(/--name requires a symbol name/u);
  });
});
