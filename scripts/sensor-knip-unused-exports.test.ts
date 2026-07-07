import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { KNIP_SYMBOL_INCLUDE_CATEGORIES, type KnipRunner } from "./drift-ai/knip-runner.js";
import {
  formatKnipUnusedExportsBaseline,
  type KnipUnusedExportsSnapshot,
  runKnipUnusedExportsCli,
} from "./sensor-knip-unused-exports.js";
import { registerTempRootCleanup } from "./test-support/tmp-repo.test-helper.js";

const tmpRepo = registerTempRootCleanup();

type BaselineJsonRecord = {
  readonly version: number;
  readonly tool: string;
  readonly metric: string;
  readonly includeCategories: string;
  readonly count: number;
  readonly categories: KnipUnusedExportsSnapshot["categories"];
};

function knipReporting(reportJson: string): KnipRunner {
  return () => ({ ok: true, reportJson, exitCode: 1, stderr: "" });
}

function unusedExportReport(
  counts: Partial<Record<keyof KnipUnusedExportsSnapshot["categories"], number>>,
): string {
  const issues = [
    {
      file: "src/symbols.ts",
      exports: Array.from({ length: counts.exports ?? 0 }, (_, index) => ({
        name: `unusedExport${String(index + 1)}`,
      })),
      types: Array.from({ length: counts.types ?? 0 }, (_, index) => ({
        name: `UnusedType${String(index + 1)}`,
      })),
      enumMembers: Array.from({ length: counts.enumMembers ?? 0 }, (_, index) => ({
        namespace: "UnusedEnum",
        name: `Member${String(index + 1)}`,
      })),
      namespaceMembers: Array.from({ length: counts.namespaceMembers ?? 0 }, (_, index) => ({
        namespace: "UnusedNamespace",
        name: `member${String(index + 1)}`,
      })),
    },
  ];
  return JSON.stringify({ issues });
}

function baselineText(counts: KnipUnusedExportsSnapshot["categories"]): string {
  return formatKnipUnusedExportsBaseline({
    count: counts.exports + counts.types + counts.enumMembers + counts.namespaceMembers,
    categories: counts,
  });
}

function baselineRecord(): BaselineJsonRecord {
  return {
    version: 1,
    tool: "knip",
    metric: "unused-export-symbols",
    includeCategories: KNIP_SYMBOL_INCLUDE_CATEGORIES,
    count: 1,
    categories: {
      exports: 1,
      types: 0,
      enumMembers: 0,
      namespaceMembers: 0,
    },
  };
}

function baselineJson(overrides: Partial<BaselineJsonRecord>): string {
  return `${JSON.stringify({ ...baselineRecord(), ...overrides }, null, 2)}\n`;
}

