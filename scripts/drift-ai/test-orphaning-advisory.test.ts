import { describe, expect, it } from "vitest";

import {
  createCommitRecord as rec,
  createCompleteBoundedHistory,
  createFileChange as change,
} from "./bounded-history.test-helper.js";
import {
  buildTestOrphaningAdvisory,
  DEFAULT_TEST_ORPHANING_TOP,
  formatTestOrphaningAdvisoryJson,
  formatTestOrphaningAdvisoryText,
} from "./test-orphaning-advisory.js";

function history(
  records: Parameters<typeof createCompleteBoundedHistory>[0],
  overrides: Partial<ReturnType<typeof createCompleteBoundedHistory>> = {},
): ReturnType<typeof createCompleteBoundedHistory> {
  return createCompleteBoundedHistory(records, { elapsedMs: 9, ...overrides });
}

// A history newest-first (index 0 = newest): a.ts co-changes its test every time
// (healthy), b.ts churns ahead of its test (stale), c.ts has no inferred test.
function mixedHistory(): ReturnType<typeof createCompleteBoundedHistory> {
  return history([
    rec({
      hash: "n6",
      authorDate: "2026-06-01T00:00:00Z",
      files: [change("src/a.ts"), change("src/a.test.ts")],
    }),
    rec({
      hash: "n5",
      authorDate: "2026-05-25T00:00:00Z",
      subject: "fix: tweak b",
      files: [change("src/b.ts")],
    }),
    rec({
      hash: "n4",
      authorDate: "2026-05-20T00:00:00Z",
      subject: "refactor: b flow",
      files: [change("src/b.ts")],
    }),
    rec({
      hash: "n3",
      authorDate: "2026-05-15T00:00:00Z",
      subject: "feat: b with test",
      files: [change("src/b.ts"), change("src/b.test.ts")],
    }),
    rec({
      hash: "n2",
      authorDate: "2026-05-10T00:00:00Z",
      files: [change("src/a.ts"), change("src/a.test.ts")],
    }),
    rec({
      hash: "n1",
      authorDate: "2026-05-05T00:00:00Z",
      subject: "fix: c again",
      files: [change("src/c.ts")],
    }),
    rec({
      hash: "n0",
      authorDate: "2026-05-01T00:00:00Z",
      subject: "feat: create c",
      files: [change("src/c.ts")],
    }),
  ]);
}

