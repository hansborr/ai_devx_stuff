import { describe, expect, it } from "vitest";

import type { CoverageArtifactEvidence, CoverageFileEvidence } from "./coverage-types.js";
import { correlateCoverageUnusedExports } from "./coverage-unused-correlation.js";
import {
  buildCoverageUnusedCorrelationAdvisory,
  type CoverageUnusedCorrelationAdvisoryInput,
  formatCoverageUnusedCorrelationJson,
  formatCoverageUnusedCorrelationText,
  type UnusedExportsReportStatus,
} from "./coverage-unused-correlation-advisory.js";
import type { UnusedExportSymbol } from "./knip-unused-exports.js";

describe("buildCoverageUnusedCorrelationAdvisory", () => {
  it("stamps the prototype envelope and never carries a findings key", () => {
    const advisory = build({ report: ok(2) });

    expect(advisory.kind).toBe("advisory");
    expect(advisory.lane).toBe("prototype");
    expect(advisory.subcommand).toBe("coverage-unused-exports");
    expect("findings" in advisory).toBe(false);
    const json = JSON.parse(formatCoverageUnusedCorrelationJson(advisory)) as Record<
      string,
      unknown
    >;
    expect("findings" in json).toBe(false);
  });

  it("discloses an absent unused-exports report as an unmet prerequisite", () => {
    const advisory = buildCoverageUnusedCorrelationAdvisory({
      report: { kind: "absent" },
      artifactCount: 1,
      coverageDegradations: [],
      result: { rows: [], stats: emptyStats() },
      top: 50,
    });
    const reportPrereq = advisory.prerequisites.find((p) => p.name === "unused-exports report");

    expect(reportPrereq?.satisfied).toBe(false);
    const text = formatCoverageUnusedCorrelationText(advisory);
    expect(text).toContain("prerequisite unused-exports report: unmet");
    expect(text).toContain("no unused-export report parsed");
  });

  it("renders conflict, agreement, and unavailable rows with separate static and runtime signals", () => {
    const advisory = build({ report: ok(3) });
    const text = formatCoverageUnusedCorrelationText(advisory);

    expect(text).toContain("[covered-but-unused] exports src/math.ts:1:17 add");
    expect(text).toContain("coverage[unit] (lcov): covered -- hits 3");
    expect(text).toContain("[uncovered-and-unused] exports src/math.ts:5:17 subtract");
    expect(text).toContain("coverage[unit] (lcov): uncovered -- hits 0");
    expect(text).toContain("[coverage-unavailable] exports src/ghost.ts:3:1 ghostHelper");
    // brand firewall: candidate language only, never WARN/FIX.
    expect(text).not.toContain("WARN");
    expect(text).not.toContain("FIX:");
    expect(text).toContain("not a deletion verdict");
  });

  it("discloses the parser limitation and a missing-file degradation", () => {
    const advisory = build({ report: ok(3) });
    expect(
      advisory.degradations.some((note) => note.includes("lcov line/function precision")),
    ).toBe(true);
    expect(
      advisory.degradations.some((note) =>
        note.includes("no matching file in any coverage artifact"),
      ),
    ).toBe(true);
  });

  it("discloses the display cap as partial when more rows exist than --top", () => {
    const advisory = build({ report: ok(3), top: 1 });
    const cap = advisory.caps.find((entry) => entry.label === "correlation rows");

    expect(cap?.hit).toBe(true);
    expect(advisory.sections[0]?.entries).toHaveLength(1);
    expect(advisory.sections[0]?.totalCandidates).toBe(3);
    expect(formatCoverageUnusedCorrelationText(advisory)).toContain("showing 1 of 3 candidates");
  });
});

type BuildOptions = {
  readonly report: UnusedExportsReportStatus;
  readonly top?: number;
};

function build(options: BuildOptions): ReturnType<typeof buildCoverageUnusedCorrelationAdvisory> {
  const artifact = lcovArtifact("unit", [
    fileEvidence("src/math.ts", [
      { name: "add", line: 1, hits: 3 },
      { name: "subtract", line: 5, hits: 0 },
    ]),
  ]);
  const symbols: UnusedExportSymbol[] = [
    { category: "exports", file: "src/math.ts", name: "add", line: 1, col: 17 },
    { category: "exports", file: "src/math.ts", name: "subtract", line: 5, col: 17 },
    { category: "exports", file: "src/ghost.ts", name: "ghostHelper", line: 3, col: 1 },
  ];
  const result = correlateCoverageUnusedExports(symbols, [artifact]);
  const input: CoverageUnusedCorrelationAdvisoryInput = {
    report: options.report,
    artifactCount: 1,
    coverageDegradations: [],
    result,
    top: options.top ?? 50,
  };
  return buildCoverageUnusedCorrelationAdvisory(input);
}

function ok(symbolCount: number): UnusedExportsReportStatus {
  return { kind: "ok", path: "knip-report.json", symbolCount };
}

function lcovArtifact(
  label: string,
  files: readonly CoverageFileEvidence[],
): CoverageArtifactEvidence {
  return {
    path: `coverage/${label}.info`,
    label,
    format: "lcov",
    timestamp: null,
    files,
    notes: [],
  };
}

function fileEvidence(
  filePath: string,
  functions: readonly { name: string; line: number; hits: number }[],
): CoverageFileEvidence {
  return {
    file: filePath,
    functions,
    lines: [],
    functionsFound: functions.length,
    functionsHit: functions.filter((fn) => fn.hits > 0).length,
    linesFound: 0,
    linesHit: 0,
  };
}

function emptyStats(): ReturnType<typeof correlateCoverageUnusedExports>["stats"] {
  return {
    totalSymbols: 0,
    missingLocation: 0,
    fileNotInAnyArtifact: 0,
    suffixMatched: 0,
    coveredButUnused: 0,
    uncoveredAndUnused: 0,
    coverageUnavailable: 0,
  };
}
