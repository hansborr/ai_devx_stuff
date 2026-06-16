import { describe, expect, it } from "vitest";

import type { GitRunner } from "./git-changed-scope.js";
import {
  commitBlock,
  type GitLogEntry,
  joinGitLogBlocks as gitLog,
} from "./git-log-fixture.test-helper.js";
import {
  collectHistory,
  type CommitRecord,
  GIT_LOG_FORMAT,
  newestTimestamp,
  parseGitLog,
  type TouchDateAccumulator,
  updateTouchDates,
} from "./hotspots-history.js";

const BASE_META: GitLogEntry = {
  hash: "abc123",
  authorName: "Ada",
  authorEmail: "ada@example.com",
  authorDate: "2026-05-29T09:46:48-07:00",
  committerDate: "2026-05-29T09:46:48-07:00",
  subject: "feat: thing",
};

describe("parseGitLog", () => {
  it("parses metadata fields, the blank-line/numstat layout, and tab-split rows", () => {
    const output = gitLog([
      commitBlock(
        {
          ...BASE_META,
          hash: "hash1",
          subject: "feat: first",
          coAuthors: ["Bob <bob@example.com>", "Cleo <cleo@example.com>"],
        },
        ["10\t2\tsrc/a.ts", "0\t5\tsrc/b.ts"],
      ),
      commitBlock({ ...BASE_META, hash: "hash2", subject: "fix: second" }, ["3\t3\tsrc/a.ts"]),
    ]);

    const records = parseGitLog(output);

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      hash: "hash1",
      authorName: "Ada",
      authorEmail: "ada@example.com",
      subject: "feat: first",
      coAuthors: ["Bob <bob@example.com>", "Cleo <cleo@example.com>"],
    });
    expect(records[0]?.files).toEqual([
      { path: "src/a.ts", added: 10, deleted: 2, binary: false },
      { path: "src/b.ts", added: 0, deleted: 5, binary: false },
    ]);
    expect(records[1]?.coAuthors).toEqual([]);
    expect(records[1]?.files).toEqual([{ path: "src/a.ts", added: 3, deleted: 3, binary: false }]);
  });

  it("treats a binary `-\\t-\\tpath` row as 0 lines but still a real revision", () => {
    const records = parseGitLog(
      gitLog([commitBlock(BASE_META, ["-\t-\tdocs/diagram.png", "4\t1\tsrc/a.ts"])]),
    );

    expect(records[0]?.files).toEqual([
      { path: "docs/diagram.png", added: 0, deleted: 0, binary: true },
      { path: "src/a.ts", added: 4, deleted: 1, binary: false },
    ]);
  });

  it("keeps paths with spaces intact and skips a numstat row before any commit boundary", () => {
    const output = `99\t0\torphan/before/boundary.ts\n${gitLog([
      commitBlock(BASE_META, ["1\t1\tsrc/dir with space/file.ts"]),
    ])}`;

    const records = parseGitLog(output);

    expect(records).toHaveLength(1);
    expect(records[0]?.files).toEqual([
      { path: "src/dir with space/file.ts", added: 1, deleted: 1, binary: false },
    ]);
  });

  // --no-renames is load-bearing for parser correctness: this parser does NOT
  // understand arrow-form paths, so it captures the corrupted column verbatim.
  // The test documents that dependency — a future follow-renames feature needs a
  // real arrow-form parser, not a flag flip.
  it("mis-parses rename arrow-forms verbatim, proving --no-renames is required", () => {
    const records = parseGitLog(
      gitLog([commitBlock(BASE_META, ["2\t2\tsrc/{old => new}/file.ts"])]),
    );

    expect(records[0]?.files).toEqual([
      { path: "src/{old => new}/file.ts", added: 2, deleted: 2, binary: false },
    ]);
  });
});

function gitFakeByWindow(
  byWindowDays: Readonly<Record<number, string>>,
  recordedArgs?: string[][],
): GitRunner {
  return (args) => {
    recordedArgs?.push([...args]);
    const sinceArg = args.find((arg) => arg.startsWith("--since="));
    const days = Number(sinceArg?.slice("--since=".length).replace(".days.ago", ""));
    return byWindowDays[days] ?? "";
  };
}

function uniqueFileCommits(count: number, prefix: string): string {
  const blocks = Array.from({ length: count }, (_unused, index) =>
    commitBlock({ ...BASE_META, hash: `${prefix}${index}` }, [`5\t1\tsrc/${prefix}${index}.ts`]),
  );
  return gitLog(blocks);
}

