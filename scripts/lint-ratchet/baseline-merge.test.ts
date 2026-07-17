import { describe, expect, it } from "vitest";

import type { LintRatchetBaseline } from "./baseline.js";
import { LINT_RATCHET_BASELINE_VERSION } from "./baseline-constants.js";
import type { LintRatchetBaselineTest } from "./baseline-format.js";
import { formatLintRatchetBaseline } from "./baseline-format.js";
import { mergeLintRatchetBaselines } from "./baseline-merge.js";
import type { LintRatchetComplexityFunction } from "./metrics.js";
import type { LintRatchetMetricItem } from "./metrics-types.js";

const CONFIG_HASH = `sha256:${"a".repeat(64)}`;
const RULE_SOURCE_HASH = `sha256:${"b".repeat(64)}`;
const MESSAGE_FINGERPRINT_A = `sha256:${"c".repeat(64)}`;
const MESSAGE_FINGERPRINT_B = `sha256:${"d".repeat(64)}`;

type MessageItemFixture = number | LintRatchetMetricItem;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageBaseline(
  tests: Readonly<Record<string, Readonly<Record<string, MessageItemFixture>>>>,
): LintRatchetBaseline {
  const baselineTests: Record<string, LintRatchetBaselineTest> = {};
  for (const [testId, items] of Object.entries(tests)) {
    const baselineItems: Record<string, LintRatchetMetricItem> = {};
    for (const [path, item] of Object.entries(items)) {
      baselineItems[path] = typeof item === "number" ? { count: item } : item;
    }
    baselineTests[testId] = {
      ruleId: "local/example-rule",
      mode: "no-new",
      metric: "message-count",
      files: ["packages/**/*.ts"],
      ignores: [],
      ruleOptions: [],
      configHash: CONFIG_HASH,
      ruleSourceHash: RULE_SOURCE_HASH,
      items: baselineItems,
    };
  }
  return { version: LINT_RATCHET_BASELINE_VERSION, tests: baselineTests };
}

function requireBaselineTest(
  baseline: LintRatchetBaseline,
  testId: string,
): LintRatchetBaselineTest {
  const test = baseline.tests[testId];
  if (test === undefined) throw new Error(`missing test fixture: ${testId}`);
  return test;
}

function complexityFunction(
  line: number,
  label: string,
  complexity: number,
): LintRatchetComplexityFunction {
  return { line, label, complexity };
}

function complexityBaseline(
  path: string,
  perFunction: readonly LintRatchetComplexityFunction[],
): LintRatchetBaseline {
  return {
    version: LINT_RATCHET_BASELINE_VERSION,
    tests: {
      "ratchet/fixture-complexity": {
        ruleId: "complexity",
        mode: "no-new",
        metric: "complexity-severity",
        files: ["packages/**/*.ts"],
        ignores: [],
        ruleOptions: [{ max: 10 }],
        configHash: CONFIG_HASH,
        ruleSourceHash: RULE_SOURCE_HASH,
        items: {
          [path]: {
            count: perFunction.length,
            maxComplexity: Math.max(...perFunction.map((entry) => entry.complexity)),
            perFunction,
          },
        },
      },
    },
  };
}

function maxLinesBaseline(path: string, lines: number, count = 1): LintRatchetBaseline {
  return {
    version: LINT_RATCHET_BASELINE_VERSION,
    tests: {
      "ratchet/local-max-lines-fixture": {
        ruleId: "local/max-lines",
        mode: "no-new",
        metric: "effective-line-count",
        files: ["packages/**/*.ts"],
        ignores: [],
        ruleOptions: [],
        configHash: CONFIG_HASH,
        ruleSourceHash: RULE_SOURCE_HASH,
        items: { [path]: { count, lines } },
      },
    },
  };
}

function mergeResult(
  base: LintRatchetBaseline,
  current: LintRatchetBaseline,
  other: LintRatchetBaseline,
): ReturnType<typeof mergeLintRatchetBaselines> {
  return mergeLintRatchetBaselines({
    baseText: formatLintRatchetBaseline(base),
    currentText: formatLintRatchetBaseline(current),
    otherText: formatLintRatchetBaseline(other),
  });
}

