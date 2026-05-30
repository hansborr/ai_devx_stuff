import { describe, expect, it } from "vitest";

import { reduceFragmentation } from "./hotspots-fragmentation.js";
import type { CollectedHistory, CommitFileChange, CommitRecord } from "./hotspots-history.js";

function file(path: string): CommitFileChange {
  return { path, added: 1, deleted: 1, binary: false };
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

function history(records: readonly CommitRecord[]): CollectedHistory {
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
  };
}

describe("reduceFragmentation", () => {
  it("counts distinct committer and co-author trailer hands per file", () => {
    const records = [
      rec([file("src/hot.ts")], {
        authorName: "Ada",
        subject: "newest",
        coAuthors: ["Claude <noreply@anthropic.com>"],
      }),
      rec([file("src/hot.ts")], {
        authorName: "Bob",
        subject: "middle",
        coAuthors: ["Claude <noreply@anthropic.com>", "Cursor <agent@example.com>"],
      }),
      rec([file("src/hot.ts")], { authorName: "Ada", subject: "oldest" }),
      rec([file("src/cold.ts")], { authorName: "Ada" }),
    ];

    const section = reduceFragmentation(history(records), { top: 20, minHands: 3 });

    expect(section.lens).toBe("fragmentation");
    expect(section.minHands).toBe(3);
    expect(section.entries).toHaveLength(1);
    expect(section.entries[0]).toMatchObject({
      path: "src/hot.ts",
      distinctHands: 4,
      authorHands: 2,
      trailerHands: 2,
      revisions: 3,
      score: 4,
    });
    expect(section.entries[0]?.sampleHands).toEqual(["Ada", "Bob", "Claude", "Cursor"]);
    expect(section.entries[0]?.authors).toContainEqual({ name: "Ada", commits: 2 });
    expect(section.entries[0]?.recentSubjects).toEqual(["newest", "middle", "oldest"]);
    expect(section.entries[0]?.inspectCommand).toBe("git log --oneline -- src/hot.ts");
  });

  it("omits files below the minimum distinct-hand threshold", () => {
    const records = [
      rec([file("src/a.ts")], { authorName: "Ada" }),
      rec([file("src/a.ts")], { authorName: "Bob" }),
    ];

    const section = reduceFragmentation(history(records), { top: 20, minHands: 3 });

    expect(section.entries).toEqual([]);
    expect(section.emptyReason).toContain("fewer than 3 distinct hands");
  });
});
