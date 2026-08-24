import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { fixtureWorkflowVocabulary } from "../../test/fixture-workflow-vocabulary.js";
import { customWorkflowVocabulary } from "../../test/fixture-workflow-vocabulary.js";
import { currentById, FIXTURE_HASH } from "../../test/support/lint-ratchet.test-helper.js";
import {
  buildLintRatchetBaseline,
  type LintRatchetBaseline,
  type LintRatchetRuleSourceHashesById,
} from "../kernel/baseline.js";
import {
  LINT_RATCHET_BASELINE_WRITE_VERSION,
  lintRatchetBaselineRegenerateForVersion,
} from "../kernel/baseline-constants.js";
import type { LintRatchetConfig } from "../kernel/config-types.js";
import type { LintRatchetComplexityFunction } from "../kernel/metrics-types.js";
import {
  formatLintRatchetDirectorySummary,
  formatLintRatchetSummary,
  type LintRatchetSummaryRow,
  runLintRatchetSummaryCli,
  summarizeLintRatchetBaseline,
  summarizeLintRatchetBaselineByDirectory,
} from "./summary.js";

const messageRatchet: LintRatchetConfig = {
  id: "ratchet/fixture-message",
  ruleId: "no-alert",
  source: { kind: "core" },
  parserProfile: "minimal-ts",
  files: ["packages/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  mode: "no-new",
  metric: "message-count",
  principle: "Fixture message ratchet principle.",
};

const maxLinesRatchet: LintRatchetConfig = {
  id: "ratchet/fixture-max-lines",
  ruleId: "local/max-lines",
  files: ["packages/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  mode: "no-new",
  metric: "effective-line-count",
  principle: "Fixture max-lines ratchet principle.",
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
  metric: "complexity-severity",
  principle: "Fixture complexity ratchet principle.",
};

const ruleSourceHashes: LintRatchetRuleSourceHashesById = new Map([
  [messageRatchet.id, FIXTURE_HASH],
  [maxLinesRatchet.id, FIXTURE_HASH],
  [complexityRatchet.id, FIXTURE_HASH],
]);

function complexityFunction(
  line: number,
  label: string,
  complexity: number,
): LintRatchetComplexityFunction {
  return { line, label, complexity };
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
      [maxLinesRatchet.id, [["packages/app/src/large.ts", { count: 1, lines: 340 }]]],
    ]),
    ruleSourceHashes,
    { workflowVocabulary: fixtureWorkflowVocabulary },
  );
}

describe("lint ratchet summary", () => {
  it("uses the actual custom baseline filename in conflict-marker remediation", () => {
    const root = mkdtempSync(join(tmpdir(), "lint-ratchet-summary-"));
    const baselinePath = join(root, "custom-floor.json");
    writeFileSync(
      baselinePath,
      '<<<<<<< ours\n{"version":2}\n=======\n{"version":2}\n>>>>>>> theirs\n',
    );
    try {
      expect(() => {
        runLintRatchetSummaryCli(baselinePath, [], undefined, customWorkflowVocabulary);
      }).toThrow(
        "custom-floor.json is generated; Git conflict markers mean its semantic merge driver was not installed",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reduces a parsed baseline and matching registry to per-ratchet rows", () => {
    expect(
      summarizeLintRatchetBaseline(fixtureBaseline(), [messageRatchet, maxLinesRatchet]),
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
    expect(lines[0]).toMatch(/^ratchet\s+rule\s+metric\s+debt files\s+findings$/u);
    expect(lines[1]).toMatch(/\s{4}2\s+10$/u);
    expect(lines[2]).toMatch(/\s12\s+3$/u);
    expect(lines[1]?.indexOf("2")).toBeGreaterThan(lines[2]?.indexOf("12") ?? 0);
  });

  it("formats an empty baseline as a header plus no-ratchets body", () => {
    const regenerate = lintRatchetBaselineRegenerateForVersion(
      LINT_RATCHET_BASELINE_WRITE_VERSION,
      fixtureWorkflowVocabulary.updateCommand,
    );
    const emptyBaseline: LintRatchetBaseline = {
      version: LINT_RATCHET_BASELINE_WRITE_VERSION,
      ...(regenerate === undefined ? {} : { regenerate }),
      tests: {},
    };
    expect(formatLintRatchetSummary(summarizeLintRatchetBaseline(emptyBaseline, []))).toBe(
      "ratchet  rule  metric  debt files  findings\n(no ratchets)\n",
    );
  });

  it("groups findings by directory at the requested depth", () => {
    const baseline = buildLintRatchetBaseline(
      [messageRatchet],
      currentById([
        [
          messageRatchet.id,
          [
            ["packages/app/src/a.ts", { count: 2 }],
            ["packages/app/src/b.ts", { count: 3 }],
            ["packages/server/src/c.ts", { count: 4 }],
          ],
        ],
      ]),
      ruleSourceHashes,
      { workflowVocabulary: fixtureWorkflowVocabulary },
    );

    expect(summarizeLintRatchetBaselineByDirectory(baseline, [messageRatchet], 3)).toEqual([
      {
        id: messageRatchet.id,
        ruleId: messageRatchet.ruleId,
        metric: messageRatchet.metric,
        directory: "packages/app/src",
        fileCount: 2,
        totalFindings: 5,
      },
      {
        id: messageRatchet.id,
        ruleId: messageRatchet.ruleId,
        metric: messageRatchet.metric,
        directory: "packages/server/src",
        fileCount: 1,
        totalFindings: 4,
      },
    ]);
  });

  it("formats directory grouping rows with the directory column", () => {
    const formatted = formatLintRatchetDirectorySummary([
      {
        id: "ratchet/a",
        ruleId: "rule-a",
        metric: "message-count",
        directory: "packages/app/src",
        fileCount: 2,
        totalFindings: 10,
      },
    ]);

    expect(formatted).toBe(
      "ratchet    rule    metric         directory         debt files  findings\n" +
        "ratchet/a  rule-a  message-count  packages/app/src           2        10\n",
    );
  });

  it("renders directory grouping cells raw (no markdown escaping in terminal tables)", () => {
    const formatted = formatLintRatchetDirectorySummary([
      {
        id: "ratchet/path_cell",
        ruleId: "rule|a",
        metric: "message-count",
        directory: "packages/app_|src",
        fileCount: 1,
        totalFindings: 2,
      },
    ]);

    expect(formatted).toContain("ratchet/path_cell");
    expect(formatted).toContain("rule|a");
    expect(formatted).toContain("packages/app_|src");
    expect(formatted).not.toContain("\\");
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
      { workflowVocabulary: fixtureWorkflowVocabulary },
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