function baselineTextWithoutRuleSourceHash(baseline: LintRatchetBaseline): string {
  const parsed: unknown = JSON.parse(formatLintRatchetBaseline(baseline));
  if (!isRecord(parsed) || !isRecord(parsed.tests)) {
    throw new Error("expected baseline object fixture");
  }
  const test = parsed.tests["ratchet/fixture-one"];
  if (!isRecord(test)) throw new Error("expected baseline test fixture");
  delete test.ruleSourceHash;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

describe("lint ratchet baseline semantic merge", () => {
  it("keeps independent one-sided ratchet entry changes from both sides", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/one.ts": 4 },
      "ratchet/fixture-two": { "packages/client/src/two.tsx": 6 },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/one.ts": 2 },
      "ratchet/fixture-two": { "packages/client/src/two.tsx": 6 },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/one.ts": 4 },
      "ratchet/fixture-two": { "packages/client/src/two.tsx": 3 },
    });

    const result = mergeResult(base, current, other);

    expect(result.failures).toEqual([]);
    expect(result.mergedText).toBe(
      formatLintRatchetBaseline(
        messageBaseline({
          "ratchet/fixture-one": { "packages/server/src/one.ts": 2 },
          "ratchet/fixture-two": { "packages/client/src/two.tsx": 3 },
        }),
      ),
    );
  });

  it("merges same-ratchet item conflicts by taking minimum floors and treating missing as drained", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/drained-by-current.ts": 5,
        "packages/server/src/drained-by-other.ts": 7,
        "packages/server/src/shared.ts": 8,
      },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/drained-by-other.ts": 7,
        "packages/server/src/shared.ts": 4,
      },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/drained-by-current.ts": 5,
        "packages/server/src/shared.ts": 6,
      },
    });

    const result = mergeResult(base, current, other);

    expect(result.failures).toEqual([]);
    expect(result.postMergeTruthUpRequired).toBe(true);
    expect(result.mergedText).toBe(
      formatLintRatchetBaseline(
        messageBaseline({
          "ratchet/fixture-one": { "packages/server/src/shared.ts": 4 },
        }),
      ),
    );
  });

  it("keeps an item added on one side without requesting truth-up", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 5 },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/added.ts": 2,
        "packages/server/src/shared.ts": 4,
      },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 4 },
    });

    const result = mergeResult(base, current, other);

    expect(result.failures).toEqual([]);
    expect(result.postMergeTruthUpRequired).toBe(false);
    expect(result.mergedText).toBe(formatLintRatchetBaseline(current));
  });

  it("drops an item drained on one side and requests truth-up", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/drained.ts": 2,
        "packages/server/src/shared.ts": 5,
      },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 4 },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/drained.ts": 2,
        "packages/server/src/shared.ts": 4,
      },
    });

    const result = mergeResult(base, current, other);

    expect(result.failures).toEqual([]);
    expect(result.postMergeTruthUpRequired).toBe(true);
    expect(result.mergedText).toBe(formatLintRatchetBaseline(current));
  });

  it("takes the minimum when both sides add the same item", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 5 },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/added.ts": 3,
        "packages/server/src/shared.ts": 4,
      },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/added.ts": 2,
        "packages/server/src/shared.ts": 4,
      },
    });

    const result = mergeResult(base, current, other);

    expect(result.failures).toEqual([]);
    expect(result.postMergeTruthUpRequired).toBe(true);
    expect(result.mergedText).toBe(formatLintRatchetBaseline(other));
  });

  it("uses item-level base semantics for a mixed both-sides-changed test", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/drained.ts": 4,
        "packages/server/src/shared.ts": 8,
      },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/added-current.ts": 2,
        "packages/server/src/added-shared.ts": 5,
        "packages/server/src/drained.ts": 4,
        "packages/server/src/shared.ts": 6,
      },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/added-other.ts": 3,
        "packages/server/src/added-shared.ts": 4,
        "packages/server/src/shared.ts": 7,
      },
    });

    const result = mergeResult(base, current, other);

    expect(result.failures).toEqual([]);
    expect(result.postMergeTruthUpRequired).toBe(true);
    expect(result.mergedText).toBe(
      formatLintRatchetBaseline(
        messageBaseline({
          "ratchet/fixture-one": {
            "packages/server/src/added-current.ts": 2,
            "packages/server/src/added-other.ts": 3,
            "packages/server/src/added-shared.ts": 4,
            "packages/server/src/shared.ts": 6,
          },
        }),
      ),
    );
  });

  it("treats a missing base test as empty item-level base", () => {
    const base = messageBaseline({});
    const current = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/current.ts": 2 },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/other.ts": 3 },
    });

    const result = mergeResult(base, current, other);

    expect(result.failures).toEqual([]);
    expect(result.postMergeTruthUpRequired).toBe(false);
    expect(result.mergedText).toBe(
      formatLintRatchetBaseline(
        messageBaseline({
          "ratchet/fixture-one": {
            "packages/server/src/current.ts": 2,
            "packages/server/src/other.ts": 3,
          },
        }),
      ),
    );
  });

  it("does not request post-merge truth-up for independent one-sided ratchet changes", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/one.ts": 4 },
      "ratchet/fixture-two": { "packages/client/src/two.tsx": 6 },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/one.ts": 2 },
      "ratchet/fixture-two": { "packages/client/src/two.tsx": 6 },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/one.ts": 4 },
      "ratchet/fixture-two": { "packages/client/src/two.tsx": 3 },
    });

    const result = mergeResult(base, current, other);

    expect(result.failures).toEqual([]);
    expect(result.postMergeTruthUpRequired).toBe(false);
  });

  it("preserves equal-count message fingerprints when both sides agree", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/lower.ts": 5,
        "packages/server/src/shared.ts": { count: 3, messagesFingerprint: MESSAGE_FINGERPRINT_A },
      },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/lower.ts": 2,
        "packages/server/src/shared.ts": { count: 2, messagesFingerprint: MESSAGE_FINGERPRINT_B },
      },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/lower.ts": 3,
        "packages/server/src/shared.ts": { count: 2, messagesFingerprint: MESSAGE_FINGERPRINT_B },
      },
    });

    const result = mergeResult(base, current, other);

    expect(result.failures).toEqual([]);
    expect(result.mergedText).toBe(
      formatLintRatchetBaseline(
        messageBaseline({
          "ratchet/fixture-one": {
            "packages/server/src/lower.ts": 2,
            "packages/server/src/shared.ts": {
              count: 2,
              messagesFingerprint: MESSAGE_FINGERPRINT_B,
            },
          },
        }),
      ),
    );
  });

  it("keeps a deterministic message fingerprint and requests truth-up when equal counts differ", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/shared.ts": { count: 3, messagesFingerprint: MESSAGE_FINGERPRINT_A },
      },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/shared.ts": { count: 2, messagesFingerprint: MESSAGE_FINGERPRINT_B },
      },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/shared.ts": { count: 2, messagesFingerprint: MESSAGE_FINGERPRINT_A },
      },
    });

    const result = mergeResult(base, current, other);

    expect(result.failures).toEqual([]);
    expect(result.postMergeTruthUpRequired).toBe(true);
    expect(result.mergedText).toBe(
      formatLintRatchetBaseline(
        messageBaseline({
          "ratchet/fixture-one": {
            "packages/server/src/shared.ts": {
              count: 2,
              messagesFingerprint: MESSAGE_FINGERPRINT_A,
            },
          },
        }),
      ),
    );
  });

  it("preserves a one-sided message fingerprint and requests truth-up", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 3 },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/shared.ts": { count: 2, messagesFingerprint: MESSAGE_FINGERPRINT_A },
      },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 2 },
    });

    const result = mergeResult(base, current, other);

    expect(result.failures).toEqual([]);
    expect(result.postMergeTruthUpRequired).toBe(true);
    expect(result.mergedText).toBe(
      formatLintRatchetBaseline(
        messageBaseline({
          "ratchet/fixture-one": {
            "packages/server/src/shared.ts": {
              count: 2,
              messagesFingerprint: MESSAGE_FINGERPRINT_A,
            },
          },
        }),
      ),
    );
  });

  it("treats an empty base file as an empty baseline for add/add merges", () => {
    const current = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/one.ts": 2 },
    });
    const other = messageBaseline({
      "ratchet/fixture-two": { "packages/client/src/two.tsx": 3 },
    });

    const result = mergeLintRatchetBaselines({
      baseText: "",
      currentText: formatLintRatchetBaseline(current),
      otherText: formatLintRatchetBaseline(other),
    });

    expect(result.failures).toEqual([]);
    expect(result.mergedText).toBe(
      formatLintRatchetBaseline(
        messageBaseline({
          "ratchet/fixture-one": { "packages/server/src/one.ts": 2 },
          "ratchet/fixture-two": { "packages/client/src/two.tsx": 3 },
        }),
      ),
    );
  });

  it("refuses a semantic success when the merged baseline is strict-invalid", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 4 },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 3 },
    });

    const result = mergeLintRatchetBaselines({
      baseText: formatLintRatchetBaseline(base),
      currentText: baselineTextWithoutRuleSourceHash(current),
      otherText: formatLintRatchetBaseline(base),
    });

    expect(result.mergedText).toBeUndefined();
    expect(result.failures).toEqual(["ratchet/fixture-one.ruleSourceHash is required"]);
  });

  it("takes the lower effective-line-count payload when counts tie", () => {
    const path = "packages/server/src/large.ts";
    const base = maxLinesBaseline(path, 450);
    const current = maxLinesBaseline(path, 320);
    const other = maxLinesBaseline(path, 300);

    const result = mergeResult(base, current, other);

    expect(result.failures).toEqual([]);
    expect(result.mergedText).toBe(formatLintRatchetBaseline(maxLinesBaseline(path, 300)));
  });

  it("refuses equal-count complexity payloads when function vectors differ", () => {
    const path = "packages/server/src/branchy.ts";
    const base = complexityBaseline(path, [
      complexityFunction(10, "Function 'choose'", 20),
      complexityFunction(30, "Function 'route'", 18),
    ]);
    const current = complexityBaseline(path, [
      complexityFunction(10, "Function 'choose'", 16),
      complexityFunction(30, "Function 'route'", 18),
    ]);
    const other = complexityBaseline(path, [
      complexityFunction(10, "Function 'choose'", 20),
      complexityFunction(30, "Function 'route'", 14),
    ]);

    const result = mergeResult(base, current, other);

    expect(result.mergedText).toBeUndefined();
    expect(result.failures).toEqual([
      "ratchet/fixture-complexity.items.packages/server/src/branchy.ts: equal-count complexity-severity payloads differ",
    ]);
  });

  it("refuses both-sides metadata changes instead of guessing", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 4 },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 3 },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 2 },
    });
    const otherWithHashDrift: LintRatchetBaseline = {
      ...other,
      tests: {
        "ratchet/fixture-one": {
          ...requireBaselineTest(other, "ratchet/fixture-one"),
          configHash: `sha256:${"c".repeat(64)}`,
        },
      },
    };

    const result = mergeResult(base, current, otherWithHashDrift);

    expect(result.mergedText).toBeUndefined();
    expect(result.failures).toEqual([
      "ratchet/fixture-one: ratchet metadata differs between sides; regenerate the baseline after resolving other conflicts",
    ]);
  });

  it("reports malformed inputs so the shell driver can fall back to the manual recipe", () => {
    const baseline = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 4 },
    });

    const result = mergeLintRatchetBaselines({
      baseText: formatLintRatchetBaseline(baseline),
      currentText: "{not json",
      otherText: formatLintRatchetBaseline(baseline),
    });

    expect(result.mergedText).toBeUndefined();
    expect(result.failures).toEqual([
      expect.stringContaining("current baseline JSON parse failed"),
    ]);
  });
});