describe("buildTestOrphaningAdvisory", () => {
  it("names the two candidate sections and excludes a healthy co-changing source", () => {
    const advisory = buildTestOrphaningAdvisory({ history: mixedHistory() });
    const [noTest, stale] = advisory.sections;

    expect(noTest?.candidateKind).toBe("source files with no inferred test");
    expect(stale?.candidateKind).toBe("source files whose tests lag source churn");
    // a.ts co-changed its test every time, so it appears in neither section.
    const allPaths = advisory.sections.flatMap((section) =>
      section.entries.map((entry) => entry.path),
    );
    expect(allPaths).not.toContain("src/a.ts");
  });

  it("places a source with no inferred test in the no-test section", () => {
    const advisory = buildTestOrphaningAdvisory({ history: mixedHistory() });
    const row = advisory.sections[0]?.entries[0];

    expect(advisory.sections[0]?.entries.map((entry) => entry.path)).toEqual(["src/c.ts"]);
    expect(row).toMatchObject({
      relation: "no-test-inferred",
      sourceChurn: 2,
      relatedTests: [],
      lastSourceChangeDate: "2026-05-05T00:00:00Z",
      orphanScore: 1,
    });
    expect(row?.inferredTestPaths).toContain("src/c.test.ts");
  });

  it("places a source whose test lags its churn in the stale section with co-change evidence", () => {
    const advisory = buildTestOrphaningAdvisory({ history: mixedHistory() });
    const row = advisory.sections[1]?.entries[0];

    expect(advisory.sections[1]?.entries.map((entry) => entry.path)).toEqual(["src/b.ts"]);
    expect(row).toMatchObject({
      relation: "test-inferred",
      sourceChurn: 3,
      testChurn: 1,
      sourceOnlyCommits: 2,
      sourceCommitsSinceCoChange: 2,
      lastSourceChangeDate: "2026-05-25T00:00:00Z",
      lastTestChangeDate: "2026-05-15T00:00:00Z",
      lastCoChangeDate: "2026-05-15T00:00:00Z",
      inspectCommand: "git log --oneline -- src/b.ts src/b.test.ts",
      recentSubjects: ["fix: tweak b", "refactor: b flow", "feat: b with test"],
      commitIntent: [
        { category: "fix", subjects: ["fix: tweak b"], trailerHints: [] },
        { category: "refactor", subjects: ["refactor: b flow"], trailerHints: [] },
        { category: "unknown", subjects: ["feat: b with test"], trailerHints: [] },
      ],
    });
    expect(row?.relatedTests).toEqual([
      {
        path: "src/b.test.ts",
        testChurn: 1,
        lastTestChangeDate: "2026-05-15T00:00:00Z",
        matchedPattern: "{dir}/{name}.test{ext}",
      },
    ]);
  });

  it("keeps the three newest source subjects when unrelated commits are interleaved", () => {
    const advisory = buildTestOrphaningAdvisory({
      history: history([
        rec({ subject: "newest unrelated", files: [change("docs/newest.md")] }),
        rec({ subject: "newest source", files: [change("src/interleaved.ts")] }),
        rec({ subject: "middle unrelated", files: [change("docs/middle.md")] }),
        rec({ subject: "middle source", files: [change("src/interleaved.ts")] }),
        rec({ subject: "older unrelated", files: [change("docs/older.md")] }),
        rec({ subject: "older source", files: [change("src/interleaved.ts")] }),
        rec({ subject: "oldest unrelated", files: [change("docs/oldest.md")] }),
        rec({ subject: "source beyond limit", files: [change("src/interleaved.ts")] }),
        rec({ subject: "trailing unrelated", files: [change("docs/trailing.md")] }),
      ]),
    });

    expect(advisory.sections[0]?.entries[0]?.recentSubjects).toEqual([
      "newest source",
      "middle source",
      "older source",
    ]);
  });

  it("honors --min-source-commits as a churn floor", () => {
    const records = [
      rec({ hash: "c2", authorDate: "2026-05-02T00:00:00Z", files: [change("src/once.ts")] }),
      rec({ hash: "c1", authorDate: "2026-05-01T00:00:00Z", files: [change("src/twice.ts")] }),
      rec({ hash: "c0", authorDate: "2026-04-30T00:00:00Z", files: [change("src/twice.ts")] }),
    ];

    const defaulted = buildTestOrphaningAdvisory({ history: history(records) });
    expect(defaulted.sections[0]?.entries.map((entry) => entry.path)).toEqual(["src/twice.ts"]);
    expect(defaulted.minSourceCommits).toBe(2);

    const lowered = buildTestOrphaningAdvisory({ history: history(records), minSourceCommits: 1 });
    // no-test rows rank by source churn desc, so twice.ts (2) precedes once.ts (1).
    expect(lowered.sections[0]?.entries.map((entry) => entry.path)).toEqual([
      "src/twice.ts",
      "src/once.ts",
    ]);
  });

  it("infers tests with supplied mapping templates and keeps a test out of the source set", () => {
    const advisory = buildTestOrphaningAdvisory({
      history: history([
        rec({ hash: "s2", authorDate: "2026-05-02T00:00:00Z", files: [change("src/widget.ts")] }),
        rec({ hash: "s1", authorDate: "2026-05-01T00:00:00Z", files: [change("src/widget.ts")] }),
        rec({
          hash: "t1",
          authorDate: "2026-04-01T00:00:00Z",
          files: [change("test/widget.test.ts")],
        }),
      ]),
      mappingPatterns: ["{dir}/{name}.test{ext}", "test/{name}.test{ext}"],
    });

    const stale = advisory.sections[1];
    expect(stale?.entries[0]?.relatedTests).toEqual([
      {
        path: "test/widget.test.ts",
        testChurn: 1,
        lastTestChangeDate: "2026-04-01T00:00:00Z",
        matchedPattern: "test/{name}.test{ext}",
      },
    ]);
    expect(advisory.mappingPatterns).toEqual(["{dir}/{name}.test{ext}", "test/{name}.test{ext}"]);
    // test/widget.test.ts is itself a test and must not appear as a source candidate.
    const allPaths = advisory.sections.flatMap((section) =>
      section.entries.map((entry) => entry.path),
    );
    expect(allPaths).not.toContain("test/widget.test.ts");
  });

  it("discloses bounded full-history caps and keeps JSON out of the findings shape", () => {
    const advisory = buildTestOrphaningAdvisory({
      history: history(
        [
          rec({ hash: "c2", authorDate: "2026-05-02T00:00:00Z", files: [change("src/capped.ts")] }),
          rec({ hash: "c1", authorDate: "2026-05-01T00:00:00Z", files: [change("src/capped.ts")] }),
        ],
        {
          partial: true,
          stoppedReason: "max-commits",
          moreHistoryMayExist: true,
          prototypeCaps: [
            {
              label: "full-history commits",
              limit: 1,
              hit: true,
              detail:
                "stopped after 1 commit(s); observed at least one older commit beyond the cap",
            },
          ],
        },
      ),
    });

    const json = JSON.parse(formatTestOrphaningAdvisoryJson(advisory)) as Record<string, unknown>;
    expect(json["kind"]).toBe("advisory");
    expect(json["lane"]).toBe("prototype");
    expect(json["subcommand"]).toBe("test-orphaning");
    expect("findings" in json).toBe(false);
    expect(advisory.caps[0]).toMatchObject({ label: "full-history commits", hit: true });

    const text = formatTestOrphaningAdvisoryText(advisory);
    expect(text).toContain("drift:ai test-orphaning (advisory, prototype lane)");
    expect(text).toContain("HIT -- PARTIAL run");
    expect(text).not.toContain("WARN");
    expect(text).not.toContain("FIX:");
  });

  it("applies the default per-section display cap and discloses truncation", () => {
    const records = Array.from({ length: DEFAULT_TEST_ORPHANING_TOP + 2 }, (_, index) => [
      rec({
        hash: `a${index}`,
        authorDate: "2026-05-02T00:00:00Z",
        files: [change(`src/mod${index}.ts`)],
      }),
      rec({
        hash: `b${index}`,
        authorDate: "2026-05-01T00:00:00Z",
        files: [change(`src/mod${index}.ts`)],
      }),
    ]).flat();

    const advisory = buildTestOrphaningAdvisory({ history: history(records) });
    const noTest = advisory.sections[0];

    expect(noTest?.totalCandidates).toBe(DEFAULT_TEST_ORPHANING_TOP + 2);
    expect(noTest?.entries).toHaveLength(DEFAULT_TEST_ORPHANING_TOP);
    const rowCap = advisory.caps.find((cap) => cap.label === "rows per section");
    expect(rowCap?.hit).toBe(true);
    expect(formatTestOrphaningAdvisoryText(advisory)).toContain(
      `showing ${DEFAULT_TEST_ORPHANING_TOP} of ${DEFAULT_TEST_ORPHANING_TOP + 2} candidates`,
    );
  });
});
