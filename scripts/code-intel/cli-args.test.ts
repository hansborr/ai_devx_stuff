import { describe, expect, it } from "vitest";

import { parseArgs } from "./cli-args.js";

function thrownMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected function to throw");
}

describe("parseArgs", () => {
  it("keeps code:intel empty string argv entries strict", () => {
    expect(thrownMessage(() => parseArgs([""]))).toBe(
      "code:intel: Empty arguments are not supported.",
    );
  });
});

// Characterization tests (arch-plans-2026-07 leaf 02, S0): pin the CURRENT
// parser contract before any migration onto parseCli(spec). Structure: a
// global --format pass extracts the option from anywhere in argv, then a
// subcommand table parses the rest. Parse failures throw CodeIntelError
// (prefixed "code:intel: "), which cli-main maps to exit 1 — not the exit 2
// most other harness CLIs use.
describe("parseArgs characterization", () => {
  it("extracts --format from anywhere, in both separate and inline forms", () => {
    expect(parseArgs(["--format", "json", "exports", "src/a.ts"])).toEqual({
      command: { kind: "exports", file: "src/a.ts" },
      format: "json",
    });
    expect(parseArgs(["exports", "src/a.ts", "--format=json"])).toEqual({
      command: { kind: "exports", file: "src/a.ts" },
      format: "json",
    });
  });

  it("last --format occurrence wins and bad values fail with the shared message", () => {
    expect(parseArgs(["--format", "json", "--format=text", "exports", "f.ts"]).format).toBe("text");
    expect(thrownMessage(() => parseArgs(["--format", "yaml", "exports", "f.ts"]))).toBe(
      "code:intel: --format requires text or json.",
    );
  });

  it("routes help flags: general first, per-topic when the sole subcommand arg", () => {
    expect(parseArgs(["--help"]).command).toEqual({ kind: "help" });
    expect(parseArgs(["-h"]).command).toEqual({ kind: "help" });
    expect(parseArgs(["dependents", "--help"]).command).toEqual({
      kind: "help",
      topic: "dependents",
    });
    // --help beside other args is NOT help; it hits the option parser instead.
    expect(thrownMessage(() => parseArgs(["def", "x.ts:1:1", "--help"]))).toBe(
      "code:intel: Unknown argument: --help",
    );
  });

  it("requires a command and rejects unknown commands with the usage appended", () => {
    expect(thrownMessage(() => parseArgs([]))).toContain("Usage:");
    expect(thrownMessage(() => parseArgs(["bogus"]))).toContain("Unknown command: bogus");
  });

  it("parses def in both location and --name modes and rejects mixing them", () => {
    expect(parseArgs(["def", "src/a.ts:3:7"]).command).toEqual({
      kind: "def",
      location: { file: "src/a.ts", line: 3, col: 7 },
    });
    expect(parseArgs(["def", "--name", "mySymbol"]).command).toEqual({
      kind: "defName",
      name: "mySymbol",
    });
    expect(thrownMessage(() => parseArgs(["def", "src/a.ts:3:7", "--name", "x"]))).toBe(
      "code:intel: Use either def <file>:<line>:<col> or def --name <symbol>.",
    );
  });

  it("parses dependents options, inline forms included, and validates values", () => {
    expect(
      parseArgs(["dependents", "src/a.ts", "--depth=2", "--exclude-tests", "--limit", "5"]).command,
    ).toEqual({
      kind: "dependents",
      file: "src/a.ts",
      depth: 2,
      excludeTests: true,
      limit: 5,
      project: undefined,
    });
    expect(thrownMessage(() => parseArgs(["dependents", "src/a.ts", "--depth", "0"]))).toBe(
      "code:intel: --depth requires a positive integer.",
    );
    expect(thrownMessage(() => parseArgs(["dependents", "src/a.ts", "--project", "nope"]))).toBe(
      "code:intel: --project requires shared, server, or client.",
    );
    // Boolean flags reject inline values as unknown arguments.
    expect(thrownMessage(() => parseArgs(["dependents", "src/a.ts", "--exclude-tests=x"]))).toBe(
      "code:intel: Unknown argument: --exclude-tests=x",
    );
  });

  it("maps tests --direct to depth 1 and rejects combining it with --depth", () => {
    expect(parseArgs(["tests", "src/a.ts", "--direct"]).command).toEqual({
      kind: "tests",
      file: "src/a.ts",
      depth: 1,
      limit: undefined,
      project: undefined,
    });
    expect(thrownMessage(() => parseArgs(["tests", "src/a.ts", "--direct", "--depth", "2"]))).toBe(
      "code:intel: Use either --direct or --depth, not both.",
    );
  });

  it("enforces exactly one positional per subcommand with tool-local usage errors", () => {
    expect(thrownMessage(() => parseArgs(["overview"]))).toBe(
      "code:intel: Usage: bun run code:intel -- overview <file>",
    );
    expect(thrownMessage(() => parseArgs(["refs"]))).toBe(
      "code:intel: Usage: bun run code:intel -- refs <file>:<line>:<col> [--limit <N>]",
    );
    expect(thrownMessage(() => parseArgs(["exports", "a.ts", "b.ts"]))).toBe(
      "code:intel: Usage: bun run code:intel -- exports <file>",
    );
    expect(thrownMessage(() => parseArgs(["dependents"]))).toBe(
      "code:intel: Usage: bun run code:intel -- dependents <file> [--depth <N>] [--project <shared|server|client>] [--exclude-tests] [--limit <N>]",
    );
    expect(thrownMessage(() => parseArgs(["tests"]))).toBe(
      "code:intel: Usage: bun run code:intel -- tests <file> [--depth <N>] [--direct] [--project <shared|server|client>] [--limit <N>]",
    );
  });

  it("treats a bare -- as an option and rejects it without a usage suffix", () => {
    expect(thrownMessage(() => parseArgs(["overview", "--"]))).toBe(
      "code:intel: Unknown argument: --",
    );
  });
});
