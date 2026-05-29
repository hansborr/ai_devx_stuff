import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { LintRatchetDebtLogEntry } from "./lint-ratchet/debt-log-schema.js";
import {
  formatLintRatchetDebtLogReport,
  readLintRatchetDebtLog,
  runLintRatchetDebtLogReport,
} from "./lint-ratchet-debt-log.js";

const tempRoots: string[] = [];

function tempDebtLog(contents: string): string {
  const tempRoot = mkdtempSync(join(tmpdir(), "lint-ratchet-debt-log-"));
  tempRoots.push(tempRoot);
  const path = join(tempRoot, "lint-ratchet.debt-log.jsonl");
  writeFileSync(path, contents);
  return path;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const tempRoot = tempRoots.pop();
    if (tempRoot !== undefined) rmSync(tempRoot, { recursive: true, force: true });
  }
});

function entryWithReason(acceptanceReason: string): LintRatchetDebtLogEntry {
  return {
    version: "1",
    acceptanceReason,
    regressions: [
      {
        testId: "ratchet/x",
        ruleId: "no-debugger",
        path: "packages/server/src/a.ts",
        baselineCount: 1,
        currentCount: 2,
        reason: "increased-count",
      },
    ],
    orphansRemoved: [],
  };
}

const minimalEntry = entryWithReason("intentional debt that is described sufficiently");

describe("formatLintRatchetDebtLogReport", () => {
  it("renders an empty report for no entries", () => {
    const report = formatLintRatchetDebtLogReport([]);
    expect(report).toContain("<!-- lint-ratchet-debt-log -->\n### Lint ratchet debt log");
    expect(report).toContain("No debt acceptances recorded yet. (clean)");
  });

  it("preserves append order, oldest first", () => {
    const report = formatLintRatchetDebtLogReport([
      entryWithReason("the older acceptance"),
      entryWithReason("the newer acceptance"),
    ]);
    expect(report.indexOf("Acceptance 1")).toBeLessThan(report.indexOf("Acceptance 2"));
    expect(report.indexOf("the older acceptance")).toBeLessThan(
      report.indexOf("the newer acceptance"),
    );
  });

  it("escapes table- and HTML-sensitive characters in every cell", () => {
    const report = formatLintRatchetDebtLogReport([
      {
        version: "1",
        acceptanceReason: "reason with | pipe and <tag> and `tick`",
        regressions: [
          {
            testId: "ratchet/x|y",
            ruleId: "no-debugger",
            path: "packages/<dir>/a|b.ts",
            baselineCount: 1,
            currentCount: 2,
            reason: "increased-count",
          },
        ],
        orphansRemoved: [
          {
            testId: "ratchet/old|x",
            ruleId: "complexity",
            metric: "complexity-severity",
            baselineItems: [
              {
                path: "packages/c<d>/e|f.ts",
                count: 1,
                maxComplexity: 12,
                perFunction: [{ line: 3, label: "fn|<weird>", complexity: 12 }],
              },
            ],
          },
        ],
      },
    ]);

    // Raw delimiters must not survive into any rendered cell.
    expect(report).not.toContain("<dir>");
    expect(report).not.toContain("a|b.ts");
    expect(report).not.toContain("e|f.ts");
    // Escaped forms across the regression path, orphan path, and function label.
    expect(report).toContain("packages/&lt;dir&gt;/a\\|b.ts");
    expect(report).toContain("packages/c&lt;d&gt;/e\\|f.ts");
    expect(report).toContain("fn\\|&lt;weird&gt;");
    expect(report).toContain("ratchet/x\\|y");
    expect(report).toContain("\\`tick\\`");
  });

  it("renders the count and complexity deltas for regressions", () => {
    const report = formatLintRatchetDebtLogReport([
      {
        version: "1",
        acceptanceReason: "complexity debt accepted intentionally for now",
        regressions: [
          {
            testId: "ratchet/c",
            ruleId: "complexity",
            path: "packages/server/src/b.ts",
            baselineCount: 1,
            currentCount: 1,
            baselineComplexity: 12,
            currentComplexity: 18,
            reason: "increased-complexity",
          },
        ],
        orphansRemoved: [],
      },
    ]);
    expect(report).toContain("complexity 12 → 18");
  });
});

describe("readLintRatchetDebtLog", () => {
  it("tolerates a trailing newline", () => {
    const line = JSON.stringify(minimalEntry);
    expect(readLintRatchetDebtLog(`${line}\n`)).toEqual(readLintRatchetDebtLog(line));
    expect(readLintRatchetDebtLog(`${line}\n`)).toHaveLength(1);
  });

  it("throws naming the line number for non-JSON", () => {
    expect(() => readLintRatchetDebtLog("not json\n")).toThrow(/line 1/);
  });

  it("throws naming the line number for a structurally invalid entry", () => {
    const valid = JSON.stringify(minimalEntry);
    expect(() => readLintRatchetDebtLog(`${valid}\n{"version":"1"}\n`)).toThrow(/line 2/);
  });
});

describe("runLintRatchetDebtLogReport", () => {
  it("returns the empty report without throwing when the file is absent", () => {
    const report = runLintRatchetDebtLogReport({
      debtLogPath: join(tmpdir(), "lint-ratchet-debt-log-absent-fixture.jsonl"),
    });
    expect(report).toContain("No debt acceptances recorded yet");
  });

  it("renders each recorded acceptance from the committed file", () => {
    const path = tempDebtLog(
      `${JSON.stringify(entryWithReason("first recorded acceptance"))}\n` +
        `${JSON.stringify(entryWithReason("second recorded acceptance"))}\n`,
    );
    const report = runLintRatchetDebtLogReport({ debtLogPath: path });
    expect(report).toContain("Acceptance 1");
    expect(report).toContain("Acceptance 2");
    expect(report).toContain("first recorded acceptance");
    expect(report).toContain("second recorded acceptance");
  });
});
