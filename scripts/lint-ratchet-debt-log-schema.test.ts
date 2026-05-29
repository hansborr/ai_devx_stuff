import { describe, expect, it } from "vitest";

import {
  type LintRatchetDebtLogEntry,
  parseLintRatchetDebtLogEntry,
} from "./lint-ratchet/debt-log-schema.js";

const validEntry: LintRatchetDebtLogEntry = {
  version: "1",
  acceptanceReason: "legacy module slated for rewrite next quarter",
  regressions: [
    {
      testId: "ratchet/no-debugger",
      ruleId: "no-debugger",
      path: "packages/server/src/legacy.ts",
      baselineCount: 1,
      currentCount: 2,
      reason: "increased-count",
    },
  ],
  orphansRemoved: [],
};

function asJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("parseLintRatchetDebtLogEntry", () => {
  it("accepts a minimal worse-acceptance entry", () => {
    const result = parseLintRatchetDebtLogEntry(asJson(validEntry));

    expect(result.failures).toEqual([]);
    expect(result.entry).toEqual(validEntry);
  });

  it("accepts complexity orphan snapshots with perFunction rows", () => {
    const entry: LintRatchetDebtLogEntry = {
      version: "1",
      acceptanceReason: "rename ratchet/old-complexity to ratchet/new-complexity",
      regressions: [],
      orphansRemoved: [
        {
          testId: "ratchet/old-complexity",
          ruleId: "complexity",
          metric: "complexity-severity",
          baselineItems: [
            {
              path: "packages/server/src/a.ts",
              count: 1,
              maxComplexity: 18,
              perFunction: [{ line: 12, label: "handler", complexity: 18 }],
            },
          ],
        },
      ],
    };

    const result = parseLintRatchetDebtLogEntry(asJson(entry));

    expect(result.failures).toEqual([]);
    expect(result.entry).toEqual(entry);
  });

  it("accepts effective-line-count orphan snapshots", () => {
    const entry: LintRatchetDebtLogEntry = {
      version: "1",
      acceptanceReason: "remove ratchet/old-lines",
      regressions: [],
      orphansRemoved: [
        {
          testId: "ratchet/old-lines",
          ruleId: "max-lines",
          metric: "effective-line-count",
          baselineItems: [{ path: "packages/client/src/b.ts", count: 1, lines: 240 }],
        },
      ],
    };

    expect(parseLintRatchetDebtLogEntry(asJson(entry)).entry).toEqual(entry);
  });

  it("rejects a non-object", () => {
    expect(parseLintRatchetDebtLogEntry(null).entry).toBeUndefined();
    expect(parseLintRatchetDebtLogEntry("x").failures.length).toBeGreaterThan(0);
  });

  it("rejects an unknown version", () => {
    const result = parseLintRatchetDebtLogEntry(asJson({ ...validEntry, version: "2" }));
    expect(result.entry).toBeUndefined();
    expect(result.failures.join("\n")).toContain("version");
  });

  it("rejects unknown top-level keys", () => {
    const result = parseLintRatchetDebtLogEntry(
      asJson({ ...validEntry, committedAt: "2026-01-01" }),
    );
    expect(result.entry).toBeUndefined();
    expect(result.failures.join("\n")).toContain("committedAt");
  });

  it("rejects an empty or whitespace acceptanceReason", () => {
    expect(
      parseLintRatchetDebtLogEntry(asJson({ ...validEntry, acceptanceReason: "" })).entry,
    ).toBeUndefined();
    expect(
      parseLintRatchetDebtLogEntry(asJson({ ...validEntry, acceptanceReason: "   " })).entry,
    ).toBeUndefined();
  });

  it("rejects a no-op acceptance with no regressions or orphan removals", () => {
    const result = parseLintRatchetDebtLogEntry(
      asJson({
        version: "1",
        acceptanceReason: "looks intentional but records no accepted debt",
        regressions: [],
        orphansRemoved: [],
      }),
    );

    expect(result.entry).toBeUndefined();
    expect(result.failures.join("\n")).toContain("accepted debt");
  });

  it("rejects a regression with an unknown key", () => {
    const result = parseLintRatchetDebtLogEntry(
      asJson({
        ...validEntry,
        regressions: [{ ...validEntry.regressions[0], extra: 1 }],
      }),
    );
    expect(result.entry).toBeUndefined();
    expect(result.failures.join("\n")).toContain("extra");
  });

  it("rejects a regression with an unknown reason", () => {
    const result = parseLintRatchetDebtLogEntry(
      asJson({
        ...validEntry,
        regressions: [{ ...validEntry.regressions[0], reason: "vanished" }],
      }),
    );
    expect(result.entry).toBeUndefined();
    expect(result.failures.join("\n")).toContain("reason");
  });

  it("rejects a regression missing a required field", () => {
    const result = parseLintRatchetDebtLogEntry(
      asJson({
        ...validEntry,
        regressions: [
          {
            testId: "ratchet/no-debugger",
            ruleId: "no-debugger",
            baselineCount: 1,
            currentCount: 2,
            reason: "increased-count",
          },
        ],
      }),
    );
    expect(result.entry).toBeUndefined();
    expect(result.failures.join("\n")).toContain("path");
  });

  it("rejects a regression with a non-normalized path", () => {
    const result = parseLintRatchetDebtLogEntry(
      asJson({
        ...validEntry,
        regressions: [{ ...validEntry.regressions[0], path: "./packages/server/src/legacy.ts" }],
      }),
    );

    expect(result.entry).toBeUndefined();
    expect(result.failures.join("\n")).toContain("path must be normalized");
  });

  it("rejects a regression with a non-integer optional line", () => {
    const result = parseLintRatchetDebtLogEntry(
      asJson({ ...validEntry, regressions: [{ ...validEntry.regressions[0], line: 1.5 }] }),
    );
    expect(result.entry).toBeUndefined();
    expect(result.failures.join("\n")).toContain("line");
  });

  it("rejects an orphan with an unknown metric", () => {
    const result = parseLintRatchetDebtLogEntry(
      asJson({
        ...validEntry,
        orphansRemoved: [
          { testId: "ratchet/x", ruleId: "complexity", metric: "bogus", baselineItems: [] },
        ],
      }),
    );
    expect(result.entry).toBeUndefined();
    expect(result.failures.join("\n")).toContain("metric");
  });

  it("rejects a malformed orphan baseline item", () => {
    const result = parseLintRatchetDebtLogEntry(
      asJson({
        ...validEntry,
        orphansRemoved: [
          {
            testId: "ratchet/x",
            ruleId: "no-debugger",
            metric: "message-count",
            baselineItems: [{ path: "packages/server/src/a.ts", count: -1 }],
          },
        ],
      }),
    );
    expect(result.entry).toBeUndefined();
    expect(result.failures.join("\n")).toContain("count");
  });

  it("rejects an orphan baseline item with a non-normalized path", () => {
    const result = parseLintRatchetDebtLogEntry(
      asJson({
        ...validEntry,
        orphansRemoved: [
          {
            testId: "ratchet/x",
            ruleId: "no-debugger",
            metric: "message-count",
            baselineItems: [{ path: "packages\\server\\src\\a.ts", count: 1 }],
          },
        ],
      }),
    );

    expect(result.entry).toBeUndefined();
    expect(result.failures.join("\n")).toContain("path must be normalized");
  });

  it("rejects orphan baseline items that do not match their metric", () => {
    const result = parseLintRatchetDebtLogEntry(
      asJson({
        ...validEntry,
        orphansRemoved: [
          {
            testId: "ratchet/x",
            ruleId: "max-lines",
            metric: "effective-line-count",
            baselineItems: [{ path: "packages/server/src/a.ts", count: 1 }],
          },
        ],
      }),
    );

    expect(result.entry).toBeUndefined();
    expect(result.failures.join("\n")).toContain("lines is required for effective-line-count");
  });

  it("rejects an unknown key inside an orphan perFunction row", () => {
    const result = parseLintRatchetDebtLogEntry(
      asJson({
        ...validEntry,
        orphansRemoved: [
          {
            testId: "ratchet/x",
            ruleId: "complexity",
            metric: "complexity-severity",
            baselineItems: [
              {
                path: "packages/server/src/a.ts",
                count: 1,
                maxComplexity: 12,
                perFunction: [{ line: 3, label: "fn", complexity: 12, extra: true }],
              },
            ],
          },
        ],
      }),
    );
    expect(result.entry).toBeUndefined();
    expect(result.failures.join("\n")).toContain("extra");
  });

  it("rejects an orphan baseline item with an unknown key", () => {
    const result = parseLintRatchetDebtLogEntry(
      asJson({
        ...validEntry,
        orphansRemoved: [
          {
            testId: "ratchet/x",
            ruleId: "no-debugger",
            metric: "message-count",
            baselineItems: [{ path: "packages/server/src/a.ts", count: 1, weird: true }],
          },
        ],
      }),
    );
    expect(result.entry).toBeUndefined();
    expect(result.failures.join("\n")).toContain("weird");
  });
});
