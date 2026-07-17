import { describe, expect, it } from "vitest";

import { parseArgs, UsageError } from "./cli.js";

describe("parseArgs --check-debt-accounting", () => {
  it("parses the baseline debt-accounting mode", () => {
    const parsed = parseArgs(["--check-debt-accounting"]);
    expect(parsed.mode).toBe("check-debt-accounting");
  });

  it("parses staged and custom-base accounting options", () => {
    const parsed = parseArgs([
      "--check-debt-accounting",
      "--staged",
      "--base-ref",
      "upstream/trunk",
    ]);
    expect(parsed.debtAccountingStaged).toBe(true);
    expect(parsed.debtAccountingBaseRef).toBe("upstream/trunk");
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

  it("parses an attested different-options retirement", () => {
    const parsed = parseArgs([
      "--update",
      "--retire-ratchet",
      "ratchet/old",
      "--accept-different-options",
      "--reason",
      "normal lint uses a lower maximum than the drained ratchet",
    ]);

    expect(parsed.acceptDifferentOptions).toBe(true);
    expect(parsed.reason).toContain("lower maximum");
  });

  it("requires a retire id and reason for --accept-different-options", () => {
    expect(() =>
      parseArgs(["--update", "--accept-different-options", "--reason", "reviewed options"]),
    ).toThrow("requires --retire-ratchet");
    expect(() =>
      parseArgs(["--update", "--retire-ratchet", "ratchet/old", "--accept-different-options"]),
    ).toThrow("requires --reason");
  });
});

describe("parseArgs --migration-reason", () => {
  it("parses --migration-reason alongside --reason in an update", () => {
    const parsed = parseArgs([
      "--update",
      "--allow-worse",
      "--reason",
      "accept the extra finding surfaced during the migration",
      "--migration-reason",
      "effective line count is the right measure for this rule",
    ]);
    expect(parsed.reason).toBe("accept the extra finding surfaced during the migration");
    expect(parsed.migrationReason).toBe("effective line count is the right measure for this rule");
  });

  it("parses the --migration-reason=<why> form", () => {
    const parsed = parseArgs([
      "--update",
      "--migration-reason=effective line count is the right measure",
    ]);
    expect(parsed.migrationReason).toBe("effective line count is the right measure");
  });

  it("requires a non-flag argument after --migration-reason", () => {
    expect(() => parseArgs(["--update", "--migration-reason"])).toThrow(UsageError);
    expect(() => parseArgs(["--update", "--migration-reason", "--allow-worse"])).toThrow(
      UsageError,
    );
  });

  it("rejects --migration-reason outside --update", () => {
    expect(() => parseArgs(["--summary", "--migration-reason", "x"])).toThrow(
      "--migration-reason is only valid with --update",
    );
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
    const parsed = parseArgs(["--trend", "--since", "2026-01-01", "--max", "25", "--all"]);

    expect(parsed.mode).toBe("trend");
    expect(parsed.trendSince).toBe("2026-01-01");
    expect(parsed.trendMax).toBe(25);
    expect(parsed.trendAll).toBe(true);
  });

  it("rejects trend-only flags outside trend mode and invalid max values", () => {
    expect(() => parseArgs(["--summary", "--since", "2026-01-01"])).toThrow(
      "--since is only valid with --trend",
    );
    expect(() => parseArgs(["--trend", "--max", "0"])).toThrow("--max requires a positive integer");
    expect(() => parseArgs(["--summary", "--all"])).toThrow("--all is only valid with --trend");
  });
});

describe("parseArgs inline-value rejection", () => {
  it("still accepts the inline --reason= form", () => {
    expect(parseArgs(["--update", "--reason=because"]).reason).toBe("because");
  });

  it("rejects an inline value on a mode flag", () => {
    expect(() => parseArgs(["--summary=false"])).toThrow("Unknown argument: --summary=false");
  });

  it("rejects an inline value on a boolean flag rather than inverting it", () => {
    expect(() => parseArgs(["--update", "--allow-worse=false", "--reason", "x"])).toThrow(
      "Unknown argument: --allow-worse=false",
    );
  });

  it("rejects an inline value on a non-reason string flag", () => {
    expect(() => parseArgs(["--check-debt-accounting", "--base-ref=x"])).toThrow(
      "Unknown argument: --base-ref=x",
    );
  });

  it("reports the original argv token for unknown flags", () => {
    expect(() => parseArgs(["-x"])).toThrow("Unknown argument: -x");
    expect(() => parseArgs(["--bogus=value"])).toThrow("Unknown argument: --bogus=value");
  });
});

describe("parseArgs -- separator", () => {
  it("does not let a value flag bind across a -- separator", () => {
    expect(() => parseArgs(["--update", "--allow-worse", "--reason", "--", "accepted"])).toThrow(
      "--reason requires a non-empty argument",
    );
  });

  it("does not treat a post-separator token as a --by-directory depth", () => {
    expect(() => parseArgs(["--summary", "--by-directory", "--", "2"])).toThrow(
      "Unknown argument: 2",
    );
  });
});
