import { describe, expect, it } from "vitest";

import { DriftAiHelp } from "./cli-args.js";
import { DriftAiError } from "./errors.js";
import { parseSubcommandArgs, writeSubcommandOutput } from "./subcommand-args.js";

const SPEC = { usage: "USAGE-TEXT" } as const;
const CONFIG_SPEC = { usage: "USAGE-TEXT", acceptsConfig: true } as const;

describe("parseSubcommandArgs", () => {
  it("defaults to text format with no output or config path", () => {
    expect(parseSubcommandArgs([], SPEC)).toEqual({
      format: "text",
      outputPath: null,
      configPath: null,
    });
  });

  it("parses --format and --output (space- and equals-separated)", () => {
    expect(parseSubcommandArgs(["--format", "json", "--output", "out.json"], SPEC)).toEqual({
      format: "json",
      outputPath: "out.json",
      configPath: null,
    });
  });

  it("accepts --config only when the spec opts in", () => {
    expect(parseSubcommandArgs(["--format=json", "--config=cfg.json"], CONFIG_SPEC)).toEqual({
      format: "json",
      outputPath: null,
      configPath: "cfg.json",
    });
  });

  it("rejects --config as unknown when the spec does not opt in", () => {
    expect(() => parseSubcommandArgs(["--config", "cfg.json"], SPEC)).toThrow(
      /Unknown argument: --config/u,
    );
  });

  it("dispatches subcommand-specific value options", () => {
    const seen: string[] = [];
    const base = parseSubcommandArgs(["--lens", "churn", "--format", "json"], {
      usage: "USAGE-TEXT",
      valueOptions: { "--lens": (value) => seen.push(value) },
    });
    expect(seen).toEqual(["churn"]);
    expect(base.format).toBe("json");
  });

  it("dispatches subcommand-specific path options through non-empty path validation", () => {
    const roots: string[] = [];
    const spec = {
      usage: "USAGE-TEXT",
      pathValueOptions: { "--root": (value: string) => roots.push(value) },
    } as const;

    parseSubcommandArgs(["--root", "src"], spec);

    expect(roots).toEqual(["src"]);
    expect(() => parseSubcommandArgs(["--root="], spec)).toThrow(/--root requires a path/u);
  });

  it("dispatches subcommand-specific valueless flag options without consuming a value", () => {
    const hits: string[] = [];
    const spec = {
      usage: "USAGE-TEXT",
      flagOptions: { "--allow-live-registry": () => hits.push("registry") },
      valueOptions: { "--lens": (value: string) => hits.push(value) },
    } as const;

    const base = parseSubcommandArgs(["--allow-live-registry", "--lens", "churn"], spec);

    expect(hits).toEqual(["registry", "churn"]);
    expect(base.format).toBe("text");
  });

  it("rejects a value attached to a valueless flag option", () => {
    const spec = {
      usage: "USAGE-TEXT",
      flagOptions: { "--allow-live-registry": () => undefined },
    } as const;
    expect(() => parseSubcommandArgs(["--allow-live-registry=yes"], spec)).toThrow(
      "--allow-live-registry does not accept a value.",
    );
  });

  it("rejects an invalid --format value", () => {
    expect(() => parseSubcommandArgs(["--format", "xml"], SPEC)).toThrow(DriftAiError);
  });

  it("errors on a missing value, appending the usage text", () => {
    expect(() => parseSubcommandArgs(["--output"], SPEC)).toThrow(/USAGE-TEXT/u);
  });

  it("errors on an unknown argument", () => {
    expect(() => parseSubcommandArgs(["--nope"], SPEC)).toThrow(/Unknown argument: --nope/u);
  });

  it("throws DriftAiHelp carrying the subcommand usage on --help", () => {
    expect(() => parseSubcommandArgs(["--help"], SPEC)).toThrow(DriftAiHelp);
    try {
      parseSubcommandArgs(["-h"], SPEC);
      throw new Error("expected DriftAiHelp");
    } catch (err) {
      expect(err).toBeInstanceOf(DriftAiHelp);
      expect((err as DriftAiHelp).message).toBe("USAGE-TEXT");
    }
  });
});

describe("writeSubcommandOutput", () => {
  it("returns the rendering for stdout when no --output is set", () => {
    const stdout = writeSubcommandOutput({ format: "text", outputPath: null }, "RENDERED");
    expect(stdout).toBe("RENDERED");
  });

  it("writes to the file and returns a pointer message when --output is set", () => {
    const written: Array<{ path: string; contents: string }> = [];
    const stdout = writeSubcommandOutput(
      { format: "json", outputPath: "report.json" },
      "RENDERED",
      (filePath, contents) => written.push({ path: filePath, contents }),
    );
    expect(stdout).toBe("drift:ai: wrote json report to report.json");
    expect(written).toEqual([{ path: "report.json", contents: "RENDERED\n" }]);
  });
});
