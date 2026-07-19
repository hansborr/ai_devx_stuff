import { describe, expect, it } from "vitest";

import {
  isNearDuplicatesHelpFlag,
  parseNearDuplicatesArgs,
} from "./sensor-near-duplicates-cli-options.js";

// Characterization tests (arch-plans-2026-07 leaf 02, S0): these pin the
// CURRENT parser contract before any migration onto parseCli(spec). Notable
// pinned quirks: the inline `=` form is accepted only for --baseline, help
// anywhere yields ok:false carrying the usage text (the entrypoint maps it to
// exit 0 only when it is argv[0]), and the unknown-argument scan skips the
// token after a separate-form value flag but not after an inline-form one.

function errorOf(argv: readonly string[]): string {
  const parsed = parseNearDuplicatesArgs(argv);
  if (parsed.ok) throw new Error(`expected a parse failure for: ${argv.join(" ")}`);
  return parsed.error;
}

function usageText(): string {
  return errorOf(["--help"]);
}

describe("parseNearDuplicatesArgs", () => {
  it("defaults to check mode with the default baseline path", () => {
    expect(parseNearDuplicatesArgs([])).toEqual({
      ok: true,
      value: {
        baselinePath: "sensor-near-duplicates.baseline.json",
        update: false,
        checkBaseline: false,
        restoreMergeTruth: false,
      },
    });
  });

  it("sets each boolean mode flag", () => {
    const update = parseNearDuplicatesArgs(["--update"]);
    expect(update.ok && update.value.update).toBe(true);
    const check = parseNearDuplicatesArgs(["--check-baseline"]);
    expect(check.ok && check.value.checkBaseline).toBe(true);
    const restore = parseNearDuplicatesArgs(["--restore-merge-truth"]);
    expect(restore.ok && restore.value.restoreMergeTruth).toBe(true);
  });

  it("rejects combined operating modes", () => {
    expect(errorOf(["--update", "--check-baseline"])).toBe(
      "baseline operating modes cannot be combined.",
    );
    expect(errorOf(["--update", "--admit", "id", "--reason", "why"])).toBe(
      "baseline operating modes cannot be combined.",
    );
  });

  it("reads --baseline in both the separate and inline forms", () => {
    const separate = parseNearDuplicatesArgs(["--baseline", "custom.json"]);
    expect(separate.ok && separate.value.baselinePath).toBe("custom.json");
    const inline = parseNearDuplicatesArgs(["--baseline=inline.json"]);
    expect(inline.ok && inline.value.baselinePath).toBe("inline.json");
  });

  it("prefers the separate --baseline value when both forms appear", () => {
    const parsed = parseNearDuplicatesArgs(["--baseline=inline.json", "--baseline", "sep.json"]);
    expect(parsed.ok && parsed.value.baselinePath).toBe("sep.json");
  });

  it("silently falls back to the default path for a trailing bare --baseline", () => {
    // Quirk: only an option-like (or empty) next token errors; a --baseline at
    // the end of argv reads as "no value given" and keeps the default path.
    const parsed = parseNearDuplicatesArgs(["--baseline"]);
    expect(parsed.ok && parsed.value.baselinePath).toBe("sensor-near-duplicates.baseline.json");
  });

  it("rejects --baseline with an option-like value", () => {
    expect(errorOf(["--baseline", "--update"])).toBe("--baseline requires a path.");
  });

  it("accepts the inline form only for --baseline", () => {
    expect(errorOf(["--admit=identity"])).toBe(
      `Unknown argument: --admit=identity\n${usageText()}`,
    );
    expect(errorOf(["--update=1"])).toBe(`Unknown argument: --update=1\n${usageText()}`);
  });

  it("parses a paired --admit/--reason admission and trims the reason", () => {
    const parsed = parseNearDuplicatesArgs(["--admit", "src/a.ts|src/b.ts", "--reason", " ok "]);
    expect(parsed).toEqual({
      ok: true,
      value: {
        baselinePath: "sensor-near-duplicates.baseline.json",
        update: false,
        checkBaseline: false,
        restoreMergeTruth: false,
        admission: { identity: "src/a.ts|src/b.ts", reason: "ok" },
      },
    });
  });

  it("rejects an unpaired or malformed admission", () => {
    expect(errorOf(["--admit", "id"])).toBe("--admit requires --reason <text>.");
    expect(errorOf(["--reason", "why"])).toBe("--reason requires --admit <identity>.");
    expect(errorOf(["--admit", "--update", "--reason", "why"])).toBe(
      "--admit requires an identity.",
    );
    expect(errorOf(["--admit", "id", "--reason", "   "])).toBe("--reason requires non-empty text.");
  });

  it("reports admission pairing errors before mode-combination errors", () => {
    expect(errorOf(["--update", "--admit", "id"])).toBe("--admit requires --reason <text>.");
  });

  it("returns the usage text as a parse failure for help flags anywhere", () => {
    for (const argv of [["--help"], ["-h"], ["--update", "--help"]]) {
      const parsed = parseNearDuplicatesArgs(argv);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error.startsWith("Usage:")).toBe(true);
    }
  });

  it("rejects unknown arguments, positionals, and empty args with the usage appended", () => {
    expect(errorOf(["--nope"])).toBe(`Unknown argument: --nope\n${usageText()}`);
    expect(errorOf(["positional"])).toBe(`Unknown argument: positional\n${usageText()}`);
    expect(errorOf([""])).toBe(`Unknown argument: \n${usageText()}`);
  });

  it("skips the token after a separate-form value flag in the unknown scan only", () => {
    expect(parseNearDuplicatesArgs(["--baseline", "anything-goes-here"]).ok).toBe(true);
    expect(errorOf(["--baseline=inline.json", "stray"])).toBe(
      `Unknown argument: stray\n${usageText()}`,
    );
  });
});

describe("isNearDuplicatesHelpFlag", () => {
  it("recognizes only --help and -h, tolerating undefined", () => {
    expect(isNearDuplicatesHelpFlag("--help")).toBe(true);
    expect(isNearDuplicatesHelpFlag("-h")).toBe(true);
    expect(isNearDuplicatesHelpFlag("--update")).toBe(false);
    expect(isNearDuplicatesHelpFlag(undefined)).toBe(false);
  });
});