describe("collectHistory", () => {
  it("calls git with --no-merges, --no-renames, --numstat and the NUL-boundary format", () => {
    const recorded: string[][] = [];
    collectHistory({
      git: gitFakeByWindow({ 14: uniqueFileCommits(40, "f") }, recorded),
      windowDays: 14,
    });

    expect(recorded.find((args) => args[0] === "log")).toEqual([
      "log",
      "--no-merges",
      "--no-renames",
      "--since=14.days.ago",
      "--date=iso-strict",
      "--numstat",
      `--format=${GIT_LOG_FORMAT}`,
    ]);
    expect(GIT_LOG_FORMAT.startsWith("%x00")).toBe(true);
    expect(GIT_LOG_FORMAT).toContain("%(trailers:key=Co-authored-by,valueonly,separator=%x1d)");
  });

  it("filters collected paths through isIgnoredPath (universal ignore defaults)", () => {
    const output = gitLog([
      commitBlock(BASE_META, [
        "1\t1\tnode_modules/dep/index.js",
        "1\t0\tbun.lock",
        "9\t2\tsrc/keep.ts",
      ]),
    ]);
    const result = collectHistory({ git: gitFakeByWindow({ 14: output }), minCommits: 1 });

    expect(result.records[0]?.files).toEqual([
      { path: "src/keep.ts", added: 9, deleted: 2, binary: false },
    ]);
  });

  it("widens the window when the requested window is sparse and reports the effective window", () => {
    const result = collectHistory({
      git: gitFakeByWindow({
        14: uniqueFileCommits(9, "a"),
        30: uniqueFileCommits(9, "b"),
        60: uniqueFileCommits(40, "c"),
      }),
      windowDays: 14,
      minCommits: 30,
    });

    expect(result.requestedWindowDays).toBe(14);
    expect(result.effectiveWindowDays).toBe(60);
    expect(result.widened).toBe(true);
    expect(result.widenReason).toBe("sparse history, 9 commit(s) < floor 30");
    expect(result.commitCount).toBe(40);
  });

  it("does not widen when the requested window already meets the floor", () => {
    const result = collectHistory({
      git: gitFakeByWindow({ 14: uniqueFileCommits(40, "f") }),
      windowDays: 14,
      minCommits: 30,
    });

    expect(result.widened).toBe(false);
    expect(result.widenReason).toBeNull();
    expect(result.effectiveWindowDays).toBe(14);
  });

  it("does not report widening when the requested window already meets the widen cap", () => {
    // window === maxWindowDays → the ladder has no larger candidate, so the
    // window cannot actually widen even though history is below the floor.
    const result = collectHistory({
      git: gitFakeByWindow({ 180: uniqueFileCommits(5, "sparse") }),
      windowDays: 180,
      maxWindowDays: 180,
      minCommits: 30,
    });

    expect(result.commitCount).toBe(5);
    expect(result.requestedWindowDays).toBe(180);
    expect(result.effectiveWindowDays).toBe(180);
    expect(result.widened).toBe(false);
    expect(result.widenReason).toBeNull();
  });

  it("auto-switches the churn metric to lines when history looks squash-merged", () => {
    // 25 commits, each touching a unique file once → single-revision ratio 1.0.
    const result = collectHistory({
      git: gitFakeByWindow({ 14: uniqueFileCommits(25, "sq") }),
      windowDays: 14,
      minCommits: 5,
    });

    expect(result.metric).toBe("lines");
    expect(result.metricAutoSwitched).toBe(true);
    expect(result.squashReason).toContain("squash-merge");
    expect(result.singleRevisionRatio).toBe(1);
    expect(result.linesAvailable).toBe(true);
  });

  it("keeps the revisions metric on near-linear history (OpenClaw-shaped, no squash misfire)", () => {
    // 22 unique files, then 8 of them re-touched → ratio well below the threshold.
    const blocks: string[] = [];
    for (let index = 0; index < 22; index += 1) {
      blocks.push(commitBlock({ ...BASE_META, hash: `u${index}` }, [`4\t2\tsrc/u${index}.ts`]));
    }
    for (let index = 0; index < 8; index += 1) {
      blocks.push(commitBlock({ ...BASE_META, hash: `r${index}` }, [`3\t1\tsrc/u${index}.ts`]));
    }

    const result = collectHistory({
      git: gitFakeByWindow({ 14: gitLog(blocks) }),
      windowDays: 14,
      minCommits: 5,
    });

    expect(result.metric).toBe("revisions");
    expect(result.metricAutoSwitched).toBe(false);
    expect(result.squashReason).toBeNull();
    expect(result.singleRevisionRatio).toBeCloseTo(14 / 22, 5);
  });

  it("does not flag squash when too few distinct files meet the threshold", () => {
    // 100% single-revision but only 10 files → below SQUASH_MIN_DISTINCT_FILES.
    const result = collectHistory({
      git: gitFakeByWindow({ 14: uniqueFileCommits(10, "few") }),
      windowDays: 14,
      minCommits: 5,
    });

    expect(result.metric).toBe("revisions");
    expect(result.metricAutoSwitched).toBe(false);
  });
});

