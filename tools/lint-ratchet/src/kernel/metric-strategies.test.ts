import { describe, expect, it } from "vitest";

import type { LintRatchetConfig, LintRatchetMetric } from "./config-types.js";
import type { ESLintMessage } from "./eslint-runner.js";
import { metricStrategies, metricStrategy } from "./metric-strategies.js";
import { ConfigError } from "./metrics-types.js";

function ratchet(overrides: Partial<LintRatchetConfig> = {}): LintRatchetConfig {
  return {
    id: "ratchet/fixture",
    ruleId: "local/no-fixture",
    files: ["src/**/*.ts"],
    ignores: [],
    ruleOptions: [],
    mode: "no-new",
    metric: "message-count",
    repairKind: "manual",
    principle: "Fixture ratchet principle for metric strategy tests.",
    ...overrides,
  } as LintRatchetConfig;
}

function message(overrides: Partial<ESLintMessage> = {}): ESLintMessage {
  return { ruleId: "local/no-fixture", severity: 2, message: "boom", ...overrides };
}

describe("metricStrategy", () => {
  it("registers exactly the three live metrics", () => {
    const metrics = metricStrategies().map((strategy) => strategy.metric);
    expect([...metrics].sort()).toStrictEqual<LintRatchetMetric[]>([
      "complexity-severity",
      "effective-line-count",
      "message-count",
    ]);
    for (const metric of metrics) {
      expect(metricStrategy(metric).metric).toBe(metric);
    }
  });

  describe("message-count", () => {
    const strategy = metricStrategy("message-count");

    it("is rule-agnostic and contributes a message-identity fingerprint", () => {
      expect(strategy.requiredRuleId).toBeUndefined();
      expect(strategy.recordsMessageIdentity).toBe(true);
    });

    it("reduces a message to its text and messageId", () => {
      expect(
        strategy.reduceMessage(ratchet(), "src/a.ts", message({ message: "hi", messageId: "id" })),
      ).toStrictEqual({ message: "hi", messageId: "id" });
    });
  });

  describe("effective-line-count", () => {
    const strategy = metricStrategy("effective-line-count");

    it("requires local/max-lines and does not fingerprint", () => {
      expect(strategy.requiredRuleId).toBe("local/max-lines");
      expect(strategy.recordsMessageIdentity).toBe(false);
    });

    it("parses the effective line count from the rule message", () => {
      const finding = strategy.reduceMessage(
        ratchet({ ruleId: "local/max-lines", metric: "effective-line-count" }),
        "src/a.ts",
        message({ message: "This file has 321 effective lines, above the 200 line limit." }),
      );
      expect(finding).toStrictEqual({ lines: 321 });
    });

    it("throws when the ratchet does not use local/max-lines", () => {
      expect(() =>
        strategy.reduceMessage(
          ratchet({ ruleId: "complexity", metric: "effective-line-count" }),
          "src/a.ts",
          message(),
        ),
      ).toThrow(ConfigError);
    });

    it("throws when the message shape is unparseable", () => {
      expect(() =>
        strategy.reduceMessage(
          ratchet({ ruleId: "local/max-lines", metric: "effective-line-count" }),
          "src/a.ts",
          message({ message: "unexpected" }),
        ),
      ).toThrow(ConfigError);
    });
  });

  describe("complexity-severity", () => {
    const strategy = metricStrategy("complexity-severity");

    it("requires complexity and does not fingerprint", () => {
      expect(strategy.requiredRuleId).toBe("complexity");
      expect(strategy.recordsMessageIdentity).toBe(false);
    });

    it("parses the per-function complexity from the rule message", () => {
      const finding = strategy.reduceMessage(
        ratchet({ ruleId: "complexity", metric: "complexity-severity" }),
        "src/a.ts",
        message({
          message: "Function 'f' has a complexity of 12. Maximum allowed is 10.",
          line: 7,
          messageId: "complex",
        }),
      );
      expect(finding.complexity).toStrictEqual({ line: 7, label: "Function 'f'", complexity: 12 });
    });

    it("throws when the ratchet does not use complexity", () => {
      expect(() =>
        strategy.reduceMessage(
          ratchet({ ruleId: "local/max-lines", metric: "complexity-severity" }),
          "src/a.ts",
          message(),
        ),
      ).toThrow(ConfigError);
    });
  });
});

