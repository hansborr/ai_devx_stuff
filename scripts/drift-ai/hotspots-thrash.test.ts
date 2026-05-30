import { describe, expect, it } from "vitest";

import type { CollectedHistory, CommitFileChange, CommitRecord } from "./hotspots-history.js";
import { reduceThrash } from "./hotspots-thrash.js";

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

describe("reduceThrash", () => {
  it("flags high-revision, low-net-growth files and carries overlay columns", () => {
    const records = [
      rec([file("src/hot.ts", 10, 9), file("src/hot.test.ts", 3, 3)], {
        subject: "fix final",
        authorDate: "2026-05-29T00:00:00-07:00",
      }),
      rec([file("src/hot.ts", 7, 7)], {
        subject: "revert attempt",
        authorDate: "2026-05-28T00:00:00-07:00",
      }),
      rec([file("src/hot.ts", 5, 5)], {
        subject: "refactor",
        authorDate: "2026-05-27T00:00:00-07:00",
      }),
      rec([file("src/hot.ts", 8, 8)], {
        subject: "touch",
        authorDate: "2026-05-26T00:00:00-07:00",
      }),
      rec([file("src/cold-a.ts", 1, 0)]),
      rec([file("src/cold-b.ts", 1, 0)]),
      rec([file("src/cold-c.ts", 1, 0)]),
      rec([file("src/cold-d.ts", 1, 0)]),
    ];

    const section = reduceThrash(history(records), {
      top: 20,
      minRevisions: 3,
      maxNetLinesPerRevision: 2,
      youngDays: 7,
    });

    expect(section.lens).toBe("thrash");
    expect(section.entries).toHaveLength(1);
    expect(section.entries[0]).toMatchObject({
      path: "src/hot.ts",
      revisions: 4,
      linesChanged: 59,
      netLines: 1,
      netLinesPerRevision: 0.25,
      fixRevertCommits: 2,
      firstTouchAgeDays: 3,
      youngInWindow: true,
      score: 4,
    });
    expect(section.entries[0]?.testChurnRatio).toBeCloseTo(6 / 65, 5);
    expect(section.entries[0]?.recentSubjects).toEqual(["fix final", "revert attempt", "refactor"]);
  });

  it("uses fix/revert subjects only as a tiebreaker, never as a standalone flag", () => {
    const records = [
      rec([file("src/balanced.ts", 5, 5)], { subject: "plain" }),
      rec([file("src/balanced.ts", 5, 5)], { subject: "plain" }),
      rec([file("src/balanced.ts", 5, 5)], { subject: "plain" }),
      rec([file("src/fix-only.ts", 100, 0)], { subject: "fix big growth" }),
      rec([file("src/fix-only.ts", 100, 0)], { subject: "hotfix more growth" }),
      rec([file("src/fix-only.ts", 100, 0)], { subject: "revert nothing" }),
    ];

    const section = reduceThrash(history(records), {
      top: 20,
      minRevisions: 3,
      maxNetLinesPerRevision: 2,
    });

    expect(section.entries.map((entry) => entry.path)).toEqual(["src/balanced.ts"]);
  });

  it("skips when line counts are unavailable", () => {
    const section = reduceThrash(history([rec([file("src/a.ts")])], { linesAvailable: false }), {
      top: 20,
    });

    expect(section.entries).toEqual([]);
    expect(section.emptyReason).toContain("line counts unavailable");
  });
});