// A blobless partial clone (`--filter=blob:none`) has trees but no blob content,
// so `--numstat` would hang fetching blobs. The collector must probe for this and
// fall back to `--name-only` — revisions stay exact, line counts go unavailable.
function gitFakePartial(
  byWindowDays: Readonly<Record<number, string>>,
  recordedArgs?: string[][],
): GitRunner {
  return (args) => {
    recordedArgs?.push([...args]);
    const key = args.join(" ");
    if (key === "config --get extensions.partialclone") return ""; // unset on this clone
    if (args[0] === "config" && args[1] === "--get-regexp") {
      return "remote.origin.partialclonefilter blob:none\n";
    }
    const sinceArg = args.find((arg) => arg.startsWith("--since="));
    const days = Number(sinceArg?.slice("--since=".length).replace(".days.ago", ""));
    return byWindowDays[days] ?? "";
  };
}

function nameOnlyCommits(count: number, prefix: string): string {
  const blocks = Array.from({ length: count }, (_unused, index) =>
    commitBlock({ ...BASE_META, hash: `${prefix}${index}` }, [`src/${prefix}${index}.ts`]),
  );
  return gitLog(blocks);
}

describe("collectHistory on a blobless partial clone", () => {
  it("walks with --name-only and reports lines unavailable, revisions still exact", () => {
    const recorded: string[][] = [];
    const nameOnly = gitLog([
      commitBlock({ ...BASE_META, hash: "n0" }, ["src/a.ts", "src/b.ts"]),
      commitBlock({ ...BASE_META, hash: "n1" }, ["src/a.ts"]),
    ]);

    const result = collectHistory({
      git: gitFakePartial({ 14: nameOnly }, recorded),
      windowDays: 14,
      minCommits: 1,
    });

    const logArgs = recorded.find((args) => args[0] === "log");
    expect(logArgs).toContain("--name-only");
    expect(logArgs).not.toContain("--numstat");
    expect(result.linesAvailable).toBe(false);
    expect(result.records[0]?.files).toEqual([
      { path: "src/a.ts", added: 0, deleted: 0, binary: false },
      { path: "src/b.ts", added: 0, deleted: 0, binary: false },
    ]);
  });

  it("does not switch to lines on a blobless clone even when squash is suspected", () => {
    const result = collectHistory({
      git: gitFakePartial({ 14: nameOnlyCommits(32, "s") }),
      windowDays: 14,
      minCommits: 5,
    });

    expect(result.linesAvailable).toBe(false);
    expect(result.metric).toBe("revisions");
    expect(result.metricAutoSwitched).toBe(false);
    expect(result.squashReason).toContain("squash-merge");
  });
});

function touchRec(authorDate: string): CommitRecord {
  return {
    hash: "h",
    authorName: "Ada",
    authorEmail: "ada@example.com",
    authorDate,
    committerDate: authorDate,
    subject: "s",
    coAuthors: [],
    files: [],
  };
}

describe("updateTouchDates", () => {
  it("folds finite author timestamps into the newest/oldest bounds, in place", () => {
    const accumulator: TouchDateAccumulator = { newestTouchMs: null, oldestTouchMs: null };
    updateTouchDates(accumulator, touchRec("2026-05-10T00:00:00Z"));
    updateTouchDates(accumulator, touchRec("2026-05-20T00:00:00Z"));
    updateTouchDates(accumulator, touchRec("2026-05-01T00:00:00Z"));
    expect(accumulator.newestTouchMs).toBe(Date.parse("2026-05-20T00:00:00Z"));
    expect(accumulator.oldestTouchMs).toBe(Date.parse("2026-05-01T00:00:00Z"));
  });

  it("skips a non-finite authorDate so it never poisons the bounds", () => {
    const accumulator: TouchDateAccumulator = { newestTouchMs: null, oldestTouchMs: null };
    updateTouchDates(accumulator, touchRec("not-a-date"));
    expect(accumulator.newestTouchMs).toBeNull();
    expect(accumulator.oldestTouchMs).toBeNull();
  });
});

describe("newestTimestamp", () => {
  it("returns the newest finite author timestamp across the records", () => {
    const records = [
      touchRec("2026-05-10T00:00:00Z"),
      touchRec("bad"),
      touchRec("2026-05-25T00:00:00Z"),
    ];
    expect(newestTimestamp(records)).toBe(Date.parse("2026-05-25T00:00:00Z"));
  });

  it("returns null when no record carries a finite date", () => {
    expect(newestTimestamp([touchRec("bad"), touchRec("also-bad")])).toBeNull();
  });
});
