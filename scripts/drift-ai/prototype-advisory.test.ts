import { describe, expect, it } from "vitest";

import {
  appendPrototypeSection,
  buildPrototypeAdvisory,
  formatPrototypeAdvisoryJson,
  formatPrototypeHeader,
  PROTOTYPE_ADVISORY_BANNER,
  PROTOTYPE_ADVISORY_LANE,
  type PrototypeAdvisory,
  type PrototypeSection,
  prototypeTruncationNote,
  rowsPerSectionCap,
} from "./prototype-advisory.js";

// A representative future prototype lens (stand-in for tasks 41-48): one candidate kind
// with a couple of rows, an unmet prerequisite, a cap that was hit (partial run), and a
// degradation. Renders each row to one line. This fixture is the contract under test.
type FakeRow = { readonly path: string; readonly score: number };

const SECTION: PrototypeSection<FakeRow> = {
  candidateKind: "near-duplicate clusters",
  totalCandidates: 5,
  emptyReason: null,
  entries: [
    { path: "src/a.ts", score: 0.91 },
    { path: "src/b.ts", score: 0.88 },
  ],
};

function fixtureAdvisory(): PrototypeAdvisory<PrototypeSection<FakeRow>> {
  return buildPrototypeAdvisory<PrototypeSection<FakeRow>>({
    subcommand: "clone-candidates",
    prerequisites: [{ name: "dolos binary", satisfied: false, detail: "not on PATH" }],
    caps: [
      {
        label: "candidate pairs",
        limit: 5000,
        hit: true,
        detail: "stopped after 5000 of ~12000 pairs",
      },
    ],
    degradations: ["line counts unavailable on a blobless clone"],
    sections: [SECTION],
  });
}

function renderRow(row: FakeRow): readonly string[] {
  return [`${row.path}  score ${row.score}`];
}

function renderText(advisory: PrototypeAdvisory<PrototypeSection<FakeRow>>): string {
  const lines = formatPrototypeHeader(advisory);
  for (const section of advisory.sections) {
    lines.push("");
    appendPrototypeSection(lines, section, renderRow);
  }
  return lines.join("\n");
}

describe("buildPrototypeAdvisory", () => {
  it("stamps the firewall envelope (kind / lane / banner) so a lens cannot forget it", () => {
    const advisory = fixtureAdvisory();
    expect(advisory.kind).toBe("advisory");
    expect(advisory.lane).toBe(PROTOTYPE_ADVISORY_LANE);
    expect(advisory.lane).toBe("prototype");
    expect(advisory.banner).toBe(PROTOTYPE_ADVISORY_BANNER);
  });

  it("defaults the disclosure arrays to empty when omitted", () => {
    const advisory = buildPrototypeAdvisory<PrototypeSection<FakeRow>>({
      subcommand: "clone-candidates",
      sections: [],
    });
    expect(advisory.prerequisites).toEqual([]);
    expect(advisory.caps).toEqual([]);
    expect(advisory.degradations).toEqual([]);
  });
});

describe("brand firewall", () => {
  it("the banner carries no WARN/FIX finding language", () => {
    expect(PROTOTYPE_ADVISORY_BANNER).not.toMatch(/WARN/u);
    expect(PROTOTYPE_ADVISORY_BANNER).not.toMatch(/FIX:/u);
  });

  it("JSON has no top-level `findings` key and keeps the advisory/prototype top level", () => {
    // type-assertion-boundary: test - JSON.parse returns the advisory JSON
    // text; the top-level key shape is the contract under test.
    const parsed = JSON.parse(formatPrototypeAdvisoryJson(fixtureAdvisory())) as Record<
      string,
      unknown
    >;
    expect("findings" in parsed).toBe(false);
    expect(parsed.kind).toBe("advisory");
    expect(parsed.lane).toBe("prototype");
  });

  it("text output contains no WARN or FIX: language", () => {
    // Proves the shared FRAME (header/banner/section scaffolding) is clean. The row
    // body comes from `renderRow` here; a real lens owns its own row text, so keeping
    // that evidence-shaped is the lens's responsibility, not something this can assert.
    const text = renderText(fixtureAdvisory());
    expect(text).not.toMatch(/WARN/u);
    expect(text).not.toMatch(/FIX:/u);
  });
});

describe("partial-run disclosure", () => {
  it("discloses an unmet prerequisite so it never reads as checked-and-clear", () => {
    const text = renderText(fixtureAdvisory());
    expect(text).toContain("prerequisite dolos binary: unmet -- not on PATH");
  });

  it("shouts PARTIAL with the stopped-after count when a cap is hit", () => {
    const text = renderText(fixtureAdvisory());
    expect(text).toContain(
      "cap candidate pairs: HIT -- PARTIAL run: stopped after 5000 of ~12000 pairs",
    );
  });

  it("discloses the bound (within limit) when a cap is not hit", () => {
    const advisory = buildPrototypeAdvisory<PrototypeSection<FakeRow>>({
      subcommand: "clone-candidates",
      caps: [{ label: "candidate pairs", limit: 5000, hit: false, detail: null }],
      sections: [],
    });
    expect(formatPrototypeHeader(advisory)).toContain("  cap candidate pairs: within limit 5000");
  });

  it("falls back to a generic stopped-at-limit note when a hit cap has no detail", () => {
    const advisory = buildPrototypeAdvisory<PrototypeSection<FakeRow>>({
      subcommand: "clone-candidates",
      caps: [{ label: "candidate pairs", limit: 5000, hit: true, detail: null }],
      sections: [],
    });
    expect(formatPrototypeHeader(advisory)).toContain(
      "  cap candidate pairs: HIT -- PARTIAL run: stopped at the limit (5000)",
    );
  });

  it("discloses degradations", () => {
    const text = renderText(fixtureAdvisory());
    expect(text).toContain("degraded: line counts unavailable on a blobless clone");
  });
});