describe("runKnipUnusedExportsCli", () => {
  it("passes when the current unused-export count stays at the baseline", () => {
    const root = tmpRepo.writeRepo({
      "sensor-knip-unused-exports.baseline.json": baselineText({
        exports: 1,
        types: 1,
        enumMembers: 0,
        namespaceMembers: 0,
      }),
    });

    const result = runKnipUnusedExportsCli({
      argv: [],
      cwd: root,
      runner: knipReporting(unusedExportReport({ exports: 1, types: 1 })),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("OK: knip unused-export symbols match baseline 2");
  });

  it("fails when the current unused-export count grows above the baseline", () => {
    const root = tmpRepo.writeRepo({
      "sensor-knip-unused-exports.baseline.json": baselineText({
        exports: 1,
        types: 0,
        enumMembers: 0,
        namespaceMembers: 0,
      }),
    });

    const result = runKnipUnusedExportsCli({
      argv: [],
      cwd: root,
      runner: knipReporting(unusedExportReport({ exports: 2 })),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("FAIL: knip unused-export symbols grew by 1");
    expect(result.stdout).toContain("exports: baseline 1, current 2 (+1)");
  });

  it("fails and requires lowering the baseline when the current count improves", () => {
    const root = tmpRepo.writeRepo({
      "sensor-knip-unused-exports.baseline.json": baselineText({
        exports: 3,
        types: 0,
        enumMembers: 0,
        namespaceMembers: 0,
      }),
    });

    const result = runKnipUnusedExportsCli({
      argv: [],
      cwd: root,
      runner: knipReporting(unusedExportReport({ exports: 1 })),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("FAIL: knip unused-export symbols decreased by 2");
    expect(result.stdout).toContain(
      "Current tree is better than the baseline; run bun scripts/sensor-knip-unused-exports.ts --update to lock it in by lowering the committed baseline.",
    );
    expect(result.stdout).toContain("exports: baseline 3, current 1 (-2)");
  });

  it("writes a deterministic baseline in update mode", () => {
    const root = tmpRepo.makeTempRepo("sensor-knip-unused-exports-");
    const baselinePath = path.join(root, "baseline.json");

    const result = runKnipUnusedExportsCli({
      argv: ["--update", `--baseline=${baselinePath}`],
      cwd: root,
      runner: knipReporting(unusedExportReport({ exports: 1, enumMembers: 1 })),
    });

    expect(result.exitCode).toBe(0);
    expect(readFileSync(baselinePath, "utf8")).toBe(
      baselineText({ exports: 1, types: 0, enumMembers: 1, namespaceMembers: 0 }),
    );
  });

  it("returns an infrastructure failure when knip cannot run", () => {
    const root = tmpRepo.writeRepo({
      "sensor-knip-unused-exports.baseline.json": baselineText({
        exports: 0,
        types: 0,
        enumMembers: 0,
        namespaceMembers: 0,
      }),
    });

    const result = runKnipUnusedExportsCli({
      argv: [],
      cwd: root,
      runner: () => ({ ok: false, reason: "timeout", error: "timeout of 1ms" }),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("ERROR: knip timeout: timeout of 1ms");
  });

  it.each([
    {
      name: "invalid JSON",
      baseline: "{",
      expected: "ERROR: baseline is not valid JSON:",
    },
    {
      name: "wrong version",
      baseline: baselineJson({ version: 2 }),
      expected: "ERROR: baseline version must be 1",
    },
    {
      name: "wrong tool",
      baseline: baselineJson({ tool: "ts-prune" }),
      expected: "ERROR: baseline tool must be 'knip'",
    },
    {
      name: "wrong metric",
      baseline: baselineJson({ metric: "unused-files" }),
      expected: "ERROR: baseline metric must be 'unused-export-symbols'",
    },
    {
      name: "wrong includeCategories",
      baseline: baselineJson({ includeCategories: "exports,types" }),
      expected: `ERROR: baseline includeCategories must be '${KNIP_SYMBOL_INCLUDE_CATEGORIES}'`,
    },
    {
      name: "category total mismatch",
      baseline: baselineJson({
        count: 2,
        categories: {
          exports: 1,
          types: 0,
          enumMembers: 0,
          namespaceMembers: 0,
        },
      }),
      expected: "ERROR: baseline category total 1 does not match count 2",
    },
  ])("returns an infrastructure failure for $name in the baseline", ({ baseline, expected }) => {
    const root = tmpRepo.writeRepo({
      "sensor-knip-unused-exports.baseline.json": baseline,
    });

    const result = runKnipUnusedExportsCli({
      argv: [],
      cwd: root,
      runner: knipReporting(unusedExportReport({ exports: 1 })),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain(expected);
  });

  it("returns an infrastructure failure when the baseline is missing", () => {
    const root = tmpRepo.makeTempRepo("sensor-knip-unused-exports-");

    const result = runKnipUnusedExportsCli({
      argv: [],
      cwd: root,
      runner: knipReporting(unusedExportReport({ exports: 1 })),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("ERROR: baseline missing at");
    expect(result.stdout).toContain("run bun scripts/sensor-knip-unused-exports.ts --update");
  });
});
