import { describe, expect, it } from "vitest";

import {
  buildLintRatchetBaseline,
  LINT_RATCHET_CONFIG_HASH_PREFIX,
  type LintRatchetBaseline,
  type LintRatchetCurrentById,
  type LintRatchetCurrentItem,
  type LintRatchetRuleSourceHashesById,
} from "./lint-ratchet-baseline.js";
import type { LintRatchetConfig } from "./lint-ratchet-config.js";
import type { LintRatchetComplexityFunction } from "./lint-ratchet-metrics.js";
import {
  formatLintRatchetSummary,
  type LintRatchetSummaryRow,
  summarizeLintRatchetBaseline,
} from "./lint-ratchet-summary.js";

const FIXTURE_HASH = `${LINT_RATCHET_CONFIG_HASH_PREFIX}${"a".repeat(64)}`;

const messageRatchet: LintRatchetConfig = {
  id: "ratchet/fixture-message",
  ruleId: "no-alert",
  source: { kind: "core" },
  parserProfile: "minimal-ts",
  files: ["packages/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  mode: "no-new",
  target: 0,
  metric: "message-count",
  repairKind: "manual",
};

const maxLinesRatchet: LintRatchetConfig = {
  id: "ratchet/fixture-max-lines",
  ruleId: "local/max-lines",
  files: ["packages/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  mode: "no-new",
  target: 0,
  metric: "effective-line-count",
  repairKind: "manual",
};

const complexityRatchet: LintRatchetConfig = {
  id: "ratchet/fixture-complexity",
  ruleId: "complexity",
  source: { kind: "core" },
  parserProfile: "minimal-ts",
  files: ["packages/**/*.ts"],
  ignores: [],
  ruleOptions: [{ max: 10 }],
  mode: "no-new",
  target: 0,
  metric: "complexity-severity",
  repairKind: "manual",
};

const ruleSourceHashes: LintRatchetRuleSourceHashesById = new Map([
  [messageRatchet.id, FIXTURE_HASH],
  [maxLinesRatchet.id, FIXTURE_HASH],
  [complexityRatchet.id, FIXTURE_HASH],
]);

function currentById(
  entries: readonly [string, readonly [string, LintRatchetCurrentItem][]][],
): LintRatchetCurrentById {
  const current = new Map<string, ReadonlyMap<string, LintRatchetCurrentItem>>();
  for (const [ratchetId, items] of entries) {
    current.set(ratchetId, new Map(items));
  }
  return current;
}

function complexityFunction(
  line: number,
  label: string,
  complexity: number,
): LintRatchetComplexityFunction {
  return { line, nodeType: "FunctionDeclaration", label, complexity };
}

function fixtureBaseline(): LintRatchetBaseline {
  return buildLintRatchetBaseline(
    [messageRatchet, maxLinesRatchet],
    currentById([
      [
        messageRatchet.id,
        [
          ["packages/app/src/a.ts", { count: 2 }],
          ["packages/app/src/b.ts", { count: 3 }],
        ],
      ],
      [
        maxLinesRatchet.id,
        [["packages/app/src/large.ts", { count: 1, lines: 340 }]],
      ],
    ]),
    ruleSourceHashes,
  );
}

describe("lint ratchet summary", () => {
  it("reduces a parsed baseline and matching registry to per-ratchet rows", () => {
    expect(
      summarizeLintRatchetBaseline(fixtureBaseline(), [
        messageRatchet,
        maxLinesRatchet,
      ]),
    ).toEqual([
      {
        id: messageRatchet.id,
        ruleId: messageRatchet.ruleId,
        mode: messageRatchet.mode,
        metric: messageRatchet.metric,
        fileCount: 2,
        totalFindings: 5,
      },
      {
        id: maxLinesRatchet.id,
        ruleId: maxLinesRatchet.ruleId,
        mode: maxLinesRatchet.mode,
        metric: maxLinesRatchet.metric,
        fileCount: 1,
        totalFindings: 1,
      },
    ]);
  });

  it("formats a deterministic table with right-aligned numeric columns", () => {
    const rows: readonly LintRatchetSummaryRow[] = [
      {
        id: "ratchet/a",
        ruleId: "rule-a",
        mode: "no-new",
        metric: "message-count",
        fileCount: 2,
        totalFindings: 10,
      },
      {
        id: "ratchet/longer-id",
        ruleId: "long-rule",
        mode: "no-new",
        metric: "effective-line-count",
        fileCount: 12,
        totalFindings: 3,
      },
    ];
    const formatted = formatLintRatchetSummary(rows);
    const lines = formatted.trimEnd().split("\n");

    expect(formatted).toBe(formatLintRatchetSummary(rows));
    expect(lines[0]).toMatch(/^ratchet\s+rule\s+metric\s+files\s+findings$/u);
    expect(lines[1]).toMatch(/\s{4}2\s+10$/u);
    expect(lines[2]).toMatch(/\s12\s+3$/u);
    expect(lines[1]?.indexOf("2")).toBeGreaterThan(lines[2]?.indexOf("12") ?? 0);
  });

  it("formats an empty baseline as a header plus no-ratchets body", () => {
    const emptyBaseline: LintRatchetBaseline = { version: 1, tests: {} };
    expect(formatLintRatchetSummary(summarizeLintRatchetBaseline(emptyBaseline, []))).toBe(
      "ratchet  rule  metric  files  findings\n(no ratchets)\n",
    );
  });

  it("sums complexity-severity counts without summing max complexity", () => {
    const baseline = buildLintRatchetBaseline(
      [complexityRatchet],
      currentById([
        [
          complexityRatchet.id,
          [
            [
              "packages/app/src/branchy-a.ts",
              {
                count: 2,
                perFunction: [
                  complexityFunction(10, "Function 'chooseA'", 12),
                  complexityFunction(20, "Function 'chooseB'", 15),
                ],
              },
            ],
            [
              "packages/app/src/branchy-b.ts",
              {
                count: 1,
                perFunction: [complexityFunction(30, "Function 'chooseC'", 30)],
              },
            ],
          ],
        ],
      ]),
      ruleSourceHashes,
    );

    expect(summarizeLintRatchetBaseline(baseline, [complexityRatchet])).toEqual([
      {
        id: complexityRatchet.id,
        ruleId: complexityRatchet.ruleId,
        mode: complexityRatchet.mode,
        metric: complexityRatchet.metric,
        fileCount: 2,
        totalFindings: 3,
      },
    ]);
  });
});
