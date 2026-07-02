import { describe, expect, it } from "vitest";

import { currentById, FIXTURE_HASH } from "./lint-ratchet.test-helper.js";
import {
  buildLintRatchetBaseline,
  formatLintRatchetBaseline,
  type LintRatchetRuleSourceHashesById,
} from "./lint-ratchet-baseline.js";
import type { LintRatchetConfig } from "./lint-ratchet-config.js";
import {
  formatLintRatchetTrend,
  type LintRatchetTrendDeps,
  runLintRatchetTrend,
} from "./lint-ratchet-trend.js";

const messageRatchet: LintRatchetConfig = {
  id: "ratchet/fixture-message",
  ruleId: "no-alert",
  source: { kind: "core" },
  parserProfile: "minimal-ts",
  files: ["packages/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  mode: "no-new",
  target: 0,
  metric: "message-count",
  repairKind: "manual",
  principle: "Fixture message ratchet principle.",
};

const ruleSourceHashes: LintRatchetRuleSourceHashesById = new Map([
  [messageRatchet.id, FIXTURE_HASH],
]);

function baselineText(total: number): string {
  return formatLintRatchetBaseline(
    buildLintRatchetBaseline(
      [messageRatchet],
      currentById([[messageRatchet.id, [["packages/app/src/a.ts", { count: total }]]]]),
      ruleSourceHashes,
    ),
  );
}

function trendDeps(blobs: Readonly<Record<string, string>>): LintRatchetTrendDeps {
  return {
    execFileSync: (command, args) => {
      expect(command).toBe("git");
      if (args[0] === "log")
        return "new 2026-07-02T00:00:00+00:00\nold 2026-06-02T00:00:00+00:00\n";
      const ref = args[1] ?? "";
      const sha = ref.split(":")[0] ?? "";
      return blobs[sha] ?? "";
    },
  };
}

describe("lint ratchet trend", () => {
  it("formats zero-history output", () => {
    expect(formatLintRatchetTrend([])).toContain("(no ratchet trend points)");
  });

  it("summarizes baseline history from oldest point to current point", () => {
    const result = runLintRatchetTrend({
      deps: trendDeps({ old: baselineText(5), new: baselineText(2) }),
    });

    expect(result.report).toContain("ratchet/fixture-message");
    expect(result.report).toContain("5");
    expect(result.report).toContain("2");
    expect(result.report).toContain("-3");
    expect(result.warnings).toEqual([]);
  });

  it("skips malformed historical baselines with a warning", () => {
    const result = runLintRatchetTrend({
      deps: trendDeps({ old: "{", new: baselineText(2) }),
    });

    expect(result.report).toContain("ratchet/fixture-message");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("old");
  });

  it("warns when a historical baseline blob cannot be read", () => {
    const result = runLintRatchetTrend({
      deps: {
        execFileSync: (command, args) => {
          expect(command).toBe("git");
          if (args[0] === "log") return "lost 2026-07-02T00:00:00+00:00\n";
          throw new Error("missing blob");
        },
      },
    });

    expect(result.report).toContain("(no ratchet trend points)");
    expect(result.warnings).toEqual(["lost: lint-ratchet.baseline.json could not be read"]);
  });

  it("escapes markdown-sensitive trend warnings before rendering", () => {
    const result = runLintRatchetTrend({
      deps: {
        execFileSync: (command, args) => {
          expect(command).toBe("git");
          if (args[0] === "log") return "lost_|sha 2026-07-02T00:00:00+00:00\n";
          throw new Error("missing blob");
        },
      },
    });

    expect(result.warnings).toEqual([
      "lost\\_\\|sha: lint-ratchet.baseline.json could not be read",
    ]);
  });
});
