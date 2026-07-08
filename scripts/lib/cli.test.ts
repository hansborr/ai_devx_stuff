import { describe, expect, it } from "vitest";

import { isHelpFlag, matchesOption, parseCliArgs, parseFormatValue } from "./cli.js";

class TestError extends Error {}

const fail = (message: string): never => {
  throw new TestError(message);
};

describe("parseFormatValue", () => {
  it("accepts text and json", () => {
    expect(parseFormatValue("text", fail)).toBe("text");
    expect(parseFormatValue("json", fail)).toBe("json");
  });

  it("rejects anything else through the injected fail", () => {
    expect(() => parseFormatValue("yaml", fail)).toThrow("--format requires text or json.");
  });
});

describe("matchesOption", () => {
  it("matches the bare name and the =value form only", () => {
    expect(matchesOption("--format", "--format")).toBe(true);
    expect(matchesOption("--format=json", "--format")).toBe(true);
    expect(matchesOption("--formatx", "--format")).toBe(false);
    expect(matchesOption("--other", "--format")).toBe(false);
  });
});

describe("isHelpFlag", () => {
  it("recognizes --help and -h only", () => {
    expect(isHelpFlag("--help")).toBe(true);
    expect(isHelpFlag("-h")).toBe(true);
    expect(isHelpFlag("--helpme")).toBe(false);
    expect(isHelpFlag("help")).toBe(false);
  });
});

describe("parseCliArgs", () => {
  function collect(
    argv: readonly string[],
    allowEmptyArgs = false,
  ): {
    positionals: string[];
    format: string;
    latest: boolean;
  } {
    const positionals: string[] = [];
    let format = "text";
    let latest = false;
    parseCliArgs({
      argv,
      usage: "USAGE",
      createError: (message) => new TestError(message),
      allowEmptyArgs,
      options: [
        {
          name: "--format",
          kind: "value",
          apply: (value) => {
            format = parseFormatValue(value, fail);
          },
        },
        {
          name: "--latest",
          kind: "flag",
          apply: () => {
            latest = true;
          },
        },
      ],
      onPositional: (value) => positionals.push(value),
      onHelp: () => {
        throw new TestError("HELP");
      },
    });
    return { positionals, format, latest };
  }

  it("reads a value option in the --opt value form", () => {
    expect(collect(["--format", "json"])).toEqual({
      positionals: [],
      format: "json",
      latest: false,
    });
  });

  it("reads a value option in the --opt=value form", () => {
    expect(collect(["--format=json"])).toEqual({ positionals: [], format: "json", latest: false });
  });

  it("sets a flag option and collects positionals in order", () => {
    expect(collect(["--latest", "a", "b"])).toEqual({
      positionals: ["a", "b"],
      format: "text",
      latest: true,
    });
  });

  it("rejects an unknown --option with the usage suffix", () => {
    expect(() => collect(["--nope"])).toThrow("Unknown argument: --nope\nUSAGE");
  });

  it("treats --flag=value as unknown because flags match exactly", () => {
    expect(() => collect(["--latest=x"])).toThrow("Unknown argument: --latest=x\nUSAGE");
  });

  it("throws help on --help before any other handling", () => {
    expect(() => collect(["--help"])).toThrow("HELP");
  });

  it("guards empty args through createError by default", () => {
    expect(() => collect([""])).toThrow("Empty arguments are not supported.");
  });

  it("routes empty args to a positional when allowEmptyArgs is set", () => {
    expect(collect(["", "a"], true)).toEqual({
      positionals: ["", "a"],
      format: "text",
      latest: false,
    });
  });
});
