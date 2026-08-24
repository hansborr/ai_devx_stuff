import type { BoundedFullHistory } from "./bounded-full-history.js";
import { FULL_HISTORY_RENAME_CAVEAT } from "./bounded-full-history-disclosure.js";
import type { CommitRecord } from "./hotspots-history.js";

type CompleteHistoryOverrides = Partial<BoundedFullHistory> & Pick<BoundedFullHistory, "elapsedMs">;

export function createCommitRecord(overrides: Partial<CommitRecord>): CommitRecord {
  return {
    hash: "h",
    authorName: "Ada",
    authorEmail: "ada@example.com",
    authorDate: "2026-05-29T00:00:00Z",
    committerDate: "2026-05-29T00:00:00Z",
    subject: "subject",
    coAuthors: [],
    files: [],
    ...overrides,
  };
}

export function createFileChange(
  path: string,
  added = 1,
  deleted = 0,
): CommitRecord["files"][number] {
  return { path, added, deleted, binary: false };
}

export function createCompleteBoundedHistory(
  records: readonly CommitRecord[],
  overrides: CompleteHistoryOverrides,
): BoundedFullHistory {
  return {
    records,
    commitCount: records.length,
    distinctFileCount: new Set(records.flatMap((record) => record.files.map((file) => file.path)))
      .size,
    requestedCaps: {
      since: null,
      maxCommits: 5000,
      maxFiles: 20000,
      maxOutputBytes: 512,
      timeoutMs: 30000,
    },
    scannedRange: {
      since: null,
      newestCommitHash: records[0]?.hash ?? null,
      newestCommitDate: records[0]?.authorDate ?? null,
      oldestCommitHash: records.at(-1)?.hash ?? null,
      oldestCommitDate: records.at(-1)?.authorDate ?? null,
    },
    partial: false,
    stoppedReason: "completed",
    moreCommitsObserved: false,
    moreHistoryMayExist: false,
    unexamined: {
      commits: { kind: "known", count: 0 },
      files: { kind: "known", count: 0 },
    },
    linesAvailable: true,
    renameCaveat: FULL_HISTORY_RENAME_CAVEAT,
    degradations: [],
    prototypeCaps: [{ label: "full-history commits", limit: 5000, hit: false, detail: null }],
    gitError: null,
    ...overrides,
  };
}
