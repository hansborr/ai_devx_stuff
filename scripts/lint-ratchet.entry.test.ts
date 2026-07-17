import { describe, expect, it } from "vitest";

import { classifyScriptEntry, parseConcurrencyEnvValue } from "./lint-ratchet.js";

// A fake path/URL plumbing so the symlink-realpath branch is exercised without
// touching the filesystem. `realpaths` maps a resolved path to its real target;
// unmapped paths realpath to themselves.
interface FakeProbe {
  readonly resolvePath: (path: string) => string;
  readonly realpath: (path: string) => string;
  readonly toHref: (path: string) => string;
}

function probe(realpaths: Record<string, string> = {}): FakeProbe {
  return {
    resolvePath: (path: string) => path,
    realpath: (path: string) => realpaths[path] ?? path,
    toHref: (path: string) => `file://${path}`,
  };
}

const BASENAME = "lint-ratchet.ts";

describe("classifyScriptEntry", () => {
  it("runs when argv[1] resolves directly to the module URL", () => {
    expect(
      classifyScriptEntry(
        "/repo/scripts/lint-ratchet.ts",
        "file:///repo/scripts/lint-ratchet.ts",
        BASENAME,
        probe(),
      ),
    ).toBe("run");
  });

  it("runs when argv[1] is a symlink that realpaths to the module URL", () => {
    // Node realpaths the entry module URL; resolve(argv[1]) does not. The
    // realpathed candidate must still match so a symlinked checkout works.
    const result = classifyScriptEntry(
      "/link/lint-ratchet.ts",
      "file:///real/lint-ratchet.ts",
      BASENAME,
      probe({ "/link/lint-ratchet.ts": "/real/lint-ratchet.ts" }),
    );
    expect(result).toBe("run");
  });

  it("reports a mismatch when argv[1] names this script but no candidate matches", () => {
    expect(
      classifyScriptEntry(
        "/somewhere/lint-ratchet.ts",
        "file:///elsewhere/lint-ratchet.ts",
        BASENAME,
        probe(),
      ),
    ).toBe("mismatch");
  });

  it("skips silently when imported under a different entry basename", () => {
    expect(
      classifyScriptEntry(
        "/repo/node_modules/vitest/vitest.mjs",
        "file:///repo/scripts/lint-ratchet.ts",
        BASENAME,
        probe(),
      ),
    ).toBe("skip");
  });

  it("skips silently when there is no argv[1]", () => {
    expect(
      classifyScriptEntry(undefined, "file:///repo/scripts/lint-ratchet.ts", BASENAME, probe()),
    ).toBe("skip");
  });

  it("still classifies when realpath throws (deleted path) via the unresolved form", () => {
    const throwingProbe = {
      resolvePath: (path: string) => path,
      realpath: () => {
        throw new Error("ENOENT");
      },
      toHref: (path: string) => `file://${path}`,
    };
    expect(
      classifyScriptEntry(
        "/repo/scripts/lint-ratchet.ts",
        "file:///repo/scripts/lint-ratchet.ts",
        BASENAME,
        throwingProbe,
      ),
    ).toBe("run");
  });
});

describe("parseConcurrencyEnvValue", () => {
  it("returns the parsed integer for a clean value", () => {
    expect(parseConcurrencyEnvValue("4", "AI_RATCHET_COLLECT_CONCURRENCY", 1)).toBe(4);
  });

  it("treats unset and empty as the default (undefined)", () => {
    expect(parseConcurrencyEnvValue(undefined, "X", 1)).toBeUndefined();
    expect(parseConcurrencyEnvValue("", "X", 1)).toBeUndefined();
  });

  it("throws on garbage instead of silently defaulting", () => {
    // parseInt would accept "3junk" as 3 and read "1O" (letter O) as 1.
    expect(() => parseConcurrencyEnvValue("3junk", "X", 1)).toThrow(/X=3junk is not a valid/u);
    expect(() => parseConcurrencyEnvValue("1O", "X", 1)).toThrow(/X=1O is not a valid/u);
    expect(() => parseConcurrencyEnvValue("junk", "X", 1)).toThrow(/is not a valid/u);
    expect(() => parseConcurrencyEnvValue("-1", "X", 1)).toThrow(/is not a valid/u);
  });

  it("throws on a below-minimum value", () => {
    expect(() => parseConcurrencyEnvValue("0", "X", 1)).toThrow(/X=0 is below the minimum/u);
  });
});
