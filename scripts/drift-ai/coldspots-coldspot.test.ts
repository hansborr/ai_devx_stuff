import { describe, expect, it } from "vitest";

import { aggregateFiles } from "./coldspots-aggregate.js";
import { reduceColdspot } from "./coldspots-coldspot.js";
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
// preserves and the coldspot reducer relies on for first-seen/last-touched math.
function history(
  records: readonly CommitRecord[],
  over: Partial<CollectedHistory> = {},
): CollectedHistory {
  return {
    records,
    commitCount: records.length,
    requestedWindowDays: 180,
    effectiveWindowDays: 180,
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

// A day offset relative to the reference "now" (the newest commit in the window).
function daysAgo(days: number): string {
  const now = Date.parse("2026-05-29T00:00:00-07:00");
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("reduceColdspot", () => {
  it("uses the newest of multiple touches to calculate a file's age", () => {
    const records = Array.from({ length: 30 }, (_unused, i) =>
      rec([file(`app/a-${i}.ts`)], { authorDate: daysAgo(0) }),
    );
    records.push(
      rec([file("legacy/multi-touch.ts", 250, 0)], { authorDate: daysAgo(45) }),
      rec([file("legacy/multi-touch.ts", 1, 0)], { authorDate: "not-a-date" }),
      rec([file("legacy/multi-touch.ts", 250, 0)], { authorDate: daysAgo(90) }),
    );

    const section = reduceColdspot(history(records), { top: 50, revisionFloor: 3 });

    const multiTouch = section.entries.find((entry) => entry.path === "legacy/multi-touch.ts");
    expect(multiTouch?.ageDays).toBe(45);
    expect(multiTouch?.amplifiers.map((amp) => amp.kind)).toContain("large-file-cold");
  });

  it("uses the earliest of multiple touches for birth metadata", () => {
    const recentFollowUp = rec([file("scaffold/target.ts", 1, 1)], {
      authorDate: daysAgo(20),
    });
    const birthFiles = [
      file("scaffold/target.ts", 80, 0),
      ...Array.from({ length: 11 }, (_unused, i) => file(`scaffold/sibling-${i}.ts`, 80, 0)),
    ];
    const birth = rec(birthFiles, { authorDate: daysAgo(90) });

    const aggregate = aggregateFiles([recentFollowUp, birth]).get("scaffold/target.ts");

    expect(aggregate?.birthMs).toBe(Date.parse(daysAgo(90)));
    expect(aggregate?.birthFileCount).toBe(12);
    expect(aggregate?.birthLinesAdded).toBe(960);
  });

  it("fires stale-in-hot-neighborhood when the directory churns but the file does not", () => {
    const records: CommitRecord[] = [];
    // src/active/fossil.ts: one touch, long ago, never since.
    records.push(rec([file("src/active/fossil.ts")], { authorDate: daysAgo(90) }));
    // The neighborhood churns hard recently across many sibling files.
    for (let i = 0; i < 20; i += 1) {
      records.unshift(
        rec([file(`src/active/busy-${i % 4}.ts`)], { authorDate: daysAgo(2 + (i % 5)) }),
      );
    }

    const section = reduceColdspot(history(records), { top: 20 });

    const fossil = section.entries.find((entry) => entry.path === "src/active/fossil.ts");
    expect(fossil).toBeDefined();
    expect(fossil?.amplifiers.map((amp) => amp.kind)).toContain("stale-in-hot-neighborhood");
    const amp = fossil?.amplifiers.find((a) => a.kind === "stale-in-hot-neighborhood");
    // Directory churn is reported as distinct COMMITS, not summed file revisions.
    expect(amp?.detail).toMatch(/commits vs this file's/u);
    expect(amp?.numbers.dirCommits).toBeDefined();
  });

  it("does NOT fire stale-in-hot-neighborhood for repo-root files", () => {
    const records: CommitRecord[] = [];
    // Root files share a bucket, but the repo root is not a cohesive neighborhood.
    records.push(rec([file(".prettierrc")], { authorName: "Ada", authorDate: daysAgo(95) }));
    for (let i = 0; i < 20; i += 1) {
      records.unshift(
        rec([file(`config-${i % 4}.json`)], {
          authorName: "Ada",
          authorDate: daysAgo(2 + (i % 5)),
        }),
      );
    }

    const section = reduceColdspot(history(records), { top: 50 });

    expect(section.entries.find((entry) => entry.path === ".prettierrc")).toBeUndefined();
  });

  it("still surfaces repo-root files through independent amplifiers", () => {
    const records: CommitRecord[] = [];
    for (let i = 0; i < 30; i += 1) {
      records.unshift(rec([file(`app/a-${i}.ts`)], { authorName: "Ada", authorDate: daysAgo(1) }));
    }
    const burstFiles = [
      file("drift.config.ts", 80, 0),
      ...Array.from({ length: 11 }, (_unused, i) => file(`root-config-${i}.ts`, 80, 0)),
    ];
    records.push(rec(burstFiles, { authorName: "Ada", authorDate: daysAgo(95) }));

    const section = reduceColdspot(history(records), { top: 50 });

    const rootFile = section.entries.find((entry) => entry.path === "drift.config.ts");
    expect(rootFile).toBeDefined();
    expect(rootFile?.amplifiers.map((amp) => amp.kind)).toContain("write-once-birth-burst");
    expect(rootFile?.amplifiers.map((amp) => amp.kind)).not.toContain("stale-in-hot-neighborhood");
  });

  it("does NOT fire stale-in-hot-neighborhood for a one-time multi-file scaffold (regression: summed revisions)", () => {
    const records: CommitRecord[] = [];
    // A recent active floor elsewhere keeps the median age low so the scaffold reads
    // as old, authored by Ada so gone-silent never fires.
    for (let i = 0; i < 30; i += 1) {
      records.unshift(rec([file(`app/a-${i}.ts`)], { authorName: "Ada", authorDate: daysAgo(1) }));
    }
    // ONE old commit touches 10 siblings in pkg/, each 1 line — a one-time scaffold.
    // Old logic summed each file's revisions → dir "churn" 10, so every sibling read
    // as living in a churning neighborhood (ratio 10/1 >= 4). With distinct-commit
    // counting the dir has ONE commit (ratio 1/1 < 4), so none fire, and the small
    // line count keeps write-once/large-file from rescuing them → not surfaced.
    const scaffold = Array.from({ length: 10 }, (_unused, i) => file(`pkg/mod-${i}.ts`, 1, 0));
    records.push(rec(scaffold, { authorName: "Ada", authorDate: daysAgo(95) }));

    const section = reduceColdspot(history(records), { top: 50 });

    expect(section.entries.some((entry) => entry.path.startsWith("pkg/"))).toBe(false);
  });

  it("does NOT surface a cold file with no amplifier firing", () => {
    const records: CommitRecord[] = [];
    // One isolated old file in its own directory; tiny; sole author still active.
    records.push(rec([file("lib/lonely.ts", 1, 1)], { authorDate: daysAgo(120) }));
    // A flat active floor in a totally different tree, recent, so the median age
    // stays low enough that lonely.ts is "old" but nothing amplifies it: its
    // directory does not churn, it was not born in a burst, its author is active.
    for (let i = 0; i < 30; i += 1) {
      records.unshift(
        rec([file(`other/a-${i}.ts`)], { authorName: "Ada", authorDate: daysAgo(1) }),
      );
    }

    const section = reduceColdspot(history(records), { top: 20 });

    expect(section.entries.find((entry) => entry.path === "lib/lonely.ts")).toBeUndefined();
  });

  it("fires write-once-birth-burst on a large birth commit with no follow-up", () => {
    const records: CommitRecord[] = [];
    // Recent active floor so the burst file reads as old/cold by comparison.
    for (let i = 0; i < 30; i += 1) {
      records.unshift(rec([file(`app/a-${i}.ts`)], { authorDate: daysAgo(1) }));
    }
    // The birth burst: a single old commit creating a big multi-file module.
    const burstFiles = Array.from({ length: 12 }, (_unused, i) =>
      file(`scaffold/mod-${i}.ts`, 80, 0),
    );
    records.push(rec(burstFiles, { authorDate: daysAgo(95), subject: "scaffold module" }));

    const section = reduceColdspot(history(records), { top: 50 });

    const born = section.entries.find((entry) => entry.path === "scaffold/mod-0.ts");
    expect(born).toBeDefined();
    expect(born?.amplifiers.map((amp) => amp.kind)).toContain("write-once-birth-burst");
    // Detail reports the COMMIT-WIDE line count (12 files × 80 added = 960), not the
    // per-file slice, so the scaffold size reads honestly.
    const burst = born?.amplifiers.find((a) => a.kind === "write-once-birth-burst");
    expect(burst?.numbers.birthCommitLinesAdded).toBe(960);
    expect(burst?.numbers.birthFileCount).toBe(12);
  });

  it("does NOT fire write-once-birth-burst for a large SOLO edit (regression: per-file lines + OR)", () => {
    const records: CommitRecord[] = [];
    // Recent active floor so the solo file reads as old/cold by comparison.
    for (let i = 0; i < 30; i += 1) {
      records.unshift(rec([file(`app/a-${i}.ts`)], { authorName: "Ada", authorDate: daysAgo(1) }));
    }
    // A single 250-line file committed ALONE (1 file). Under the old per-file +
    // OR logic this fired birth-burst on the line count alone; it must not now — a
    // birth burst means a genuinely multi-file scaffold (files AND lines). Churn
    // (250) stays below the large-file proxy so no other amplifier rescues it, and
    // its directory has one commit and its author is active → not surfaced at all.
    records.push(
      rec([file("solo/big.ts", 250, 0)], { authorName: "Ada", authorDate: daysAgo(95) }),
    );

    const section = reduceColdspot(history(records), { top: 50 });

    expect(section.entries.find((entry) => entry.path === "solo/big.ts")).toBeUndefined();
  });

  it("degrades write-once-birth-burst on a squash repo and discloses it", () => {
    const records: CommitRecord[] = [];
    for (let i = 0; i < 30; i += 1) {
      records.unshift(rec([file(`app/a-${i}.ts`)], { authorDate: daysAgo(1) }));
    }
    const burstFiles = Array.from({ length: 12 }, (_unused, i) =>
      file(`scaffold/mod-${i}.ts`, 80, 0),
    );
    records.push(rec(burstFiles, { authorDate: daysAgo(95), subject: "scaffold module" }));

    const section = reduceColdspot(
      history(records, {
        squashReason: "95% of touched files have a single revision in-window",
        singleRevisionRatio: 0.95,
      }),
      { top: 50 },
    );

    // No row should claim write-once-birth-burst when squash is suspected.
    for (const entry of section.entries) {
      expect(entry.amplifiers.map((amp) => amp.kind)).not.toContain("write-once-birth-burst");
    }
    expect(section.degradations.some((note) => /squash/u.test(note))).toBe(true);
    expect(section.degradations.some((note) => /write-once/u.test(note))).toBe(true);
  });

  it("fires gone-silent-author when the dominant author has gone quiet repo-wide", () => {
    const records: CommitRecord[] = [];
    // A recent active floor authored by Ada (so Ada is NOT gone-silent).
    for (let i = 0; i < 30; i += 1) {
      records.unshift(rec([file(`app/a-${i}.ts`)], { authorName: "Ada", authorDate: daysAgo(1) }));
    }
    // Bob's only touch is an old file; Bob never commits again in the window.
    records.push(rec([file("legacy/bob.ts")], { authorName: "Bob", authorDate: daysAgo(100) }));

    const section = reduceColdspot(history(records), { top: 50, goneSilentDays: 60 });

    const bobs = section.entries.find((entry) => entry.path === "legacy/bob.ts");
    expect(bobs).toBeDefined();
    expect(bobs?.amplifiers.map((amp) => amp.kind)).toContain("gone-silent-author");
  });

  it("fires large-file-cold using accumulated churn as the size proxy", () => {
    const records: CommitRecord[] = [];
    for (let i = 0; i < 30; i += 1) {
      records.unshift(rec([file(`app/a-${i}.ts`)], { authorName: "Ada", authorDate: daysAgo(1) }));
    }
    // One big old file: a single touch that added a lot (its size proxy is large).
    records.push(
      rec([file("big/huge.ts", 900, 0)], { authorName: "Ada", authorDate: daysAgo(90) }),
    );

    const section = reduceColdspot(history(records), {
      top: 50,
      largeFileChurnLines: 500,
    });

    const huge = section.entries.find((entry) => entry.path === "big/huge.ts");
    expect(huge).toBeDefined();
    expect(huge?.amplifiers.map((amp) => amp.kind)).toContain("large-file-cold");
  });

  it("does not fire large-file-cold when line counts are unavailable, and discloses it", () => {
    const records: CommitRecord[] = [];
    for (let i = 0; i < 30; i += 1) {
      records.unshift(
        rec([file(`app/a-${i}.ts`, 0, 0)], { authorName: "Ada", authorDate: daysAgo(1) }),
      );
    }
    records.push(rec([file("big/huge.ts", 0, 0)], { authorName: "Bob", authorDate: daysAgo(90) }));

    const section = reduceColdspot(history(records, { linesAvailable: false }), {
      top: 50,
      goneSilentDays: 60,
    });

    for (const entry of section.entries) {
      expect(entry.amplifiers.map((amp) => amp.kind)).not.toContain("large-file-cold");
    }
    expect(section.degradations.some((note) => /line counts/u.test(note))).toBe(true);
  });

  it("respects the revision floor: an old but frequently-touched file is not cold", () => {
    const records: CommitRecord[] = [];
    // A file touched many times, last touch is old (so it would pass the age gate)
    // but its revision count is well above the floor → not a coldspot.
    for (let i = 0; i < 10; i += 1) {
      records.push(rec([file("src/active/churned.ts")], { authorDate: daysAgo(40 + i) }));
    }
    for (let i = 0; i < 30; i += 1) {
      records.unshift(rec([file(`other/a-${i}.ts`)], { authorDate: daysAgo(1) }));
    }

    const section = reduceColdspot(history(records), { top: 50, revisionFloor: 2 });

    expect(section.entries.find((entry) => entry.path === "src/active/churned.ts")).toBeUndefined();
  });

  it("respects the age threshold: a recently-touched file is never cold", () => {
    const records: CommitRecord[] = [];
    // Recent file in an active neighborhood — young, so it cannot be a coldspot
    // even though its directory churns.
    records.unshift(rec([file("src/active/fresh.ts")], { authorDate: daysAgo(1) }));
    for (let i = 0; i < 20; i += 1) {
      records.unshift(rec([file(`src/active/busy-${i % 4}.ts`)], { authorDate: daysAgo(1) }));
    }

    const section = reduceColdspot(history(records), { top: 50, ageThresholdDays: 30 });

    expect(section.entries.find((entry) => entry.path === "src/active/fresh.ts")).toBeUndefined();
  });

  it("reports an empty reason and zero rows when nothing is cold", () => {
    const records = Array.from({ length: 30 }, (_unused, i) =>
      rec([file(`src/a-${i % 5}.ts`)], { authorDate: daysAgo(1) }),
    );

    const section = reduceColdspot(history(records), { top: 50 });

    expect(section.entries).toEqual([]);
    expect(section.emptyReason).toContain("no in-window coldspots");
    expect(section.emptyReason).toContain("in-window-touched");
    expect(section.emptyReason).toContain("current files with no in-window commits");
  });

  it("discloses that the coldspot candidate model is in-window touched files only", () => {
    const section = reduceColdspot(history([]), { top: 50 });

    expect(section.candidateModel).toEqual({
      candidateSet: "in-window-touched-files",
      note: "Only files touched at least once in the effective git window are considered; current files with no in-window commits are outside this lens.",
    });
    expect(section.emptyReason).toContain("candidate set is empty");
  });

  it("carries totalQualified so a --top cap is disclosed, not silent (regression)", () => {
    const records: CommitRecord[] = [];
    // Three old fossils in an active directory all qualify (stale-in-hot-neighborhood).
    for (const name of ["fossil-a", "fossil-b", "fossil-c"]) {
      records.push(rec([file(`src/active/${name}.ts`)], { authorDate: daysAgo(90) }));
    }
    for (let i = 0; i < 20; i += 1) {
      records.unshift(rec([file(`src/active/busy-${i % 4}.ts`)], { authorDate: daysAgo(2) }));
    }

    const section = reduceColdspot(history(records), { top: 1 });

    // Three qualified, only one shown — the count must reflect the gate, not the cap.
    expect(section.totalQualified).toBe(3);
    expect(section.entries).toHaveLength(1);
  });

  it("carries amplifier raw numbers, authors, an inspect command, and a score", () => {
    const records: CommitRecord[] = [];
    records.push(rec([file("src/active/fossil.ts")], { authorDate: daysAgo(90) }));
    for (let i = 0; i < 20; i += 1) {
      records.unshift(rec([file(`src/active/busy-${i % 4}.ts`)], { authorDate: daysAgo(2) }));
    }

    const section = reduceColdspot(history(records), { top: 20 });
    const fossil = section.entries.find((entry) => entry.path === "src/active/fossil.ts");

    expect(fossil?.ageDays).toBeGreaterThan(30);
    expect(fossil?.revisions).toBe(1);
    expect(fossil?.inspectCommand).toBe("git log --oneline -- src/active/fossil.ts");
    expect(fossil?.authors[0]?.name).toBe("Ada");
    expect(typeof fossil?.score).toBe("number");
    const amp = fossil?.amplifiers.find((a) => a.kind === "stale-in-hot-neighborhood");
    expect(amp?.numbers).toBeDefined();
  });
});
