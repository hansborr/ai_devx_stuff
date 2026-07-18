import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  formatLintRatchetDebtLogReport,
  readLintRatchetDebtLog,
  runLintRatchetDebtLogReport,
} from "@musi/lint-ratchet/governance/debt-log.js";
import type { LintRatchetDebtLogEntry } from "@musi/lint-ratchet/governance/debt-log-schema.js";
import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";

const tmpRepo = registerTempRootCleanup();

function tempDebtLog(contents: string): string {
  const tempRoot = tmpRepo.writeRepo(
    { "lint-ratchet.debt-log.jsonl": contents },
    "lint-ratchet-debt-log-",
  );
  const path = join(tempRoot, "lint-ratchet.debt-log.jsonl");
  return path;
}

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

function legacyRemoval(acceptanceReason: string): LintRatchetDebtLogEntry {
  return {
    version: "1",
    acceptanceReason,
    regressions: [],
    orphansRemoved: [
      {
        testId: "ratchet/retired",
        ruleId: "no-debugger",
        metric: "message-count",
        baselineItems: [],
      },
    ],
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

  it("labels legacy removal-only records separately and reports category totals", () => {
    const report = formatLintRatchetDebtLogReport([
      legacyRemoval("promoted into normal lint"),
      entryWithReason("the one accepted debt increase"),
      {
        version: "1",
        kind: "retirement",
        ratchetId: "ratchet/promoted",
        promotionProof: "normal-lint-error",
      },
    ]);

    expect(report).toContain("Accepted-debt records: 1");
    expect(report).toContain("Retirement/removal records: 2");
    expect(report).toContain("Legacy retirement/removal 1");
    expect(report).not.toContain("Acceptance 1");
    expect(report).toContain("Acceptance 2");
    expect(report).toContain("Retirement 3");
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

  it("renders coverage-shrink records with removed paths and glob identities", () => {
    const report = formatLintRatchetDebtLogReport([
      {
        version: "1",
        kind: "coverage-shrink",
        ratchetId: "ratchet/narrowed",
        previousFiles: ["packages/**/*.ts"],
        currentFiles: ["packages/server/**/*.ts"],
        previousIgnores: [],
        currentIgnores: ["packages/server/src/generated.ts"],
        removedPaths: ["packages/client/src/legacy.ts"],
        reason: "the client floor moved to a dedicated ratchet",
      },
    ]);

    expect(report).toContain("Coverage shrink 1");
    expect(report).toContain("packages/client/src/legacy.ts");
    expect(report).toContain("packages/server/src/generated.ts");
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

  // Strictness pinned deliberately: the debt log is tool-written (merge=union),
  // so any blank beyond the single final newline is corruption, not slop.
  // Opposite policy from logs-audit's auditJsonlText, which forgives all
  // trailing blanks — that divergence is intentional, not drift.

  it("rejects a double trailing newline as an empty line 2", () => {
    const valid = JSON.stringify(minimalEntry);
    expect(() => readLintRatchetDebtLog(`${valid}\n\n`)).toThrow(/line 2/);
  });

  it("rejects an interior blank line", () => {
    const valid = JSON.stringify(minimalEntry);
    expect(() => readLintRatchetDebtLog(`${valid}\n\n${valid}\n`)).toThrow(/line 2/);
  });
});

describe("runLintRatchetDebtLogReport", () => {
  it("returns the empty report without throwing when the file is absent", () => {
    const report = runLintRatchetDebtLogReport({
      repoRoot: tmpdir(),
      debtLogPath: join(tmpdir(), "lint-ratchet-debt-log-absent-fixture.jsonl"),
    });
    expect(report).toContain("No debt acceptances recorded yet");
  });

  it("renders each recorded acceptance from the committed file", () => {
    const path = tempDebtLog(
      `${JSON.stringify(entryWithReason("first recorded acceptance"))}\n` +
        `${JSON.stringify(entryWithReason("second recorded acceptance"))}\n`,
    );
    const report = runLintRatchetDebtLogReport({ repoRoot: tmpdir(), debtLogPath: path });
    expect(report).toContain("Acceptance 1");
    expect(report).toContain("Acceptance 2");
    expect(report).toContain("first recorded acceptance");
    expect(report).toContain("second recorded acceptance");
  });
});
