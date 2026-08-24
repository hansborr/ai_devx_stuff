import { parseArgs as nodeParseArgs } from "node:util";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { isHelpFlag, matchesOption, parseCli, type ParsedCli, parseFormatValue } from "./cli.js";

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

describe("parseCli", () => {
  const schema = z.object({
    "--format": z
      .enum(["text", "json"], { error: "--format requires text or json." })
      .default("text"),
    "--latest": z.boolean().default(false),
    "--input": z.array(z.string()).default([]),
  });

  function run(
    argv: readonly string[],
    allowEmptyArgs = false,
  ): ParsedCli<z.output<typeof schema>> {
    return parseCli({
      argv,
      usage: "USAGE",
      createError: (message) => new TestError(message),
      allowEmptyArgs,
      options: [
        { name: "--format", kind: "value" },
        { name: "--latest", kind: "flag" },
        { name: "--input", kind: "value", repeatable: true },
      ],
      schema,
      onHelp: () => {
        throw new TestError("HELP");
      },
    });
  }

  it("returns schema-typed defaults for an empty argv", () => {
    expect(run([])).toEqual({
      options: { "--format": "text", "--latest": false, "--input": [] },
      positionals: [],
    });
  });

  it("reads value options in both forms, flags, and ordered positionals", () => {
    const parsed = run(["--format=json", "--latest", "a", "--input", "x", "b"]);
    expect(parsed.options["--format"]).toBe("json");
    expect(parsed.options["--latest"]).toBe(true);
    expect(parsed.options["--input"]).toEqual(["x"]);
    expect(parsed.positionals).toEqual(["a", "b"]);
    // The schema output is typed without assertions: these are compile-time
    // string/boolean/string-array values, not unknowns.
    const format: "text" | "json" = parsed.options["--format"];
    expect(format).toBe("json");
  });

  it("collects every occurrence of a repeatable value option in order", () => {
    expect(run(["--input", "a", "--input=b"]).options["--input"]).toEqual(["a", "b"]);
  });

  it("keeps last-occurrence-wins semantics for non-repeatable value options", () => {
    expect(run(["--format", "json", "--format", "text"]).options["--format"]).toBe("text");
  });

  it("exposes seen option names in first-occurrence argv order, omitted when none were seen", () => {
    expect(run(["--input", "x", "--format=json", "--latest", "--input", "y"]).seenOptions).toEqual([
      "--input",
      "--format",
      "--latest",
    ]);
    expect(run([]).seenOptions).toBeUndefined();
    expect(run(["positional-only"]).seenOptions).toBeUndefined();
  });

  it("exposes per-occurrence option events in argv order, omitted when none were seen", () => {
    expect(run(["--input", "a", "--latest", "--input=b", "--format", "json"]).optionEvents).toEqual(
      [
        { name: "--input", value: "a" },
        { name: "--latest", value: true },
        { name: "--input", value: "b" },
        { name: "--format", value: "json" },
      ],
    );
    expect(run([]).optionEvents).toBeUndefined();
    expect(run(["positional-only"]).optionEvents).toBeUndefined();
  });

  it("rejects unknown arguments and inline values on flags with the usage suffix", () => {
    expect(() => run(["--nope"])).toThrow("Unknown argument: --nope\nUSAGE");
    expect(() => run(["--latest=x"])).toThrow("Unknown argument: --latest=x\nUSAGE");
  });

  it("rejects missing, empty, and option-like option values", () => {
    expect(() => run(["--format"])).toThrow("--format requires a value.\nUSAGE");
    expect(() => run(["--format", "--latest"])).toThrow("--format requires a value.\nUSAGE");
    expect(() => run(["--format="])).toThrow("--format requires a value.\nUSAGE");
  });

  it("surfaces the schema's own message through the injected error identity", () => {
    expect(() => run(["--format", "yaml"])).toThrow(TestError);
    expect(() => run(["--format", "yaml"])).toThrow("--format requires text or json.");
  });

  it("keeps the walk help, empty-arg, and single-dash routing policies", () => {
    expect(() => run(["--help"])).toThrow("HELP");
    expect(() => run([""])).toThrow("Empty arguments are not supported.");
    expect(run([""], true).positionals).toEqual([""]);
    expect(run(["-x"]).positionals).toEqual(["-x"]);
  });

  it("rejects a positional at its token when the spec declares that policy", () => {
    const spec = {
      usage: "USAGE",
      createError: (message: string) => new TestError(message),
      rejectPositionals: true,
      options: [{ name: "--latest", kind: "flag" } as const],
      schema: z.object({ "--latest": z.boolean().default(false) }),
      onHelp: () => {
        throw new TestError("HELP");
      },
    };
    expect(() => parseCli({ ...spec, argv: ["stray", "--help"] })).toThrow(
      "Unknown argument: stray\nUSAGE",
    );
    expect(() => parseCli({ ...spec, argv: ["stray", "--latest=x"] })).toThrow(
      "Unknown argument: stray\nUSAGE",
    );
  });

  it("uses a value option's own valueErrorMessage without the usage suffix", () => {
    const spec = {
      usage: "USAGE",
      createError: (message: string) => new TestError(message),
      options: [
        { name: "--baseline", kind: "value", valueErrorMessage: "--baseline requires a path." },
      ] as const,
      schema: z.object({ "--baseline": z.string().optional() }),
    };
    expect(() => parseCli({ ...spec, argv: ["--baseline"] })).toThrow(
      "--baseline requires a path.",
    );
    expect(() => parseCli({ ...spec, argv: ["--baseline", "--x"] })).toThrow(
      "--baseline requires a path.",
    );
    expect(() => parseCli({ ...spec, argv: ["--baseline="] })).toThrow(
      "--baseline requires a path.",
    );
  });

  it("omits the usage suffix from unknown-argument errors when usage is empty", () => {
    const spec = {
      usage: "",
      createError: (message: string) => new TestError(message),
      options: [],
      schema: z.object({}),
    };
    let message = "";
    try {
      parseCli({ ...spec, argv: ["--nope"] });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("Unknown argument: --nope");
  });

  it("rejects an inline value on a flag with its inlineValueErrorMessage when declared", () => {
    const spec = {
      usage: "USAGE",
      createError: (message: string) => new TestError(message),
      options: [
        {
          name: "--include-scope",
          kind: "flag",
          inlineValueErrorMessage: "--include-scope does not accept a value.",
        } as const,
      ],
      schema: z.object({ "--include-scope": z.boolean().default(false) }),
    };
    expect(parseCli({ ...spec, argv: ["--include-scope"] }).options["--include-scope"]).toBe(true);
    expect(() => parseCli({ ...spec, argv: ["--include-scope=x"] })).toThrow(
      "--include-scope does not accept a value.",
    );
  });

  it("treats the inline form as unknown for rejectInlineForm value options", () => {
    const spec = {
      usage: "USAGE",
      createError: (message: string) => new TestError(message),
      options: [{ name: "--baseline", kind: "value", rejectInlineForm: true } as const],
      schema: z.object({ "--baseline": z.string().optional() }),
    };
    expect(parseCli({ ...spec, argv: ["--baseline", "p.json"] }).options["--baseline"]).toBe(
      "p.json",
    );
    expect(() => parseCli({ ...spec, argv: ["--baseline=p.json"] })).toThrow(
      "Unknown argument: --baseline=p.json\nUSAGE",
    );
  });
});

// S1 spike record (arch-plans-2026-07 leaf 02): the recorded idiom from
// lint-arch leaf 08 is compiling specs down to `node:util` parseArgs. These
// tests document the concrete compatibility mismatches that spike hit, which
// is why parseCli keeps the proven hand walk: parseArgs cannot reproduce the
// smoke-locked error identities or the substrate's token routing without
// re-authoring every check on top of its token stream.
describe("node:util parseArgs compilation spike mismatches (recorded)", () => {
  const options = { format: { type: "string" }, latest: { type: "boolean" } } as const;

  it("consumes an option-like token as a value where the substrate errors", () => {
    const out = nodeParseArgs({ args: ["--format", "--latest"], options, strict: false });
    // Substrate contract: "--format requires a value." parseArgs instead
    // swallows the next option as the value.
    expect(out.values.format).toBe("--latest");
  });

  it("tokenizes single-dash tokens as options where the substrate sees positionals", () => {
    const out = nodeParseArgs({
      args: ["-abc"],
      options,
      strict: false,
      allowPositionals: true,
      tokens: true,
    });
    // Substrate contract: "-abc" is one positional. parseArgs explodes it into
    // grouped short options sharing one argv index.
    expect(out.positionals).toEqual([]);
    expect(out.tokens.filter((token) => token.kind === "option")).toHaveLength(3);
  });

  it("silently accepts inline values on booleans where the substrate rejects", () => {
    const out = nodeParseArgs({ args: ["--latest=x"], options, strict: false });
    // Substrate contract: "Unknown argument: --latest=x". parseArgs coerces the
    // flag into a string value instead.
    expect(out.values.latest).toBe("x");
  });

  it("treats bare -- as an option terminator where the substrate rejects it", () => {
    const out = nodeParseArgs({
      args: ["--", "a"],
      options,
      strict: false,
      allowPositionals: true,
    });
    // Substrate contract: "Unknown argument: --". parseArgs swallows it.
    expect(out.positionals).toEqual(["a"]);
  });

  it("owns error identity in strict mode, breaking smoke-locked diagnostics", () => {
    expect(() => nodeParseArgs({ args: ["--nope"], options, strict: true })).toThrow(
      /Unknown option '--nope'/u,
    );
  });
});
