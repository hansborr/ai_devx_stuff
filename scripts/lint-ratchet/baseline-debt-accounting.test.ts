import { describe, expect, it } from "vitest";

import {
  checkBaselineDebtAccounting,
  formatBaselineDebtAccountingFailures,
} from "./baseline-debt-accounting.js";
import { currentById, FIXTURE_HASH } from "./lint-ratchet.test-helper.js";
import {
  buildLintRatchetBaseline,
  formatLintRatchetBaseline,
  type LintRatchetBaseline,
  type LintRatchetCurrentItem,
  type LintRatchetRegression,
} from "./lint-ratchet-baseline.js";
import type { LintRatchetConfig } from "./lint-ratchet-config.js";

type BaselineTest = NonNullable<LintRatchetBaseline["tests"][string]>;

const messageRatchet = {
  id: "ratchet/message",
  ruleId: "local/message",
  files: ["packages/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  mode: "no-new",
  target: 0,
  metric: "message-count",
  repairKind: "manual",
  principle: "Fixture message ratchet.",
} satisfies LintRatchetConfig;

const lineRatchet = {
  ...messageRatchet,
  id: "ratchet/lines",
  ruleId: "local/max-lines",
  metric: "effective-line-count",
  principle: "Fixture lines ratchet.",
} satisfies LintRatchetConfig;

const complexityRatchet = {
  ...messageRatchet,
  id: "ratchet/complexity",
  ruleId: "complexity",
  metric: "complexity-severity",
  principle: "Fixture complexity ratchet.",
} satisfies LintRatchetConfig;

interface BaselineFixture {
  readonly ratchet: LintRatchetConfig;
  readonly items: readonly [string, LintRatchetCurrentItem][];
}

function baselineText(fixtures: readonly BaselineFixture[]): string {
  const baseline = buildLintRatchetBaseline(
    fixtures.map((fixture) => fixture.ratchet),
    currentById(fixtures.map((fixture) => [fixture.ratchet.id, fixture.items])),
    new Map(fixtures.map((fixture) => [fixture.ratchet.id, FIXTURE_HASH])),
  );
  return formatLintRatchetBaseline(baseline);
}

function withConfigHash(text: string, testId: string, configHash: string): string {
  const parsed = JSON.parse(text) as {
    version: LintRatchetBaseline["version"];
    tests: Record<string, BaselineTest>;
  };
  const test = parsed.tests[testId];
  if (test !== undefined) {
    parsed.tests = { ...parsed.tests, [testId]: { ...test, configHash } };
  }
  return formatLintRatchetBaseline(parsed);
}

function debtLogLine(regression: LintRatchetRegression): string {
  return `${JSON.stringify({
    version: "1",
    acceptanceReason: "intentional accepted debt for this fixture",
    regressions: [regression],
    orphansRemoved: [],
  })}\n`;
}

describe("checkBaselineDebtAccounting", () => {
  it("reports unaccounted count, new-path, line, and complexity baseline increases", () => {
    const baseBaselineText = baselineText([
      { ratchet: messageRatchet, items: [["packages/server/src/a.ts", { count: 1 }]] },
      { ratchet: lineRatchet, items: [["packages/server/src/large.ts", { count: 1, lines: 100 }]] },
      {
        ratchet: complexityRatchet,
        items: [
          [
            "packages/server/src/branchy.ts",
            { count: 1, perFunction: [{ line: 4, label: "branchy", complexity: 10 }] },
          ],
        ],
      },
    ]);
    const currentBaselineText = baselineText([
      {
        ratchet: messageRatchet,
        items: [
          ["packages/server/src/a.ts", { count: 2 }],
          ["packages/server/src/new.ts", { count: 1 }],
        ],
      },
      { ratchet: lineRatchet, items: [["packages/server/src/large.ts", { count: 1, lines: 120 }]] },
      {
        ratchet: complexityRatchet,
        items: [
          [
            "packages/server/src/branchy.ts",
            { count: 1, perFunction: [{ line: 4, label: "branchy", complexity: 14 }] },
          ],
        ],
      },
    ]);

    const result = checkBaselineDebtAccounting({
      baseBaselineText,
      currentBaselineText,
      baseDebtLogText: "",
      currentDebtLogText: "",
    });

    expect(result.failures.map((failure) => failure.kind)).toEqual([
      "complexity",
      "lines",
      "count",
      "new-path",
    ]);
    expect(formatBaselineDebtAccountingFailures(result.failures)).toContain(
      "ratchet/message packages/server/src/new.ts: new path baseline is 1 finding(s)",
    );
  });

  it("accepts matching debt-log regressions added in the same range", () => {
    const baseBaselineText = baselineText([
      { ratchet: messageRatchet, items: [["packages/server/src/a.ts", { count: 1 }]] },
    ]);
    const currentBaselineText = baselineText([
      { ratchet: messageRatchet, items: [["packages/server/src/a.ts", { count: 2 }]] },
    ]);
    const addedLine = debtLogLine({
      testId: messageRatchet.id,
      ruleId: messageRatchet.ruleId,
      path: "packages/server/src/a.ts",
      baselineCount: 1,
      currentCount: 2,
      reason: "increased-count",
    });

    expect(
      checkBaselineDebtAccounting({
        baseBaselineText,
        currentBaselineText,
        baseDebtLogText: "",
        currentDebtLogText: addedLine,
      }).failures,
    ).toEqual([]);
  });

  it("does not count debt-log regressions that were already present at the base", () => {
    const baseBaselineText = baselineText([
      { ratchet: messageRatchet, items: [["packages/server/src/a.ts", { count: 1 }]] },
    ]);
    const currentBaselineText = baselineText([
      { ratchet: messageRatchet, items: [["packages/server/src/a.ts", { count: 2 }]] },
    ]);
    const existingLine = debtLogLine({
      testId: messageRatchet.id,
      ruleId: messageRatchet.ruleId,
      path: "packages/server/src/a.ts",
      baselineCount: 1,
      currentCount: 2,
      reason: "increased-count",
    });

    const result = checkBaselineDebtAccounting({
      baseBaselineText,
      currentBaselineText,
      baseDebtLogText: existingLine,
      currentDebtLogText: existingLine,
    });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.path).toBe("packages/server/src/a.ts");
  });

  it("rejects debt-log rewrites instead of treating them as added accounting", () => {
    const baseBaselineText = baselineText([
      { ratchet: messageRatchet, items: [["packages/server/src/a.ts", { count: 1 }]] },
    ]);
    const currentBaselineText = baselineText([
      { ratchet: messageRatchet, items: [["packages/server/src/a.ts", { count: 2 }]] },
    ]);
    const historicalLine = debtLogLine({
      testId: messageRatchet.id,
      ruleId: messageRatchet.ruleId,
      path: "packages/server/src/old.ts",
      baselineCount: 0,
      currentCount: 1,
      reason: "new-path",
    });
    const rewrittenLine = debtLogLine({
      testId: messageRatchet.id,
      ruleId: messageRatchet.ruleId,
      path: "packages/server/src/a.ts",
      baselineCount: 1,
      currentCount: 2,
      reason: "increased-count",
    });

    expect(() =>
      checkBaselineDebtAccounting({
        baseBaselineText,
        currentBaselineText,
        baseDebtLogText: historicalLine,
        currentDebtLogText: rewrittenLine,
      }),
    ).toThrow(/append-only/u);
  });

  it("exempts newly adopted ratchets and changed config hashes", () => {
    const changedConfigRatchet = {
      ...messageRatchet,
      id: "ratchet/changed-config",
      files: ["packages/server/src/**/*.ts"],
    } satisfies LintRatchetConfig;
    const newlyAdoptedRatchet = {
      ...messageRatchet,
      id: "ratchet/new-adoption",
    } satisfies LintRatchetConfig;
    const baseBaselineText = baselineText([
      { ratchet: changedConfigRatchet, items: [["packages/server/src/a.ts", { count: 1 }]] },
    ]);
    const currentWithIncreases = baselineText([
      { ratchet: changedConfigRatchet, items: [["packages/server/src/a.ts", { count: 3 }]] },
      { ratchet: newlyAdoptedRatchet, items: [["packages/server/src/new.ts", { count: 5 }]] },
    ]);
    const currentBaselineText = withConfigHash(
      currentWithIncreases,
      changedConfigRatchet.id,
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );

    expect(
      checkBaselineDebtAccounting({
        baseBaselineText,
        currentBaselineText,
        baseDebtLogText: "",
        currentDebtLogText: "",
      }).failures,
    ).toEqual([]);
  });
});
