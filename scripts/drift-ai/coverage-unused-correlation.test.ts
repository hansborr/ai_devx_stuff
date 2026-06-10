import { describe, expect, it } from "vitest";

import type {
  CoverageArtifactEvidence,
  CoverageFileEvidence,
  CoverageFunctionEvidence,
  CoverageLineEvidence,
} from "./coverage-types.js";
import {
  correlateCoverageUnusedExports,
  CORRELATION_STANDING_CAVEAT,
} from "./coverage-unused-correlation.js";
import { findDeadCodeCorpusLabel, loadDeadCodeCorpusLabels } from "./dead-code-corpus.js";
import type { UnusedExportCategory, UnusedExportSymbol } from "./knip-unused-exports.js";

describe("correlateCoverageUnusedExports", () => {
  it("flags a statically-unused symbol that runtime coverage executed as a conflict", () => {
    const artifact = lcovArtifact("unit", "coverage/unit.info", [
      file("src/math.ts", [fn("add", 1, 3)], []),
    ]);
    const result = correlateCoverageUnusedExports([sym("src/math.ts", "add", 1, 17)], [artifact]);

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row?.agreement).toBe("covered-but-unused");
    expect(row?.coverage[0]?.state).toBe("covered");
    expect(row?.coverage[0]?.hits).toBe(3);
    expect(row?.coverage[0]?.matchKind).toBe("function-range");
    expect(result.stats.coveredButUnused).toBe(1);
  });

  it("marks a statically-unused symbol that was never executed as both signals agreeing", () => {
    const artifact = lcovArtifact("unit", "coverage/unit.info", [
      file("src/math.ts", [fn("subtract", 5, 0)], []),
    ]);
    const result = correlateCoverageUnusedExports(
      [sym("src/math.ts", "subtract", 5, 17)],
      [artifact],
    );

    const row = result.rows[0];
    expect(row?.agreement).toBe("uncovered-and-unused");
    expect(row?.coverage[0]?.state).toBe("uncovered");
    expect(row?.coverage[0]?.hits).toBe(0);
    expect(result.stats.uncoveredAndUnused).toBe(1);
  });

  it("reports coverage as unavailable when the symbol's file is in no artifact", () => {
    const artifact = lcovArtifact("unit", "coverage/unit.info", [
      file("src/math.ts", [fn("add", 1, 3)], []),
    ]);
    const result = correlateCoverageUnusedExports(
      [sym("src/ghost.ts", "ghostHelper", 3, 1)],
      [artifact],
    );

    const row = result.rows[0];
    expect(row?.agreement).toBe("coverage-unavailable");
    expect(row?.coverage[0]?.state).toBe("unavailable");
    expect(row?.coverage[0]?.pathMatch).toBe("none");
    expect(row?.coverage[0]?.note).toContain("not present in this artifact");
    expect(result.stats.fileNotInAnyArtifact).toBe(1);
  });

  it("reports unavailable when the file matched but no record covers the symbol line", () => {
    const artifact = lcovArtifact("unit", "coverage/unit.info", [
      file("src/math.ts", [fn("add", 1, 3)], []),
    ]);
    const result = correlateCoverageUnusedExports(
      [sym("src/math.ts", "elsewhere", 42, 1)],
      [artifact],
    );

    const cov = result.rows[0]?.coverage[0];
    expect(cov?.state).toBe("unavailable");
    expect(cov?.pathMatch).toBe("exact");
    expect(cov?.note).toContain("no coverage record at src/math.ts:42");
    // file present, line absent is NOT the same as the file being missing entirely.
    expect(result.stats.fileNotInAnyArtifact).toBe(0);
    expect(result.rows[0]?.agreement).toBe("coverage-unavailable");
  });

  it("cannot align a symbol that knip emitted without a location", () => {
    const artifact = lcovArtifact("unit", "coverage/unit.info", [
      file("src/math.ts", [fn("add", 1, 3)], []),
    ]);
    const result = correlateCoverageUnusedExports([sym("src/math.ts", "add")], [artifact]);

    const row = result.rows[0];
    expect(row?.hasLocation).toBe(false);
    expect(row?.agreement).toBe("coverage-unavailable");
    expect(row?.coverage[0]?.note).toContain("no source location");
    expect(result.stats.missingLocation).toBe(1);
    expect(result.stats.fileNotInAnyArtifact).toBe(0);
  });

  it("keeps per-artifact coverage distinct instead of unioning the runs", () => {
    const unit = lcovArtifact("unit", "coverage/unit.info", [
      file("src/math.ts", [fn("subtract", 5, 0)], []),
    ]);
    const e2e = lcovArtifact("e2e", "coverage/e2e.info", [
      file("src/math.ts", [fn("subtract", 5, 2)], []),
    ]);
    const result = correlateCoverageUnusedExports(
      [sym("src/math.ts", "subtract", 5, 17)],
      [unit, e2e],
    );

    const row = result.rows[0];
    expect(row?.coverage.map((c) => `${c.label}:${c.state}:${c.hits ?? "n/a"}`)).toEqual([
      "unit:uncovered:0",
      "e2e:covered:2",
    ]);
    // Any artifact executing the symbol makes it a conflict, but the runs stay separate.
    expect(row?.agreement).toBe("covered-but-unused");
  });

  it("matches a line record when no function declaration covers the line", () => {
    const artifact = lcovArtifact("unit", "coverage/unit.info", [
      file("src/util.ts", [], [line(12, 4)]),
    ]);
    const result = correlateCoverageUnusedExports(
      [sym("src/util.ts", "helper", 12, 3)],
      [artifact],
    );

    const cov = result.rows[0]?.coverage[0];
    expect(cov?.matchKind).toBe("line");
    expect(cov?.state).toBe("covered");
    expect(cov?.matchedLine).toBe(12);
  });

  it("matches a function range when the symbol line falls inside the declared span", () => {
    const artifact = lcovArtifact("unit", "coverage/unit.info", [
      file("src/util.ts", [fnRange("format", 2, 8, 7)], []),
    ]);
    const result = correlateCoverageUnusedExports([sym("src/util.ts", "format", 5, 1)], [artifact]);

    const cov = result.rows[0]?.coverage[0];
    expect(cov?.matchKind).toBe("function-range");
    expect(cov?.matchedLine).toBe(2);
    expect(cov?.matchedEndLine).toBe(8);
    expect(cov?.state).toBe("covered");
  });

  it("falls back to a path-suffix match and discloses it when paths differ in root", () => {
    const artifact = lcovArtifact("unit", "coverage/unit.info", [
      file("packages/server/src/a.ts", [fn("only", 1, 1)], []),
    ]);
    const result = correlateCoverageUnusedExports([sym("src/a.ts", "only", 1, 1)], [artifact]);

    const cov = result.rows[0]?.coverage[0];
    expect(cov?.pathMatch).toBe("suffix");
    expect(cov?.state).toBe("covered");
    expect(cov?.note).toContain("path suffix");
    expect(result.stats.suffixMatched).toBe(1);
  });

  it("orders conflicts first, then agreements, then unavailable, and ranks deterministically", () => {
    const artifact = lcovArtifact("unit", "coverage/unit.info", [
      file("src/a.ts", [fn("covered", 1, 9), fn("uncovered", 5, 0)], []),
    ]);
    const result = correlateCoverageUnusedExports(
      [
        sym("src/z.ts", "missing", 1, 1),
        sym("src/a.ts", "uncovered", 5, 1),
        sym("src/a.ts", "covered", 1, 1),
      ],
      [artifact],
    );

    expect(result.rows.map((row) => `${row.rank}:${row.symbol}:${row.agreement}`)).toEqual([
      "1:covered:covered-but-unused",
      "2:uncovered:uncovered-and-unused",
      "3:missing:coverage-unavailable",
    ]);
  });

  it("carries the standing trap caveat on every row", () => {
    const result = correlateCoverageUnusedExports([sym("src/a.ts", "x", 1, 1)], []);
    expect(result.rows[0]?.caveats).toContain(CORRELATION_STANDING_CAVEAT);
  });
});

