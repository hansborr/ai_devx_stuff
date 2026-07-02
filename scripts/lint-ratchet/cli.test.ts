import { describe, expect, it } from "vitest";

import { parseArgs, UsageError } from "./cli.js";

describe("parseArgs --check-debt-accounting", () => {
  it("parses the baseline debt-accounting mode", () => {
    const parsed = parseArgs(["--check-debt-accounting"]);
    expect(parsed.mode).toBe("check-debt-accounting");
  });
});

describe("parseArgs --retire-ratchet", () => {
  it("parses --retire-ratchet <id> with --update", () => {
    const parsed = parseArgs(["--update", "--retire-ratchet", "ratchet/old-promoted"]);
    expect(parsed.mode).toBe("update");
    expect(parsed.retireRatchetId).toBe("ratchet/old-promoted");
    expect(parsed.allowWorse).toBe(false);
  });

  it("requires a non-flag argument after --retire-ratchet", () => {
    expect(() => parseArgs(["--update", "--retire-ratchet"])).toThrow(UsageError);
    expect(() => parseArgs(["--update", "--retire-ratchet", "--allow-worse"])).toThrow(UsageError);
  });

  it("rejects --retire-ratchet outside --update", () => {
    expect(() => parseArgs(["--summary", "--retire-ratchet", "ratchet/old"])).toThrow(
      "--retire-ratchet is only valid with --update",
    );
  });

  it("rejects combining --retire-ratchet with --allow-worse", () => {
    expect(() =>
      parseArgs(["--update", "--retire-ratchet", "ratchet/old", "--allow-worse", "--reason", "x"]),
    ).toThrow("--retire-ratchet and --allow-worse are mutually exclusive");
  });

  it("omits retireRatchetId when the flag is absent", () => {
    const parsed = parseArgs(["--update"]);
    expect(parsed.retireRatchetId).toBeUndefined();
  });
});

describe("parseArgs --propose", () => {
  it("parses the proposed rule id and file globs", () => {
    const parsed = parseArgs(["--propose", "no-debugger", "packages/app/src/**/*.ts"]);

    expect(parsed.mode).toBe("propose");
    expect(parsed.proposeRuleId).toBe("no-debugger");
    expect(parsed.proposeFiles).toEqual(["packages/app/src/**/*.ts"]);
  });

  it("parses propose ignore, metric, and rule option flags", () => {
    const parsed = parseArgs([
      "--propose",
      "no-restricted-syntax",
      "packages/app/src/**/*.ts",
      "--ignore",
      "packages/app/src/**/*.test.ts",
      "--metric=message-count",
      "--rule-options",
      '[{"selector":"DebuggerStatement","message":"no debugger"}]',
    ]);

    expect(parsed.proposeIgnores).toEqual(["packages/app/src/**/*.test.ts"]);
    expect(parsed.proposeMetric).toBe("message-count");
    expect(parsed.proposeRuleOptionsJson).toBe(
      '[{"selector":"DebuggerStatement","message":"no debugger"}]',
    );
  });

  it("requires a rule id and at least one file glob", () => {
    expect(() => parseArgs(["--propose"])).toThrow("--propose requires <ruleId> <glob...>");
    expect(() => parseArgs(["--propose", "no-debugger"])).toThrow(
      "--propose requires <ruleId> <glob...>",
    );
    expect(() => parseArgs(["--propose", "--summary", "packages/**/*.ts"])).toThrow(
      "--propose requires <ruleId> <glob...>",
    );
    expect(() => parseArgs(["--propose", "no-debugger", "--plugin", "eslint-plugin-x"])).toThrow(
      "Unknown --propose option: --plugin",
    );
  });

  it("rejects mixing --propose with another mode", () => {
    expect(() => parseArgs(["--summary", "--propose", "no-debugger", "packages/**/*.ts"])).toThrow(
      "choose only one mode",
    );
  });
});

describe("parseArgs --summary --by-directory", () => {
  it("parses summary directory grouping with the default depth", () => {
    const parsed = parseArgs(["--summary", "--by-directory"]);

    expect(parsed.mode).toBe("summary");
    expect(parsed.summaryByDirectoryDepth).toBe(3);
  });

  it("parses an explicit directory grouping depth", () => {
    const parsed = parseArgs(["--summary", "--by-directory", "2"]);

    expect(parsed.mode).toBe("summary");
    expect(parsed.summaryByDirectoryDepth).toBe(2);
  });

  it("rejects directory grouping outside summary mode and invalid depths", () => {
    expect(() => parseArgs(["--by-directory"])).toThrow(
      "--by-directory is only valid with --summary",
    );
    expect(() => parseArgs(["--summary", "--by-directory", "0"])).toThrow(
      "--by-directory depth must be a positive integer",
    );
  });
});

describe("parseArgs --trend", () => {
  it("parses trend mode with optional history filters", () => {
    const parsed = parseArgs(["--trend", "--since", "2026-01-01", "--max", "25"]);

    expect(parsed.mode).toBe("trend");
    expect(parsed.trendSince).toBe("2026-01-01");
    expect(parsed.trendMax).toBe(25);
  });

  it("rejects trend-only flags outside trend mode and invalid max values", () => {
    expect(() => parseArgs(["--summary", "--since", "2026-01-01"])).toThrow(
      "--since is only valid with --trend",
    );
    expect(() => parseArgs(["--trend", "--max", "0"])).toThrow("--max requires a positive integer");
  });
});
