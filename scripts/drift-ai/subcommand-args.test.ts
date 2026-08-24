import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { ParsedCli } from "../lib/cli.js";
import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import { DriftAiHelp } from "./cli-args.js";
import { DriftAiError } from "./errors.js";
import {
  CONFIG_CLI_OPTION,
  configSchemaShape,
  parseSubcommandCli,
  prepareSubcommandInputs,
  SUBCOMMAND_BASE_CLI_OPTIONS,
  subcommandBaseFromOptions,
  subcommandBaseSchemaShape,
  subcommandBooleanFlag,
  writeSubcommandOutput,
} from "./subcommand-args.js";

function thrownMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected function to throw");
}

describe("parseSubcommandCli", () => {
  const baseSchema = z.object({ ...subcommandBaseSchemaShape });
  const configSchema = z.object({ ...subcommandBaseSchemaShape, ...configSchemaShape });

  function parseBase(argv: readonly string[]): ParsedCli<z.output<typeof baseSchema>> {
    return parseSubcommandCli({
      argv,
      usage: "USAGE-TEXT",
      options: SUBCOMMAND_BASE_CLI_OPTIONS,
      schema: baseSchema,
    });
  }

  it("assembles the text-format default base with no output or config path", () => {
    expect(subcommandBaseFromOptions(parseBase([]).options)).toEqual({
      format: "text",
      outputPath: null,
      configPath: null,
    });
  });

  it("parses --format and --output (space- and equals-separated)", () => {
    const { options } = parseBase(["--format", "json", "--output=out.json"]);
    expect(subcommandBaseFromOptions(options)).toEqual({
      format: "json",
      outputPath: "out.json",
      configPath: null,
    });
  });

  it("accepts --config only when the spec composes the config fragment", () => {
    const { options } = parseSubcommandCli({
      argv: ["--format=json", "--config=cfg.json"],
      usage: "USAGE-TEXT",
      options: [...SUBCOMMAND_BASE_CLI_OPTIONS, CONFIG_CLI_OPTION],
      schema: configSchema,
    });
    expect(subcommandBaseFromOptions(options)).toEqual({
      format: "json",
      outputPath: null,
      configPath: "cfg.json",
    });
    expect(() => parseBase(["--config", "cfg.json"])).toThrow(/Unknown argument: --config/u);
  });

  it("rejects a value attached to a subcommandBooleanFlag option", () => {
    const spec = {
      usage: "USAGE-TEXT",
      options: [...SUBCOMMAND_BASE_CLI_OPTIONS, subcommandBooleanFlag("--allow-live-registry")],
      schema: z.object({
        ...subcommandBaseSchemaShape,
        "--allow-live-registry": z.boolean().default(false),
      }),
    } as const;
    const { options } = parseSubcommandCli({ ...spec, argv: ["--allow-live-registry"] });
    expect(options["--allow-live-registry"]).toBe(true);
    expect(() => parseSubcommandCli({ ...spec, argv: ["--allow-live-registry=yes"] })).toThrow(
      "--allow-live-registry does not accept a value.",
    );
  });

  it("rejects an invalid --format value with a DriftAiError", () => {
    expect(() => parseBase(["--format", "xml"])).toThrow(DriftAiError);
    expect(() => parseBase(["--format", "xml"])).toThrow("--format requires text or json.");
  });

  it("rejects option-looking values for value options", () => {
    expect(() => parseBase(["--format", "--output", "out.json"])).toThrow(
      /--format requires a value/u,
    );
    expect(() => parseBase(["--output", "--format", "json"])).toThrow(/--output requires a value/u);
  });

  it("errors on a missing value, appending the usage text", () => {
    expect(() => parseBase(["--output"])).toThrow(/USAGE-TEXT/u);
  });

  it("errors on unknown arguments and rejects positionals at their token", () => {
    expect(() => parseBase(["--nope"])).toThrow(/Unknown argument: --nope/u);
    expect(thrownMessage(() => parseBase(["stray"]))).toBe("Unknown argument: stray\nUSAGE-TEXT");
  });

  it("preserves empty string argv entries as unknown arguments", () => {
    expect(thrownMessage(() => parseBase([""]))).toBe("Unknown argument: \nUSAGE-TEXT");
  });

  it("throws DriftAiHelp carrying the subcommand usage on --help", () => {
    expect(() => parseBase(["--help"])).toThrow(DriftAiHelp);
    try {
      parseBase(["-h"]);
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

describe("prepareSubcommandInputs", () => {
  const tmp = registerTempRootCleanup();
  const base = { format: "text", outputPath: null, configPath: null } as const;
  const failingRead = (path: string): string => {
    throw new Error(`unexpected read of ${path}`);
  };

  it("loads the default config and a null baseline when neither flag is given", () => {
    const repoRoot = tmp.makeTempRepo();
    const prepared = prepareSubcommandInputs({ base, baselinePath: null }, repoRoot, failingRead);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error("expected ok inputs");
    expect(prepared.config.configPath).toBeNull();
    expect(prepared.baseline).toBeNull();
  });

  it("loads and JSON-parses the baseline through the injected reader", () => {
    const repoRoot = tmp.makeTempRepo();
    const prepared = prepareSubcommandInputs(
      { base, baselinePath: "prev.json" },
      repoRoot,
      () => '{"rows":[]}',
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error("expected ok inputs");
    expect(prepared.baseline).toEqual({ rows: [] });
  });

  it("maps a missing --config file to the standard exit-2 result", () => {
    const repoRoot = tmp.makeTempRepo();
    const prepared = prepareSubcommandInputs(
      { base: { ...base, configPath: "no-such-config.json" }, baselinePath: null },
      repoRoot,
      failingRead,
    );
    expect(prepared.ok).toBe(false);
    if (prepared.ok) throw new Error("expected a failure result");
    expect(prepared.result.exitCode).toBe(2);
    expect(prepared.result.stdout).toContain("does not exist");
  });

  it("maps an invalid --baseline file to the standard exit-2 result", () => {
    const repoRoot = tmp.makeTempRepo();
    const prepared = prepareSubcommandInputs(
      { base, baselinePath: "prev.json" },
      repoRoot,
      () => "not json",
    );
    expect(prepared.ok).toBe(false);
    if (prepared.ok) throw new Error("expected a failure result");
    expect(prepared.result.exitCode).toBe(2);
    expect(prepared.result.stdout).toContain("not valid JSON");
  });
});