describe("appendPrototypeSection", () => {
  it("renders the candidate-kind line and each row via the caller's renderer", () => {
    const lines: string[] = [];
    appendPrototypeSection(lines, SECTION, renderRow);
    expect(lines[0]).toBe("  candidate: near-duplicate clusters");
    expect(lines).toContain("    src/a.ts  score 0.91");
    expect(lines).toContain("    src/b.ts  score 0.88");
  });

  it("discloses truncation when fewer rows are shown than qualified", () => {
    const lines: string[] = [];
    appendPrototypeSection(lines, SECTION, renderRow);
    // SECTION shows 2 of 5 → the gap is disclosed.
    expect(lines).toContain("    showing 2 of 5 candidates (3 more; raise --top to see them)");
  });

  it("omits the truncation note when nothing is hidden", () => {
    const lines: string[] = [];
    const full: PrototypeSection<FakeRow> = { ...SECTION, totalCandidates: 2 };
    appendPrototypeSection(lines, full, renderRow);
    expect(lines.some((line) => line.includes("showing"))).toBe(false);
  });

  it("prints the empty reason and no rows when the section is empty", () => {
    const lines: string[] = [];
    const empty: PrototypeSection<FakeRow> = {
      candidateKind: "near-duplicate clusters",
      totalCandidates: 0,
      emptyReason: "no clusters cleared the similarity gate this run.",
      entries: [],
    };
    appendPrototypeSection(lines, empty, renderRow);
    expect(lines).toEqual([
      "  candidate: near-duplicate clusters",
      "    no clusters cleared the similarity gate this run.",
    ]);
  });

  it("falls back to a default empty message when no reason is given", () => {
    const lines: string[] = [];
    const empty: PrototypeSection<FakeRow> = {
      candidateKind: "near-duplicate clusters",
      totalCandidates: 0,
      emptyReason: null,
      entries: [],
    };
    appendPrototypeSection(lines, empty, renderRow);
    expect(lines).toContain("    no candidates this run.");
  });
});

describe("prototypeTruncationNote", () => {
  it("returns null when the shown set is the whole qualified set", () => {
    expect(prototypeTruncationNote(5, 5)).toBeNull();
    expect(prototypeTruncationNote(5, 3)).toBeNull();
  });

  it("reports the hidden remainder when the list is capped", () => {
    expect(prototypeTruncationNote(2, 5)).toBe(
      "showing 2 of 5 candidates (3 more; raise --top to see them)",
    );
  });
});

describe("rowsPerSectionCap", () => {
  // A section truncates when its gate count exceeds the shown subset; `entries` length
  // is the only thing the builder reads off each row, so the row payload is irrelevant.
  function section(totalCandidates: number, shown: number): PrototypeSection<FakeRow> {
    return {
      candidateKind: "fake",
      totalCandidates,
      emptyReason: null,
      entries: Array.from({ length: shown }, (_unused, index) => ({
        path: `src/${index}.ts`,
        score: index,
      })),
    };
  }

  it("reports no hit (within limit, no detail) when no section was truncated", () => {
    const cap = rowsPerSectionCap(20, [section(2, 2), section(0, 0)], {
      label: "rows per section",
      noun: "section",
    });
    expect(cap).toEqual({ label: "rows per section", limit: 20, hit: false, detail: null });
  });

  it("uses the singular noun and default row noun when exactly one section truncated", () => {
    const cap = rowsPerSectionCap(2, [section(3, 2), section(1, 1)], {
      label: "rows per section",
      noun: "section",
    });
    expect(cap.hit).toBe(true);
    expect(cap.detail).toBe("1 section had more than 2 candidate rows");
  });

  it("pluralizes the noun when several sections truncated", () => {
    const cap = rowsPerSectionCap(2, [section(5, 2), section(4, 2), section(2, 2)], {
      label: "rows per section",
      noun: "section",
    });
    expect(cap.hit).toBe(true);
    expect(cap.detail).toBe("2 sections had more than 2 candidate rows");
  });

  it("honors the rowNoun override (coverage-evidence parsed rows)", () => {
    const cap = rowsPerSectionCap(20, [section(30, 20)], {
      label: "rows per artifact",
      noun: "artifact",
      rowNoun: "parsed rows",
    });
    expect(cap).toEqual({
      label: "rows per artifact",
      limit: 20,
      hit: true,
      detail: "1 artifact had more than 20 parsed rows",
    });
  });
});