describe("dead-code FP-trap corpus calibration", () => {
  const labels = loadDeadCodeCorpusLabels();
  const trapLabels = labels.labels.filter((label) => label.kind === "true-trap");
  const trapLabeler = (symbol: UnusedExportSymbol): readonly string[] => {
    const label = findDeadCodeCorpusLabel(labels, { filePath: symbol.file, symbol: symbol.name });
    return label === undefined ? [] : [`${label.kind}: ${label.reason}`];
  };

  it("has true-trap fixtures to calibrate against", () => {
    expect(trapLabels.length).toBeGreaterThan(0);
  });

  // The dangerous case: knip flags the trap as unused AND coverage shows zero hits,
  // so both signals "agree" it is dead. A barrel re-export, dynamic import(), or
  // reflection target can hit exactly this. The row must STILL carry the standing
  // caveat and its trap label rather than reading as a deletion candidate.
  it("keeps the trap caveat even when both signals agree the symbol is unused", () => {
    for (const label of trapLabels) {
      const symbol = sym(label.path, label.symbol, 10, 1);
      const artifact = lcovArtifact("unit", "coverage/unit.info", [
        file(label.path, [fn(label.symbol, 10, 0)], []),
      ]);
      const result = correlateCoverageUnusedExports([symbol], [artifact], {
        caveatLabeler: trapLabeler,
      });
      const row = result.rows[0];
      // We actually drove the both-agree path, not the vacuous unavailable one.
      expect(row?.agreement).toBe("uncovered-and-unused");
      expect(row?.caveats).toContain(CORRELATION_STANDING_CAVEAT);
      expect(row?.caveats.some((caveat) => caveat.startsWith("true-trap:"))).toBe(true);
    }
  });

  // The mirror case: a dynamically-used trap that coverage executed. knip still
  // calls it unused, so it surfaces as a covered-but-unused CONFLICT (a static
  // false-positive lead), never as dead.
  it("flags a trap executed at runtime as a conflict, not as dead", () => {
    const label = trapLabels[0];
    expect(label).toBeDefined();
    if (label === undefined) return;
    const artifact = lcovArtifact("e2e", "coverage/e2e.info", [
      file(label.path, [fn(label.symbol, 10, 4)], []),
    ]);
    const result = correlateCoverageUnusedExports(
      [sym(label.path, label.symbol, 10, 1)],
      [artifact],
      {
        caveatLabeler: trapLabeler,
      },
    );
    const row = result.rows[0];
    expect(row?.agreement).toBe("covered-but-unused");
    expect(row?.coverage[0]?.hits).toBe(4);
    expect(row?.caveats).toContain(CORRELATION_STANDING_CAVEAT);
    expect(row?.caveats.some((caveat) => caveat.startsWith("true-trap:"))).toBe(true);
  });
});

