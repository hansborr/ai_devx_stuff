import { describe, expect, it } from "vitest";

import { parseArgs, UsageError } from "./cli.js";

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
