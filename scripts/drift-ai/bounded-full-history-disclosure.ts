import type {
  BoundedFullHistory,
  BoundedHistoryRequestedCaps,
  BoundedHistoryStopReason,
} from "./bounded-full-history.js";
import type { PrototypeCap } from "./prototype-advisory.js";

export const FULL_HISTORY_RENAME_CAVEAT =
  "git log uses --no-renames; paths are not followed across renames, so pre-rename evidence may be absent.";

export type BoundedHistoryUnexaminedCount =
  | { readonly kind: "known"; readonly count: number }
  | { readonly kind: "unknown"; readonly reason: string };

export function unexaminedCounts(
  stoppedReason: BoundedHistoryStopReason,
  caps: BoundedHistoryRequestedCaps,
  elapsedMs: number,
): BoundedFullHistory["unexamined"] {
  switch (stoppedReason) {
    case "completed":
      return { commits: { kind: "known", count: 0 }, files: { kind: "known", count: 0 } };
    case "max-commits":
      return unexaminedAfterMaxCommits(caps);
    case "max-files":
      return unexaminedAfterMaxFiles(caps);
    case "max-output":
      return unexaminedAfterMaxOutput(caps);
    case "since":
      return unexaminedAfterSince(caps);
    case "timeout":
      return unexaminedAfterTimeout(caps, elapsedMs);
    case "git-error":
      return unexaminedAfterGitError();
  }
}

function unexaminedAfterMaxCommits(
  caps: BoundedHistoryRequestedCaps,
): BoundedFullHistory["unexamined"] {
  return {
    commits: {
      kind: "unknown",
      reason: `observed at least one extra commit beyond maxCommits=${caps.maxCommits}; total remaining commits were not counted`,
    },
    files: {
      kind: "unknown",
      reason: `stopped at maxCommits=${caps.maxCommits}; file paths in unexamined commits were not counted`,
    },
  };
}

function unexaminedAfterMaxFiles(
  caps: BoundedHistoryRequestedCaps,
): BoundedFullHistory["unexamined"] {
  return {
    commits: {
      kind: "unknown",
      reason: `stopped at maxFiles=${caps.maxFiles}; total remaining commits were not counted`,
    },
    files: {
      kind: "unknown",
      reason: `stopped before an observed commit would exceed maxFiles=${caps.maxFiles}; total remaining file paths were not counted`,
    },
  };
}

function unexaminedAfterSince(caps: BoundedHistoryRequestedCaps): BoundedFullHistory["unexamined"] {
  return {
    commits: {
      kind: "unknown",
      reason: `history range was limited by --since=${caps.since ?? ""}; pre-since commits were not counted`,
    },
    files: {
      kind: "unknown",
      reason: `history range was limited by --since=${caps.since ?? ""}; pre-since file paths were not counted`,
    },
  };
}

function unexaminedAfterMaxOutput(
  caps: BoundedHistoryRequestedCaps,
): BoundedFullHistory["unexamined"] {
  return {
    commits: {
      kind: "unknown",
      reason: `stopped after git log output exceeded maxOutputBytes=${caps.maxOutputBytes}; total remaining commits were not counted`,
    },
    files: {
      kind: "unknown",
      reason: `stopped after git log output exceeded maxOutputBytes=${caps.maxOutputBytes}; total remaining file paths were not counted`,
    },
  };
}

function unexaminedAfterTimeout(
  caps: BoundedHistoryRequestedCaps,
  elapsedMs: number,
): BoundedFullHistory["unexamined"] {
  return {
    commits: {
      kind: "unknown",
      reason: `stopped after ${elapsedMs}ms (limit ${caps.timeoutMs}ms); total remaining commits were not counted`,
    },
    files: {
      kind: "unknown",
      reason: `stopped after ${elapsedMs}ms (limit ${caps.timeoutMs}ms); total remaining file paths were not counted`,
    },
  };
}

function unexaminedAfterGitError(): BoundedFullHistory["unexamined"] {
  return {
    commits: {
      kind: "unknown",
      reason:
        "git log failed before a complete history walk; total remaining commits were not counted",
    },
    files: {
      kind: "unknown",
      reason:
        "git log failed before a complete history walk; total remaining file paths were not counted",
    },
  };
}

type PrototypeCapInput = Pick<
  BoundedFullHistory,
  "commitCount" | "distinctFileCount" | "elapsedMs" | "requestedCaps" | "stoppedReason"
>;

export function prototypeCaps(result: PrototypeCapInput): PrototypeCap[] {
  return [commitCap(result), filePathCap(result), outputCap(result), timeoutCap(result)];
}

function commitCap(result: PrototypeCapInput): PrototypeCap {
  return {
    label: "full-history commits",
    limit: result.requestedCaps.maxCommits,
    hit: result.stoppedReason === "max-commits",
    detail:
      result.stoppedReason === "max-commits"
        ? `stopped after ${result.commitCount} commit(s); observed at least one older commit beyond the cap; remaining commit/file counts unknown`
        : null,
  };
}

function filePathCap(result: PrototypeCapInput): PrototypeCap {
  return {
    label: "full-history file paths",
    limit: result.requestedCaps.maxFiles,
    hit: result.stoppedReason === "max-files",
    detail:
      result.stoppedReason === "max-files"
        ? `stopped after ${result.commitCount} commit(s) and ${result.distinctFileCount} distinct file path(s); next observed commit would exceed the cap; remaining counts unknown`
        : null,
  };
}

function outputCap(result: PrototypeCapInput): PrototypeCap {
  return {
    label: "full-history output bytes",
    limit: result.requestedCaps.maxOutputBytes,
    hit: result.stoppedReason === "max-output",
    detail:
      result.stoppedReason === "max-output"
        ? `stopped after git log output exceeded ${result.requestedCaps.maxOutputBytes} byte(s); remaining commit/file counts unknown`
        : null,
  };
}

function timeoutCap(result: PrototypeCapInput): PrototypeCap {
  return {
    label: "full-history timeout (ms)",
    limit: result.requestedCaps.timeoutMs,
    hit: result.stoppedReason === "timeout",
    detail:
      result.stoppedReason === "timeout"
        ? `stopped after ${result.elapsedMs}ms (limit ${result.requestedCaps.timeoutMs}ms); remaining commit/file counts unknown`
        : null,
  };
}
