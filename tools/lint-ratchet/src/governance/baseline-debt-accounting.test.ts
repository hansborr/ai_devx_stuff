import { describe, expect, it } from "vitest";

import { currentById, FIXTURE_HASH } from "../../test/support/lint-ratchet.test-helper.js";
import {
  buildLintRatchetBaseline,
  formatLintRatchetBaseline,
  type LintRatchetBaseline,
  type LintRatchetCurrentItem,
  type LintRatchetRegression,
} from "../kernel/baseline.js";
import type { LintRatchetConfig } from "../kernel/config-types.js";
import {
  type BaselineDebtAccountingResult,
  checkBaselineDebtAccounting,
  formatBaselineDebtAccountingFailures,
} from "./baseline-debt-accounting.js";

type BaselineTest = NonNullable<LintRatchetBaseline["tests"][string]>;

const messageRatchet = {
  id: "ratchet/message",
  ruleId: "local/message",
  files: ["packages/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  mode: "no-new",
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

function debtLogEntry(value: Record<string, unknown>): string {
  return `${JSON.stringify({ version: "1", ...value })}\n`;
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

  it("accepts an exact new-path then count-growth chain from successive commits", () => {
    const path = "packages/server/src/new.ts";
    const baseBaselineText = baselineText([{ ratchet: messageRatchet, items: [] }]);
    const currentBaselineText = baselineText([
      { ratchet: messageRatchet, items: [[path, { count: 2 }]] },
    ]);
    const newPathEntry = debtLogLine({
      testId: messageRatchet.id,
      ruleId: messageRatchet.ruleId,
      path,
      baselineCount: 0,
      currentCount: 1,
      reason: "new-path",
    });
    const countGrowthEntry = debtLogLine({
      testId: messageRatchet.id,
      ruleId: messageRatchet.ruleId,
      path,
      baselineCount: 1,
      currentCount: 2,
      reason: "increased-count",
    });

    expect(
      checkBaselineDebtAccounting({
        baseBaselineText,
        currentBaselineText,
        baseDebtLogText: "",
        currentDebtLogText: `${newPathEntry}${countGrowthEntry}`,
      }).failures,
    ).toEqual([]);
  });

  it("accepts new-path then count growth after effective lines decrease", () => {
    const path = "packages/server/src/large.ts";
    const baseBaselineText = baselineText([{ ratchet: lineRatchet, items: [] }]);
    const currentBaselineText = baselineText([
      { ratchet: lineRatchet, items: [[path, { count: 2, lines: 80 }]] },
    ]);
    const newPathEntry = debtLogLine({
      testId: lineRatchet.id,
      ruleId: lineRatchet.ruleId,
      path,
      baselineCount: 0,
      currentCount: 1,
      currentLines: 120,
      reason: "new-path",
    });
    const countGrowthEntry = debtLogLine({
      testId: lineRatchet.id,
      ruleId: lineRatchet.ruleId,
      path,
      baselineCount: 1,
      currentCount: 2,
      reason: "increased-count",
    });

    expect(
      checkBaselineDebtAccounting({
        baseBaselineText,
        currentBaselineText,
        baseDebtLogText: "",
        currentDebtLogText: `${newPathEntry}${countGrowthEntry}`,
      }).failures,
    ).toEqual([]);
  });

  it("rejects a same-path chain with a fabricated transition gap", () => {
    const path = "packages/server/src/new.ts";
    const baseBaselineText = baselineText([{ ratchet: messageRatchet, items: [] }]);
    const currentBaselineText = baselineText([
      { ratchet: messageRatchet, items: [[path, { count: 3 }]] },
    ]);
    const fabricatedChain = [
      debtLogLine({
        testId: messageRatchet.id,
        ruleId: messageRatchet.ruleId,
        path,
        baselineCount: 0,
        currentCount: 1,
        reason: "new-path",
      }),
      debtLogLine({
        testId: messageRatchet.id,
        ruleId: messageRatchet.ruleId,
        path,
        baselineCount: 2,
        currentCount: 3,
        reason: "increased-count",
      }),
    ].join("");

    expect(
      checkBaselineDebtAccounting({
        baseBaselineText,
        currentBaselineText,
        baseDebtLogText: "",
        currentDebtLogText: fabricatedChain,
      }).failures,
    ).toHaveLength(1);
  });

  it("accepts an append onto a base debt log that lacked a trailing newline", () => {
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
    const addedLine = debtLogLine({
      testId: messageRatchet.id,
      ruleId: messageRatchet.ruleId,
      path: "packages/server/src/a.ts",
      baselineCount: 1,
      currentCount: 2,
      reason: "increased-count",
    });
    // A hand-edited base may be missing its final newline; the appender then
    // writes the separator before the new entry. Accounting must attribute
    // that separator to the base's last line, not parse it as an empty entry.
    const baseWithoutTrailingNewline = historicalLine.slice(0, -1);

    expect(
      checkBaselineDebtAccounting({
        baseBaselineText,
        currentBaselineText,
        baseDebtLogText: baseWithoutTrailingNewline,
        currentDebtLogText: `${baseWithoutTrailingNewline}\n${addedLine}`,
      }).failures,
    ).toEqual([]);
  });

  it("does not let a lines reason account for a count increase", () => {
    const path = "packages/server/src/a.ts";
    const baseBaselineText = baselineText([
      { ratchet: messageRatchet, items: [[path, { count: 1 }]] },
    ]);
    const currentBaselineText = baselineText([
      { ratchet: messageRatchet, items: [[path, { count: 2 }]] },
    ]);
    const wrongReason = debtLogLine({
      testId: messageRatchet.id,
      ruleId: messageRatchet.ruleId,
      path,
      baselineCount: 1,
      currentCount: 2,
      baselineLines: 100,
      currentLines: 120,
      reason: "increased-lines",
    });

    expect(
      checkBaselineDebtAccounting({
        baseBaselineText,
        currentBaselineText,
        baseDebtLogText: "",
        currentDebtLogText: wrongReason,
      }).failures,
    ).toHaveLength(1);
  });

  it("rejects a complexity chain endpoint that understates the current count", () => {
    const path = "packages/server/src/branchy.ts";
    const baseBaselineText = baselineText([
      {
        ratchet: complexityRatchet,
        items: [
          [
            path,
            {
              count: 2,
              perFunction: [{ line: 4, label: "branchy", complexity: 15 }],
            },
          ],
        ],
      },
    ]);
    const currentBaselineText = baselineText([
      {
        ratchet: complexityRatchet,
        items: [
          [
            path,
            {
              count: 6,
              perFunction: [{ line: 4, label: "branchy", complexity: 18 }],
            },
          ],
        ],
      },
    ]);
    const understatedCount = debtLogLine({
      testId: complexityRatchet.id,
      ruleId: complexityRatchet.ruleId,
      path,
      baselineCount: 2,
      currentCount: 2,
      baselineComplexity: 15,
      currentComplexity: 18,
      reason: "increased-complexity",
    });

    expect(
      checkBaselineDebtAccounting({
        baseBaselineText,
        currentBaselineText,
        baseDebtLogText: "",
        currentDebtLogText: understatedCount,
      }).failures,
    ).toHaveLength(1);
  });

  it("uses lines-before-count priority for a compound increase", () => {
    const path = "packages/server/src/large.ts";
    const baseBaselineText = baselineText([
      { ratchet: lineRatchet, items: [[path, { count: 1, lines: 100 }]] },
    ]);
    const currentBaselineText = baselineText([
      { ratchet: lineRatchet, items: [[path, { count: 2, lines: 120 }]] },
    ]);
    const priorityReason = debtLogLine({
      testId: lineRatchet.id,
      ruleId: lineRatchet.ruleId,
      path,
      baselineCount: 1,
      currentCount: 2,
      baselineLines: 100,
      currentLines: 120,
      reason: "increased-lines",
    });

    const result = checkBaselineDebtAccounting({
      baseBaselineText,
      currentBaselineText,
      baseDebtLogText: "",
      currentDebtLogText: priorityReason,
    });
    expect(result.increases.map((increase) => increase.kind)).toEqual(["lines"]);
    expect(result.failures).toEqual([]);
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
    expect(result.failures[0]).toMatchObject({ path: "packages/server/src/a.ts" });
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

  it("exempts newly adopted ratchets but compares same-metric paths across config changes", () => {
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

    const result = checkBaselineDebtAccounting({
      baseBaselineText,
      currentBaselineText,
      baseDebtLogText: "",
      currentDebtLogText: "",
    });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      kind: "count",
      testId: changedConfigRatchet.id,
      path: "packages/server/src/a.ts",
    });
  });

  it("requires removed base ids to have an orphan-removal or retirement record", () => {
    const baseBaselineText = baselineText([{ ratchet: messageRatchet, items: [] }]);
    const currentBaselineText = baselineText([]);
    const retirement = debtLogEntry({
      kind: "retirement",
      ratchetId: messageRatchet.id,
      promotionProof: "normal-lint-error",
    });

    const missing = checkBaselineDebtAccounting({
      baseBaselineText,
      currentBaselineText,
      baseDebtLogText: "",
      currentDebtLogText: "",
    });
    expect(missing.failures).toEqual([
      expect.objectContaining({ kind: "missing-ratchet", testId: messageRatchet.id }),
    ]);

    expect(
      checkBaselineDebtAccounting({
        baseBaselineText,
        currentBaselineText,
        baseDebtLogText: "",
        currentDebtLogText: retirement,
      }).failures,
    ).toEqual([]);
  });

  it("rejects retirement accounting for a removed nonzero floor", () => {
    const baseBaselineText = baselineText([
      { ratchet: messageRatchet, items: [["packages/server/src/a.ts", { count: 1 }]] },
    ]);
    const retirement = debtLogEntry({
      kind: "retirement",
      ratchetId: messageRatchet.id,
      promotionProof: "normal-lint-error",
    });

    expect(
      checkBaselineDebtAccounting({
        baseBaselineText,
        currentBaselineText: baselineText([]),
        baseDebtLogText: "",
        currentDebtLogText: retirement,
      }).failures,
    ).toEqual([expect.objectContaining({ kind: "missing-ratchet", testId: messageRatchet.id })]);
  });

  it("requires an orphan removal to exactly snapshot the removed baseline", () => {
    const path = "packages/server/src/a.ts";
    const baseBaselineText = baselineText([
      { ratchet: messageRatchet, items: [[path, { count: 2 }]] },
    ]);
    const orphanEntry = (
      ruleId: string,
      baselineItems: readonly Record<string, unknown>[],
    ): string =>
      debtLogEntry({
        acceptanceReason: "remove an intentionally renamed ratchet floor",
        regressions: [],
        orphansRemoved: [
          {
            testId: messageRatchet.id,
            ruleId,
            metric: messageRatchet.metric,
            baselineItems,
          },
        ],
      });
    const check = (currentDebtLogText: string): BaselineDebtAccountingResult["failures"] =>
      checkBaselineDebtAccounting({
        baseBaselineText,
        currentBaselineText: baselineText([]),
        baseDebtLogText: "",
        currentDebtLogText,
      }).failures;

    expect(check(orphanEntry("fabricated/rule", []))).toEqual([
      expect.objectContaining({ kind: "missing-ratchet", testId: messageRatchet.id }),
    ]);
    expect(check(orphanEntry(messageRatchet.ruleId, [{ path, count: 2 }]))).toEqual([]);
  });

  it("requires an explicit migration record when a ratchet metric changes", () => {
    const baseBaselineText = baselineText([
      { ratchet: messageRatchet, items: [["packages/server/src/a.ts", { count: 1 }]] },
    ]);
    const currentBaselineText = baselineText([
      { ratchet: lineRatchet, items: [["packages/server/src/a.ts", { count: 1, lines: 100 }]] },
    ]).replaceAll(lineRatchet.id, messageRatchet.id);
    const migration = debtLogEntry({
      kind: "metric-migration",
      ratchetId: messageRatchet.id,
      fromMetric: "message-count",
      toMetric: "effective-line-count",
      reason: "the ratchet now preserves effective line count instead of message count",
    });

    const missing = checkBaselineDebtAccounting({
      baseBaselineText,
      currentBaselineText,
      baseDebtLogText: "",
      currentDebtLogText: "",
    });
    expect(missing.failures).toEqual([
      expect.objectContaining({ kind: "metric-change", testId: messageRatchet.id }),
    ]);
    expect(
      checkBaselineDebtAccounting({
        baseBaselineText,
        currentBaselineText,
        baseDebtLogText: "",
        currentDebtLogText: migration,
      }).failures,
    ).toEqual([]);
  });

  it("still accounts a count increase when a ratchet metric changes", () => {
    // The metric changed, but count is comparable across metrics, so a 1 -> 2
    // growth is real debt: a metric-migration record alone must not excuse it.
    const baseBaselineText = baselineText([
      { ratchet: messageRatchet, items: [["packages/server/src/a.ts", { count: 1 }]] },
    ]);
    const currentBaselineText = baselineText([
      { ratchet: lineRatchet, items: [["packages/server/src/a.ts", { count: 2, lines: 40 }]] },
    ]).replaceAll(lineRatchet.id, messageRatchet.id);
    const migration = debtLogEntry({
      kind: "metric-migration",
      ratchetId: messageRatchet.id,
      fromMetric: "message-count",
      toMetric: "effective-line-count",
      reason: "the ratchet now preserves effective line count instead of message count",
    });
    const acceptedDebt = debtLogLine({
      testId: messageRatchet.id,
      // The current baseline was generated from the line ratchet then id-renamed,
      // so the accounted increase carries the current test's ruleId.
      ruleId: lineRatchet.ruleId,
      path: "packages/server/src/a.ts",
      baselineCount: 1,
      currentCount: 2,
      reason: "increased-count",
    });

    // Migration record alone leaves the count increase unaccounted.
    expect(
      checkBaselineDebtAccounting({
        baseBaselineText,
        currentBaselineText,
        baseDebtLogText: "",
        currentDebtLogText: migration,
      }).failures,
    ).toEqual([expect.objectContaining({ kind: "count", testId: messageRatchet.id })]);

    // Migration record plus an accepted-debt entry for the count clears the gate.
    expect(
      checkBaselineDebtAccounting({
        baseBaselineText,
        currentBaselineText,
        baseDebtLogText: "",
        currentDebtLogText: `${migration}${acceptedDebt}`,
      }).failures,
    ).toEqual([]);
  });

  it("requires a coverage-shrink record when changed globs drop baselined paths", () => {
    const droppedPath = "packages/server/src/excluded.ts";
    const fixedPath = "packages/server/src/fixed.ts";
    const narrowedRatchet = {
      ...messageRatchet,
      ignores: [droppedPath],
    } satisfies LintRatchetConfig;
    const baseBaselineText = baselineText([
      {
        ratchet: messageRatchet,
        items: [
          ["packages/server/src/a.ts", { count: 1 }],
          [droppedPath, { count: 2 }],
          [fixedPath, { count: 1 }],
        ],
      },
    ]);
    const currentBaselineText = baselineText([
      {
        ratchet: narrowedRatchet,
        items: [["packages/server/src/a.ts", { count: 1 }]],
      },
    ]);
    const coverageShrink = debtLogEntry({
      kind: "coverage-shrink",
      ratchetId: messageRatchet.id,
      previousFiles: messageRatchet.files,
      currentFiles: narrowedRatchet.files,
      previousIgnores: messageRatchet.ignores,
      currentIgnores: narrowedRatchet.ignores,
      removedPaths: [droppedPath],
      reason: "exclude generated compatibility code from this floor",
    });

    expect(
      checkBaselineDebtAccounting({
        baseBaselineText,
        currentBaselineText,
        baseDebtLogText: "",
        currentDebtLogText: "",
      }).failures,
    ).toEqual([
      expect.objectContaining({
        kind: "coverage-shrink",
        testId: messageRatchet.id,
        removedPaths: [droppedPath],
      }),
    ]);
    expect(
      checkBaselineDebtAccounting({
        baseBaselineText,
        currentBaselineText,
        baseDebtLogText: "",
        currentDebtLogText: coverageShrink,
      }).failures,
    ).toEqual([]);
  });

  it("accepts an exact chain of successive coverage shrinks", () => {
    const firstDroppedPath = "packages/server/src/first.ts";
    const secondDroppedPath = "packages/server/src/second.ts";
    const firstNarrowing = {
      ...messageRatchet,
      ignores: [firstDroppedPath],
    } satisfies LintRatchetConfig;
    const secondNarrowing = {
      ...messageRatchet,
      ignores: [firstDroppedPath, secondDroppedPath],
    } satisfies LintRatchetConfig;
    const baseBaselineText = baselineText([
      {
        ratchet: messageRatchet,
        items: [
          ["packages/server/src/a.ts", { count: 1 }],
          [firstDroppedPath, { count: 1 }],
          [secondDroppedPath, { count: 1 }],
        ],
      },
    ]);
    const currentBaselineText = baselineText([
      {
        ratchet: secondNarrowing,
        items: [["packages/server/src/a.ts", { count: 1 }]],
      },
    ]);
    const coverageEntries = [
      debtLogEntry({
        kind: "coverage-shrink",
        ratchetId: messageRatchet.id,
        previousFiles: messageRatchet.files,
        currentFiles: firstNarrowing.files,
        previousIgnores: messageRatchet.ignores,
        currentIgnores: firstNarrowing.ignores,
        removedPaths: [firstDroppedPath],
        reason: "first intentional scope narrowing",
      }),
      debtLogEntry({
        kind: "coverage-shrink",
        ratchetId: messageRatchet.id,
        previousFiles: firstNarrowing.files,
        currentFiles: secondNarrowing.files,
        previousIgnores: firstNarrowing.ignores,
        currentIgnores: secondNarrowing.ignores,
        removedPaths: [secondDroppedPath],
        reason: "second intentional scope narrowing",
      }),
    ].join("");

    expect(
      checkBaselineDebtAccounting({
        baseBaselineText,
        currentBaselineText,
        baseDebtLogText: "",
        currentDebtLogText: coverageEntries,
      }).failures,
    ).toEqual([]);
  });

  it("accepts a narrow-then-partial-rewiden with the single honest narrow record", () => {
    const rewidenedPath = "packages/server/src/rewidened.ts";
    const stillDroppedPath = "packages/server/src/still-dropped.ts";
    const narrowedRatchet = {
      ...messageRatchet,
      ignores: [rewidenedPath, stillDroppedPath],
    } satisfies LintRatchetConfig;
    const rewidenedRatchet = {
      ...messageRatchet,
      ignores: [stillDroppedPath],
    } satisfies LintRatchetConfig;
    const baseBaselineText = baselineText([
      {
        ratchet: messageRatchet,
        items: [
          ["packages/server/src/a.ts", { count: 1 }],
          [rewidenedPath, { count: 1 }],
          [stillDroppedPath, { count: 1 }],
        ],
      },
    ]);
    const currentBaselineText = baselineText([
      {
        ratchet: rewidenedRatchet,
        items: [["packages/server/src/a.ts", { count: 1 }]],
      },
    ]);
    // The narrow step honestly recorded both dropped paths; the later re-widen
    // has no recordable entry by design (empty removedPaths is rejected), so the
    // chain can never replay to the endpoint globs. Per-path accounting must
    // still accept: the only path out of scope at the endpoint is recorded.
    const narrowRecord = debtLogEntry({
      kind: "coverage-shrink",
      ratchetId: messageRatchet.id,
      previousFiles: messageRatchet.files,
      currentFiles: narrowedRatchet.files,
      previousIgnores: messageRatchet.ignores,
      currentIgnores: narrowedRatchet.ignores,
      removedPaths: [rewidenedPath, stillDroppedPath],
      reason: "intentional scope narrowing, partially reverted later",
    });

    expect(
      checkBaselineDebtAccounting({
        baseBaselineText,
        currentBaselineText,
        baseDebtLogText: "",
        currentDebtLogText: narrowRecord,
      }).failures,
    ).toEqual([]);
  });

  it("accepts interleaved narrow-widen-narrow with both honest narrow records", () => {
    const firstDroppedPath = "packages/server/src/first.ts";
    const secondDroppedPath = "packages/server/src/second.ts";
    const firstNarrowing = {
      ...messageRatchet,
      ignores: [firstDroppedPath],
    } satisfies LintRatchetConfig;
    const secondNarrowing = {
      ...messageRatchet,
      ignores: [secondDroppedPath],
    } satisfies LintRatchetConfig;
    const baseBaselineText = baselineText([
      {
        ratchet: messageRatchet,
        items: [
          ["packages/server/src/a.ts", { count: 1 }],
          [firstDroppedPath, { count: 1 }],
          [secondDroppedPath, { count: 1 }],
        ],
      },
    ]);
    // The first drop was fully re-widened before the second narrowing, so the
    // first path is back in scope (still carrying its debt) at the endpoint.
    const currentBaselineText = baselineText([
      {
        ratchet: secondNarrowing,
        items: [
          ["packages/server/src/a.ts", { count: 1 }],
          [firstDroppedPath, { count: 1 }],
        ],
      },
    ]);
    const coverageEntries = [
      debtLogEntry({
        kind: "coverage-shrink",
        ratchetId: messageRatchet.id,
        previousFiles: messageRatchet.files,
        currentFiles: firstNarrowing.files,
        previousIgnores: messageRatchet.ignores,
        currentIgnores: firstNarrowing.ignores,
        removedPaths: [firstDroppedPath],
        reason: "first intentional scope narrowing, later reverted",
      }),
      // The intermediate widen has no record; this entry's previousIgnores
      // reflect the widened (original) state, not the first narrowing's.
      debtLogEntry({
        kind: "coverage-shrink",
        ratchetId: messageRatchet.id,
        previousFiles: messageRatchet.files,
        currentFiles: secondNarrowing.files,
        previousIgnores: messageRatchet.ignores,
        currentIgnores: secondNarrowing.ignores,
        removedPaths: [secondDroppedPath],
        reason: "second intentional scope narrowing",
      }),
    ].join("");

    expect(
      checkBaselineDebtAccounting({
        baseBaselineText,
        currentBaselineText,
        baseDebtLogText: "",
        currentDebtLogText: coverageEntries,
      }).failures,
    ).toEqual([]);
  });

  it("still fails an unrecorded second narrowing and names the unaccounted paths", () => {
    const recordedPath = "packages/server/src/recorded.ts";
    const unrecordedPath = "packages/server/src/unrecorded.ts";
    const finalNarrowing = {
      ...messageRatchet,
      ignores: [recordedPath, unrecordedPath],
    } satisfies LintRatchetConfig;
    const baseBaselineText = baselineText([
      {
        ratchet: messageRatchet,
        items: [
          ["packages/server/src/a.ts", { count: 1 }],
          [recordedPath, { count: 1 }],
          [unrecordedPath, { count: 1 }],
        ],
      },
    ]);
    const currentBaselineText = baselineText([
      {
        ratchet: finalNarrowing,
        items: [["packages/server/src/a.ts", { count: 1 }]],
      },
    ]);
    const firstNarrowRecord = debtLogEntry({
      kind: "coverage-shrink",
      ratchetId: messageRatchet.id,
      previousFiles: messageRatchet.files,
      currentFiles: messageRatchet.files,
      previousIgnores: messageRatchet.ignores,
      currentIgnores: [recordedPath],
      removedPaths: [recordedPath],
      reason: "first intentional scope narrowing",
    });

    const result = checkBaselineDebtAccounting({
      baseBaselineText,
      currentBaselineText,
      baseDebtLogText: "",
      currentDebtLogText: firstNarrowRecord,
    });
    expect(result.failures).toEqual([
      expect.objectContaining({
        kind: "coverage-shrink",
        testId: messageRatchet.id,
        removedPaths: [recordedPath, unrecordedPath],
        unaccountedPaths: [unrecordedPath],
        hasShrinkRecords: true,
      }),
    ]);
    expect(formatBaselineDebtAccountingFailures(result.failures)).toContain(
      `coverage-shrink records are present but do not account for: ${unrecordedPath}`,
    );

    const noRecord = checkBaselineDebtAccounting({
      baseBaselineText,
      currentBaselineText,
      baseDebtLogText: "",
      currentDebtLogText: "",
    });
    expect(noRecord.failures).toEqual([
      expect.objectContaining({
        kind: "coverage-shrink",
        unaccountedPaths: [recordedPath, unrecordedPath],
        hasShrinkRecords: false,
      }),
    ]);
    expect(formatBaselineDebtAccountingFailures(noRecord.failures)).toContain(
      "without a coverage-shrink record",
    );
  });

  it("treats a covered dropped path as fixed when globs also change", () => {
    const changedRatchet = {
      ...messageRatchet,
      ignores: ["packages/server/src/unrelated.ts"],
    } satisfies LintRatchetConfig;
    const baseBaselineText = baselineText([
      {
        ratchet: messageRatchet,
        items: [
          ["packages/server/src/a.ts", { count: 1 }],
          ["packages/server/src/fixed.ts", { count: 1 }],
        ],
      },
    ]);
    const currentBaselineText = baselineText([
      {
        ratchet: changedRatchet,
        items: [["packages/server/src/a.ts", { count: 1 }]],
      },
    ]);

    expect(
      checkBaselineDebtAccounting({
        baseBaselineText,
        currentBaselineText,
        baseDebtLogText: "",
        currentDebtLogText: "",
      }).failures,
    ).toEqual([]);
  });

  it("treats dropped baselined paths as fixes when globs are unchanged", () => {
    const baseBaselineText = baselineText([
      {
        ratchet: messageRatchet,
        items: [
          ["packages/server/src/a.ts", { count: 1 }],
          ["packages/server/src/fixed.ts", { count: 1 }],
        ],
      },
    ]);
    const currentBaselineText = baselineText([
      {
        ratchet: messageRatchet,
        items: [["packages/server/src/a.ts", { count: 1 }]],
      },
    ]);

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