function sym(
  file: string,
  name: string,
  line?: number,
  col?: number,
  category: UnusedExportCategory = "exports",
): UnusedExportSymbol {
  const base = { category, file, name };
  if (line === undefined || col === undefined) return base;
  return { ...base, line, col };
}

function fn(name: string, line: number, hits: number): CoverageFunctionEvidence {
  return { name, line, hits };
}

function fnRange(
  name: string,
  line: number,
  endLine: number,
  hits: number,
): CoverageFunctionEvidence {
  return { name, line, endLine, hits };
}

function line(lineNo: number, hits: number): CoverageLineEvidence {
  return { line: lineNo, hits };
}

function file(
  filePath: string,
  functions: readonly CoverageFunctionEvidence[],
  lines: readonly CoverageLineEvidence[],
): CoverageFileEvidence {
  return {
    file: filePath,
    functions,
    lines,
    functionsFound: functions.length,
    functionsHit: functions.filter((entry) => entry.hits > 0).length,
    linesFound: lines.length,
    linesHit: lines.filter((entry) => entry.hits > 0).length,
  };
}

function lcovArtifact(
  label: string,
  artifactPath: string,
  files: readonly CoverageFileEvidence[],
): CoverageArtifactEvidence {
  return { path: artifactPath, label, format: "lcov", timestamp: null, files, notes: [] };
}
