import {
  formatLintRatchetTrend,
  type LintRatchetTrendDeps,
  runLintRatchetTrend,
} from "@musi/lint-ratchet/governance/trend.js";
import {
  buildLintRatchetBaseline,
  formatLintRatchetBaseline,
  type LintRatchetRuleSourceHashesById,
} from "@musi/lint-ratchet/kernel/baseline.js";
import { createLintRatchetBaselineVersionPolicy } from "@musi/lint-ratchet/kernel/baseline-constants.js";
import type { LintRatchetConfig } from "@musi/lint-ratchet/kernel/config-types.js";
import type { LintRatchetEngineContext } from "@musi/lint-ratchet/kernel/engine-context.js";
import { describe, expect, it } from "vitest";

import { currentById, FIXTURE_HASH } from "./lint-ratchet.test-helper.js";

// A throwaway fixture context: the mocked git deps ignore the cwd and never read
// the baseline path, so any repo root that yields the conventional relative
// baseline filename works.
const trendContext: LintRatchetEngineContext = {
  repoRoot: "/repo",
  baselinePath: "/repo/lint-ratchet.baseline.json",
  debtLogPath: "/repo/lint-ratchet.debt-log.jsonl",
};

const messageRatchet: LintRatchetConfig = {
  id: "ratchet/fixture-message",
  ruleId: "no-alert",
  source: { kind: "core" },
  parserProfile: "minimal-ts",
  files: ["packages/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  mode: "no-new",
  metric: "message-count",
  repairKind: "manual",
  principle: "Fixture message ratchet principle.",
};

const ruleSourceHashes: LintRatchetRuleSourceHashesById = new Map([
  [messageRatchet.id, FIXTURE_HASH],
]);

function baselineText(total: number, writeVersion: 1 | 2 = 1): string {
  return formatLintRatchetBaseline(
    buildLintRatchetBaseline(
      [messageRatchet],
      currentById([[messageRatchet.id, [["packages/app/src/a.ts", { count: total }]]]]),
      ruleSourceHashes,
      createLintRatchetBaselineVersionPolicy(writeVersion),
    ),
  );
}

const BASELINE = "lint-ratchet.baseline.json";

function logOutput(...commits: readonly (readonly [sha: string, date: string])[]): string {
  return commits.map(([sha, date]) => `commit ${sha} ${date}\nM\t${BASELINE}\n`).join("");
}

function trendDeps(blobs: Readonly<Record<string, string>>): LintRatchetTrendDeps {
  return {
    execFileSync: (command, args) => {
      expect(command).toBe("git");
      if (args[0] === "log") {
        expect(args).toContain("--follow");
        expect(args).toContain("--name-status");
        return logOutput(
          ["new", "2026-07-02T00:00:00+00:00"],
          ["old", "2026-06-02T00:00:00+00:00"],
        );
      }
      const ref = args[1] ?? "";
      const sha = ref.split(":")[0] ?? "";
      return blobs[sha] ?? "";
    },
  };
}

describe("lint ratchet trend", () => {
  it("formats zero-history output", () => {
    expect(formatLintRatchetTrend([], new Set())).toContain("(no ratchet trend points)");
  });

  it("summarizes baseline history from oldest point to current point", () => {
    const result = runLintRatchetTrend({
      context: trendContext,
      deps: trendDeps({ old: baselineText(5), new: baselineText(2) }),
      ratchets: [messageRatchet],
    });

    expect(result.report).toContain("ratchet/fixture-message");
    expect(result.report).toContain("active");
    expect(result.report).toContain("5");
    expect(result.report).toContain("2");
    expect(result.report).toContain("-3");
    expect(result.warnings).toEqual([]);
  });

  it("keeps v1 and v2 history in one continuous warning-free series", () => {
    const result = runLintRatchetTrend({
      context: trendContext,
      deps: trendDeps({ old: baselineText(5, 1), new: baselineText(2, 2) }),
      ratchets: [messageRatchet],
    });

    expect(result.report).toContain("ratchet/fixture-message");
    expect(result.report).toMatch(/\s5\s+2\s+-3\s/u);
    expect(result.report).toMatch(/\s2\s+2026-07-02/u);
    expect(result.warnings).toEqual([]);
  });

  it("marks historical series absent from the current registry as retired", () => {
    const result = runLintRatchetTrend({
      context: trendContext,
      deps: trendDeps({ old: baselineText(5), new: baselineText(2) }),
      ratchets: [],
      includeRetired: true,
    });

    expect(result.report).toContain("retired");
    expect(result.report).toMatch(/first\s+last\s+delta/u);
    expect(result.report).not.toContain("current");
  });

  it("omits retired series by default and points to the complete history command", () => {
    const result = runLintRatchetTrend({
      context: trendContext,
      deps: trendDeps({ old: baselineText(5), new: baselineText(2) }),
      ratchets: [],
    });

    expect(result.report).not.toContain("ratchet/fixture-message");
    expect(result.report).toContain("Omitted 1 retired series");
    expect(result.report).toContain("bun run lint:ratchet:trend -- --all");
  });

  it("includes every historical series in explicit all mode", () => {
    const result = runLintRatchetTrend({
      context: trendContext,
      deps: trendDeps({ old: baselineText(5), new: baselineText(2) }),
      ratchets: [],
      includeRetired: true,
    });

    expect(result.report).toContain("ratchet/fixture-message");
    expect(result.report).not.toContain("Omitted");
  });

  it("skips malformed historical baselines with a warning", () => {
    const result = runLintRatchetTrend({
      context: trendContext,
      deps: trendDeps({ old: "{", new: baselineText(2) }),
      ratchets: [messageRatchet],
    });

    expect(result.report).toContain("ratchet/fixture-message");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("old");
  });

  it("reads each commit's historical baseline path across a rename", () => {
    const result = runLintRatchetTrend({
      context: trendContext,
      ratchets: [messageRatchet],
      deps: {
        execFileSync: (command, args) => {
          expect(command).toBe("git");
          if (args[0] === "log") {
            // The rename commit lists the new path in the third R-line field;
            // the older commit still lives under the pre-rename path.
            return (
              `commit new 2026-07-02T00:00:00+00:00\nR100\told-baseline.json\t${BASELINE}\n` +
              "commit old 2026-06-02T00:00:00+00:00\nM\told-baseline.json\n"
            );
          }
          const ref = args[1] ?? "";
          if (ref === `new:${BASELINE}`) return baselineText(2);
          if (ref === "old:old-baseline.json") return baselineText(5);
          throw new Error(`unexpected ref ${ref}`);
        },
      },
    });

    expect(result.report).toContain("ratchet/fixture-message");
    expect(result.report).toContain("-3");
    expect(result.warnings).toEqual([]);
  });

  it("captions the trend as committed-baseline totals", () => {
    const result = runLintRatchetTrend({
      context: trendContext,
      ratchets: [],
      deps: trendDeps({ old: baselineText(5), new: baselineText(2) }),
    });

    expect(result.report).toContain(
      "per-commit totals from committed baselines (working tree not included)",
    );
  });

  it("warns when a historical baseline blob cannot be read", () => {
    const result = runLintRatchetTrend({
      context: trendContext,
      ratchets: [],
      deps: {
        execFileSync: (command, args) => {
          expect(command).toBe("git");
          if (args[0] === "log") return logOutput(["lost", "2026-07-02T00:00:00+00:00"]);
          throw new Error("missing blob");
        },
      },
    });

    expect(result.report).toContain("(no ratchet trend points)");
    expect(result.warnings).toEqual(["lost: lint-ratchet.baseline.json could not be read"]);
  });

  it("passes markdown-sensitive trend warnings through without escaping", () => {
    const result = runLintRatchetTrend({
      context: trendContext,
      ratchets: [],
      deps: {
        execFileSync: (command, args) => {
          expect(command).toBe("git");
          if (args[0] === "log") return logOutput(["lost_|sha", "2026-07-02T00:00:00+00:00"]);
          throw new Error("missing blob");
        },
      },
    });

    expect(result.warnings).toEqual(["lost_|sha: lint-ratchet.baseline.json could not be read"]);
  });
});
