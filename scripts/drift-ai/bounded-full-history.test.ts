import { describe, expect, it } from "vitest";

import { collectBoundedFullHistory } from "./bounded-full-history.js";
import type { GitRunner } from "./git-changed-scope.js";
import {
  commitBlock,
  type GitLogEntry,
  joinGitLogBlocks as gitLog,
} from "./git-log-fixture.test-helper.js";
import { GIT_LOG_FORMAT } from "./hotspots-history.js";

const BASE_META: GitLogEntry = {
  hash: "abc123",
  authorName: "Ada",
  authorEmail: "ada@example.com",
  authorDate: "2026-05-29T09:46:48-07:00",
  committerDate: "2026-05-29T09:46:48-07:00",
  subject: "feat: thing",
};

function gitFake(output: string, recordedArgs?: string[][]): GitRunner {
  return (args) => {
    recordedArgs?.push([...args]);
    if (args[0] === "config") return "";
    if (args[0] === "log") return output;
    return "";
  };
}

describe("collectBoundedFullHistory", () => {
  it("walks full non-merge history with the shared git-log parser and cap metadata", () => {
    const recorded: string[][] = [];
    const output = gitLog([
      commitBlock(
        {
          ...BASE_META,
          hash: "new",
          authorDate: "2026-05-29T09:46:48-07:00",
          subject: "feat: newest",
          coAuthors: ["Bob <bob@example.com>"],
        },
        ["10\t2\tsrc/a.ts", "0\t5\tsrc/b.ts"],
      ),
      commitBlock(
        {
          ...BASE_META,
          hash: "old",
          authorDate: "2026-01-02T08:00:00-07:00",
          subject: "fix: oldest",
        },
        ["3\t3\tsrc/a.ts"],
      ),
    ]);

    const result = collectBoundedFullHistory({
      git: gitFake(output, recorded),
      maxCommits: 10,
      maxFiles: 10,
      timeoutMs: 1_000,
    });

    expect(recorded.find((args) => args[0] === "log")).toEqual([
      "log",
      "--no-merges",
      "--no-renames",
      "--max-count=11",
      "--date=iso-strict",
      "--numstat",
      `--format=${GIT_LOG_FORMAT}`,
    ]);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      hash: "new",
      subject: "feat: newest",
      coAuthors: ["Bob <bob@example.com>"],
    });
    expect(result.records[0]?.files).toEqual([
      { path: "src/a.ts", added: 10, deleted: 2, binary: false },
      { path: "src/b.ts", added: 0, deleted: 5, binary: false },
    ]);
    expect(result.partial).toBe(false);
    expect(result.stoppedReason).toBe("completed");
    expect(result.moreCommitsObserved).toBe(false);
    expect(result.commitCount).toBe(2);
    expect(result.distinctFileCount).toBe(2);
    expect(result.scannedRange).toEqual({
      since: null,
      newestCommitHash: "new",
      newestCommitDate: "2026-05-29T09:46:48-07:00",
      oldestCommitHash: "old",
      oldestCommitDate: "2026-01-02T08:00:00-07:00",
    });
    expect(result.unexamined.commits).toEqual({ kind: "known", count: 0 });
    expect(result.unexamined.files).toEqual({ kind: "known", count: 0 });
    expect(result.renameCaveat).toContain("--no-renames");
    expect(result.prototypeCaps.every((cap) => !cap.hit)).toBe(true);
  });

  it("observes one extra commit when maxCommits is hit and reports an unknown remainder", () => {
    const output = gitLog([
      commitBlock({ ...BASE_META, hash: "c1" }, ["1\t0\tsrc/a.ts"]),
      commitBlock({ ...BASE_META, hash: "c2" }, ["1\t0\tsrc/b.ts"]),
      commitBlock({ ...BASE_META, hash: "c3" }, ["1\t0\tsrc/c.ts"]),
    ]);

    const result = collectBoundedFullHistory({
      git: gitFake(output),
      maxCommits: 2,
      maxFiles: 20,
      timeoutMs: 1_000,
    });

    expect(result.records.map((record) => record.hash)).toEqual(["c1", "c2"]);
    expect(result.partial).toBe(true);
    expect(result.stoppedReason).toBe("max-commits");
    expect(result.moreCommitsObserved).toBe(true);
    expect(result.moreHistoryMayExist).toBe(true);
    expect(result.unexamined.commits).toEqual({
      kind: "unknown",
      reason:
        "observed at least one extra commit beyond maxCommits=2; total remaining commits were not counted",
    });
    expect(result.prototypeCaps.find((cap) => cap.label === "full-history commits")).toEqual({
      label: "full-history commits",
      limit: 2,
      hit: true,
      detail:
        "stopped after 2 commit(s); observed at least one older commit beyond the cap; remaining commit/file counts unknown",
    });
  });

  it("stops before the next observed commit would exceed maxFiles", () => {
    const output = gitLog([
      commitBlock({ ...BASE_META, hash: "c1" }, ["1\t0\tsrc/a.ts", "1\t0\tsrc/b.ts"]),
      commitBlock({ ...BASE_META, hash: "c2" }, ["1\t0\tsrc/c.ts"]),
    ]);

    const result = collectBoundedFullHistory({
      git: gitFake(output),
      maxCommits: 20,
      maxFiles: 2,
      timeoutMs: 1_000,
    });

    expect(result.records.map((record) => record.hash)).toEqual(["c1"]);
    expect(result.partial).toBe(true);
    expect(result.stoppedReason).toBe("max-files");
    expect(result.moreCommitsObserved).toBe(true);
    expect(result.distinctFileCount).toBe(2);
    expect(result.unexamined.files).toEqual({
      kind: "unknown",
      reason:
        "stopped before an observed commit would exceed maxFiles=2; total remaining file paths were not counted",
    });
    expect(result.prototypeCaps.find((cap) => cap.label === "full-history file paths")).toEqual({
      label: "full-history file paths",
      limit: 2,
      hit: true,
      detail:
        "stopped after 1 commit(s) and 2 distinct file path(s); next observed commit would exceed the cap; remaining counts unknown",
    });
  });

  it("marks the run partial when the wall-clock timeout is exceeded", () => {
    const output = gitLog([commitBlock({ ...BASE_META, hash: "c1" }, ["1\t0\tsrc/a.ts"])]);
    const ticks = [0, 25];
    const result = collectBoundedFullHistory({
      git: gitFake(output),
      maxCommits: 20,
      maxFiles: 20,
      timeoutMs: 10,
      nowMs: () => ticks.shift() ?? 25,
    });

    expect(result.partial).toBe(true);
    expect(result.stoppedReason).toBe("timeout");
    expect(result.elapsedMs).toBe(25);
    expect(result.moreHistoryMayExist).toBe(true);
    expect(result.unexamined.commits.kind).toBe("unknown");
    expect(result.prototypeCaps.find((cap) => cap.label === "full-history timeout (ms)")).toEqual({
      label: "full-history timeout (ms)",
      limit: 10,
      hit: true,
      detail: "stopped after 25ms (limit 10ms); remaining commit/file counts unknown",
    });
  });

  it("marks git log maxBuffer failures as an output cap hit", () => {
    const git: GitRunner = (args) => {
      if (args[0] === "config") return "";
      if (args[0] === "log") throw new Error("stdout maxBuffer length exceeded");
      return "";
    };

    const result = collectBoundedFullHistory({
      git,
      maxCommits: 20,
      maxFiles: 20,
      maxOutputBytes: 128,
      timeoutMs: 1_000,
    });

    expect(result.partial).toBe(true);
    expect(result.stoppedReason).toBe("max-output");
    expect(result.unexamined.commits).toEqual({
      kind: "unknown",
      reason:
        "stopped after git log output exceeded maxOutputBytes=128; total remaining commits were not counted",
    });
    expect(result.prototypeCaps.find((cap) => cap.label === "full-history output bytes")).toEqual({
      label: "full-history output bytes",
      limit: 128,
      hit: true,
      detail:
        "stopped after git log output exceeded 128 byte(s); remaining commit/file counts unknown",
    });
  });

  it("marks sync ENOBUFS git log failures as an output cap hit", () => {
    const git: GitRunner = (args) => {
      if (args[0] === "config") return "";
      if (args[0] === "log") throw new Error("spawnSync git ENOBUFS");
      return "";
    };

    const result = collectBoundedFullHistory({
      git,
      maxCommits: 20,
      maxFiles: 20,
      maxOutputBytes: 128,
      timeoutMs: 1_000,
    });

    expect(result.partial).toBe(true);
    expect(result.stoppedReason).toBe("max-output");
    expect(result.prototypeCaps.find((cap) => cap.label === "full-history output bytes")).toEqual({
      label: "full-history output bytes",
      limit: 128,
      hit: true,
      detail:
        "stopped after git log output exceeded 128 byte(s); remaining commit/file counts unknown",
    });
  });

  it("passes --since when supplied", () => {
    const recorded: string[][] = [];

    const result = collectBoundedFullHistory({
      git: gitFake(
        gitLog([commitBlock({ ...BASE_META, hash: "c1" }, ["1\t0\tsrc/a.ts"])]),
        recorded,
      ),
      since: "2025-01-01",
      maxCommits: 20,
      maxFiles: 20,
      timeoutMs: 1_000,
    });

    expect(recorded.find((args) => args[0] === "log")).toContain("--since=2025-01-01");
    expect(result.requestedCaps.since).toBe("2025-01-01");
    expect(result.scannedRange.since).toBe("2025-01-01");
    expect(result.partial).toBe(true);
    expect(result.stoppedReason).toBe("since");
    expect(result.moreHistoryMayExist).toBe(true);
    expect(result.unexamined.commits).toEqual({
      kind: "unknown",
      reason: "history range was limited by --since=2025-01-01; pre-since commits were not counted",
    });
  });

  it("uses name-only history and discloses line degradation on blobless partial clones", () => {
    const recorded: string[][] = [];
    const git: GitRunner = (args) => {
      recorded.push([...args]);
      if (args[0] === "config" && args[1] === "--get-regexp") {
        return "remote.origin.partialclonefilter blob:none\n";
      }
      if (args[0] === "config") return "";
      if (args[0] === "log") {
        return gitLog([commitBlock({ ...BASE_META, hash: "c1" }, ["src/a.ts", "src/b.ts"])]);
      }
      return "";
    };

    const result = collectBoundedFullHistory({
      git,
      maxCommits: 20,
      maxFiles: 20,
      timeoutMs: 1_000,
    });

    const logArgs = recorded.find((args) => args[0] === "log");
    expect(logArgs).toContain("--name-only");
    expect(logArgs).not.toContain("--numstat");
    expect(result.linesAvailable).toBe(false);
    expect(result.degradations).toContain(
      "line metrics unavailable on a blobless partial clone; used git log --name-only to avoid fetching blobs",
    );
    expect(result.records[0]?.files).toEqual([
      { path: "src/a.ts", added: 0, deleted: 0, binary: false },
      { path: "src/b.ts", added: 0, deleted: 0, binary: false },
    ]);
  });
});
