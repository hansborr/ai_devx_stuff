import { describe, expect, it } from "vitest";

import { reduceChurn } from "./hotspots-churn.js";
import type { CollectedHistory, CommitFileChange, CommitRecord } from "./hotspots-history.js";

function file(path: string, added = 1, deleted = 1): CommitFileChange {
  return { path, added, deleted, binary: false };
}

let seq = 0;
function rec(files: readonly CommitFileChange[], over: Partial<CommitRecord> = {}): CommitRecord {
  seq += 1;
  return {
    hash: `h${seq}`,
    authorName: "Ada",
    authorEmail: "ada@example.com",
    authorDate: "2026-05-29T00:00:00-07:00",
    committerDate: "2026-05-29T00:00:00-07:00",
    subject: `subject ${seq}`,
    coAuthors: [],
    files,
    ...over,
  };
}

// Records are newest-first (git log default order), which is what the collector
// preserves and the actionability helpers rely on.
function history(
  records: readonly CommitRecord[],
  over: Partial<CollectedHistory> = {},
): CollectedHistory {
  return {
    records,
    commitCount: records.length,
    requestedWindowDays: 14,
    effectiveWindowDays: 14,
    widened: false,
    widenReason: null,
    metric: "revisions",
    metricAutoSwitched: false,
    squashReason: null,
    singleRevisionRatio: 0,
    linesAvailable: true,
    ...over,
  };
}

describe("reduceChurn", () => {
  it("ranks by revisions and excludes files that do not stand out above the median", () => {
    const records: CommitRecord[] = [];
    // hot.ts in 15 commits; ten cold files in 3 commits each → median 3, hot stands out.
    for (let i = 0; i < 30; i += 1) {
      const files = [file(`src/cold-${i % 10}.ts`, i + 1, 1)];
      if (i % 2 === 0) files.push(file("src/hot.ts", 5, 5));
      records.push(rec(files));
    }

    const section = reduceChurn(history(records), { top: 20 });

    expect(section.lens).toBe("churn");
    expect(section.medianScore).toBe(3);
    expect(section.standoutFactor).toBe(2);
    expect(section.entries.map((entry) => entry.path)).toEqual(["src/hot.ts"]);
    expect(section.entries[0]).toMatchObject({ revisions: 15, linesChanged: 150, score: 15 });
    expect(section.emptyReason).toBeNull();
  });

  it("reports 'no clear hotspots' and zero rows when the distribution is flat", () => {
    // Every file touched the same number of times → nothing exceeds the median.
    const records = Array.from({ length: 6 }, (_unused, i) =>
      rec([file(`src/a.ts`), file(`src/b.ts`), file(`src/c.ts`)], { hash: `flat${i}` }),
    );

    const section = reduceChurn(history(records), { top: 20 });

    expect(section.entries).toEqual([]);
    expect(section.emptyReason).toContain("no clear hotspots this window");
  });

  it("uses the lines metric when the collector auto-switched it", () => {
    const records: CommitRecord[] = [
      rec([file("src/big.ts", 100, 100)]),
      rec([file("src/big.ts", 50, 50)]),
    ];
    // A floor of small files keeps the median low so big.ts stands out by lines.
    for (let i = 0; i < 6; i += 1) records.push(rec([file(`src/small-${i}.ts`, 1, 1)]));

    const section = reduceChurn(history(records, { metric: "lines" }), { top: 20 });

    expect(section.metric).toBe("lines");
    // big.ts: 300 lines vs small files: 2 lines each → big.ts is the standout.
    expect(section.entries[0]?.path).toBe("src/big.ts");
    expect(section.entries[0]?.score).toBe(300);
  });

  it("carries actionability context: authors, 3 recent subjects, and an inspect command", () => {
    const records = [
      rec([file("src/hot.ts")], { subject: "fix C", authorName: "Bob" }),
      rec([file("src/hot.ts")], {
        subject: "fix B",
        authorName: "Ada",
        coAuthors: ["Claude <noreply@anthropic.com>"],
      }),
      rec([file("src/hot.ts")], { subject: "fix A", authorName: "Ada" }),
      rec([file("src/hot.ts")], { subject: "older", authorName: "Ada" }),
      // Cold floor so hot.ts (4 revisions) clears the standout gate above the median.
      rec([file("src/cold-0.ts")]),
      rec([file("src/cold-1.ts")]),
      rec([file("src/cold-2.ts")]),
      rec([file("src/cold-3.ts")]),
    ];

    const section = reduceChurn(history(records), { top: 20 });
    const hot = section.entries.find((entry) => entry.path === "src/hot.ts");

    expect(hot?.authors[0]).toEqual({ name: "Ada", commits: 3 });
    expect(hot?.authors).toContainEqual({ name: "Bob", commits: 1 });
    // Co-author trailer attributed by display name only (email stripped).
    expect(hot?.authors).toContainEqual({ name: "Claude", commits: 1 });
    // Newest-first, capped at 3.
    expect(hot?.recentSubjects).toEqual(["fix C", "fix B", "fix A"]);
    expect(hot?.inspectCommand).toBe("git log --oneline -- src/hot.ts");
    expect(hot?.baseline).toBeNull();
  });

  it("respects --top by slicing the ranked standouts", () => {
    const records: CommitRecord[] = [];
    // Five files with clearly separated revision counts plus a flat cold floor.
    for (let i = 0; i < 5; i += 1) {
      for (let r = 0; r <= i + 5; r += 1) records.push(rec([file(`src/f${i}.ts`)]));
    }
    for (let i = 0; i < 10; i += 1) records.push(rec([file(`src/cold-${i}.ts`)]));

    const section = reduceChurn(history(records), { top: 2 });

    expect(section.entries).toHaveLength(2);
    expect(section.entries[0]?.path).toBe("src/f4.ts");
  });
});
