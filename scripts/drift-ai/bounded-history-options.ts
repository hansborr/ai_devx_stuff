import {
  type BoundedFullHistory,
  type BoundedFullHistoryOptions,
  type BoundedHistoryGitRunner,
  collectBoundedFullHistory,
} from "./bounded-full-history.js";
import type { DriftAiIgnoreConfig } from "./config.js";

export type ParsedBoundedHistoryArgs = {
  readonly since: string | null;
  readonly maxCommits: number | null;
  readonly maxFiles: number | null;
  readonly maxOutputBytes: number | null;
  readonly timeoutMs: number | null;
};

export type BoundedHistoryRunContext = {
  readonly boundedGit: BoundedHistoryGitRunner;
  readonly ignore: DriftAiIgnoreConfig;
};

export function boundedHistoryOptionFields(
  parsed: ParsedBoundedHistoryArgs,
): Omit<BoundedFullHistoryOptions, "git" | "ignore"> {
  return {
    ...(parsed.since === null ? {} : { since: parsed.since }),
    ...(parsed.maxCommits === null ? {} : { maxCommits: parsed.maxCommits }),
    ...(parsed.maxFiles === null ? {} : { maxFiles: parsed.maxFiles }),
    ...(parsed.maxOutputBytes === null ? {} : { maxOutputBytes: parsed.maxOutputBytes }),
    ...(parsed.timeoutMs === null ? {} : { timeoutMs: parsed.timeoutMs }),
  };
}

export function collectConfiguredBoundedFullHistory(
  parsed: ParsedBoundedHistoryArgs,
  context: BoundedHistoryRunContext,
): BoundedFullHistory {
  return collectBoundedFullHistory({
    git: context.boundedGit,
    ignore: context.ignore,
    ...boundedHistoryOptionFields(parsed),
  });
}
