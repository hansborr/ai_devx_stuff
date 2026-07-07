import { describe, expect, it } from "vitest";

import { buildGitLogWalkArgs, GIT_LOG_BASE_ARGS, GIT_LOG_FORMAT } from "./hotspots-git-log.js";

describe("buildGitLogWalkArgs", () => {
  // --no-renames is load-bearing for parser correctness (arrow-form paths would
  // corrupt the tab-split), so it must live in the base every lens shares.
  it("keeps --no-renames in the base args every lens shares", () => {
    expect(GIT_LOG_BASE_ARGS).toEqual(["log", "--no-merges", "--no-renames"]);
  });

  it("composes the numstat history walk from the shared base (no pickaxe)", () => {
    expect(buildGitLogWalkArgs({ windowDays: 14, numstat: true })).toEqual([
      "log",
      "--no-merges",
      "--no-renames",
      "--since=14.days.ago",
      "--date=iso-strict",
      "--numstat",
      `--format=${GIT_LOG_FORMAT}`,
    ]);
  });

  // Drift guard for AUDIT.md #3: the suppression-churn walk hand-rolled its own
  // arg list and dropped --no-renames. It must now share the identical base with
  // the numstat walk; only the mode flag and the trailing -G pickaxe differ.
  it("uses --name-only and appends the pickaxe for the suppression-churn walk", () => {
    const args = buildGitLogWalkArgs({
      windowDays: 30,
      numstat: false,
      pickaxe: "eslint-disable|@ts-",
    });

    expect(args.slice(0, 3)).toEqual([...GIT_LOG_BASE_ARGS]);
    expect(args).toEqual([
      "log",
      "--no-merges",
      "--no-renames",
      "--since=30.days.ago",
      "--date=iso-strict",
      "--name-only",
      `--format=${GIT_LOG_FORMAT}`,
      "-G",
      "eslint-disable|@ts-",
    ]);
  });

  it("supports bounded full-history caps without changing the shared base", () => {
    expect(buildGitLogWalkArgs({ since: "2025-01-01", maxCount: 11, numstat: true })).toEqual([
      "log",
      "--no-merges",
      "--no-renames",
      "--since=2025-01-01",
      "--max-count=11",
      "--date=iso-strict",
      "--numstat",
      `--format=${GIT_LOG_FORMAT}`,
    ]);
  });

  it("emits the NUL-boundary, unit-separated format with the Co-authored-by trailer", () => {
    expect(GIT_LOG_FORMAT.startsWith("%x00")).toBe(true);
    expect(GIT_LOG_FORMAT).toContain("%(trailers:key=Co-authored-by,valueonly,separator=%x1d)");
  });
});