describe("metric strategy codec", () => {
  it("formats each metric to only its gating fields", () => {
    expect(
      metricStrategy("message-count").formatItem({
        count: 2,
        messagesFingerprint: `sha256:${"a".repeat(64)}`,
        lines: 9,
      }),
    ).toStrictEqual({ count: 2, messagesFingerprint: `sha256:${"a".repeat(64)}` });
    expect(
      metricStrategy("effective-line-count").formatItem({ count: 1, lines: 240, maxComplexity: 5 }),
    ).toStrictEqual({ count: 1, lines: 240 });
    expect(
      metricStrategy("complexity-severity").formatItem({
        count: 1,
        lines: 9,
        perFunction: [{ line: 3, label: "f", complexity: 12 }],
      }),
    ).toStrictEqual({
      count: 1,
      maxComplexity: 12,
      perFunction: [{ line: 3, label: "f", complexity: 12 }],
    });
  });

  it("validates metric-appropriate fields", () => {
    const messageCountFailures: string[] = [];
    metricStrategy("message-count").validateItem("x", { count: 1, lines: 9 }, messageCountFailures);
    expect(messageCountFailures).toStrictEqual(["x.lines is only valid for effective-line-count"]);

    const lineFailures: string[] = [];
    metricStrategy("effective-line-count").validateItem("x", { count: 1 }, lineFailures);
    expect(lineFailures).toStrictEqual(["x.lines is required for effective-line-count"]);

    const complexityFailures: string[] = [];
    metricStrategy("complexity-severity").validateItem(
      "x",
      { count: 1, maxComplexity: 12, perFunction: [{ line: 3, label: "f", complexity: 12 }] },
      complexityFailures,
    );
    expect(complexityFailures).toStrictEqual([]);
  });
});

describe("metric strategy same-count merge", () => {
  const fpA = `sha256:${"a".repeat(64)}`;
  const fpB = `sha256:${"b".repeat(64)}`;

  it("resolves message-count fingerprints deterministically and flags churn", () => {
    const strategy = metricStrategy("message-count");
    expect(strategy.meetSameCountItem("x", { count: 2 }, { count: 2 })).toStrictEqual({
      item: { count: 2 },
      postMergeTruthUpRequired: false,
    });
    expect(
      strategy.meetSameCountItem(
        "x",
        { count: 2, messagesFingerprint: fpB },
        { count: 2, messagesFingerprint: fpA },
      ),
    ).toStrictEqual({
      item: { count: 2, messagesFingerprint: fpA },
      postMergeTruthUpRequired: true,
    });
  });

  it("takes the lower effective line count and flags a truth-up on difference", () => {
    const strategy = metricStrategy("effective-line-count");
    expect(
      strategy.meetSameCountItem("x", { count: 1, lines: 240 }, { count: 1, lines: 210 }),
    ).toStrictEqual({ item: { count: 1, lines: 210 }, postMergeTruthUpRequired: true });
    expect(
      strategy.meetSameCountItem("x", { count: 1, lines: 200 }, { count: 1, lines: 200 }),
    ).toStrictEqual({ item: { count: 1, lines: 200 }, postMergeTruthUpRequired: false });
    expect(strategy.meetSameCountItem("t.items.a", { count: 1 }, { count: 1 })).toStrictEqual({
      postMergeTruthUpRequired: false,
      failure: "t.items.a: effective-line-count items need lines on both sides",
    });
  });

  it("keeps identical complexity payloads and fails when they disagree", () => {
    const strategy = metricStrategy("complexity-severity");
    const item = {
      count: 1,
      maxComplexity: 12,
      perFunction: [{ line: 3, label: "f", complexity: 12 }],
    };
    expect(strategy.meetSameCountItem("x", item, item)).toStrictEqual({
      item,
      postMergeTruthUpRequired: false,
    });
    expect(
      strategy.meetSameCountItem("t.items.a", item, {
        count: 1,
        maxComplexity: 20,
        perFunction: [{ line: 3, label: "f", complexity: 20 }],
      }),
    ).toStrictEqual({
      postMergeTruthUpRequired: false,
      failure: "t.items.a: equal-count complexity-severity payloads differ",
    });
  });
});
