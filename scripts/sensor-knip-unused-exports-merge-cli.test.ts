import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { UnusedExportCategory } from "./drift-ai/knip-unused-exports.js";
import { formatKnipUnusedExportsBaseline } from "./sensor-knip-unused-exports.js";
import { runKnipUnusedExportsMergeCli } from "./sensor-knip-unused-exports-merge-cli.js";
import { registerTempRootCleanup } from "./test-support/tmp-repo.test-helper.js";

const tmpRepo = registerTempRootCleanup();

function baselineText(...symbols: readonly string[]): string {
  const category: UnusedExportCategory = "exports";
  return formatKnipUnusedExportsBaseline(
    symbols.map((symbol) => ({
      key: `${category}|src/a.ts|${symbol}`,
      path: "src/a.ts",
      category,
      symbol,
    })),
  );
}

interface MergeFixture {
  readonly root: string;
  readonly basePath: string;
  readonly currentPath: string;
  readonly otherPath: string;
  readonly markerPath: string;
}

function writeMergeFixture(base: string, current: string, other: string): MergeFixture {
  const root = tmpRepo.makeTempRepo("knip-merge-cli-");
  const basePath = path.join(root, "base.json");
  const currentPath = path.join(root, "current.json");
  const otherPath = path.join(root, "other.json");
  writeFileSync(basePath, base);
  writeFileSync(currentPath, current);
  writeFileSync(otherPath, other);
  return { root, basePath, currentPath, otherPath, markerPath: path.join(root, "marker") };
}

describe("runKnipUnusedExportsMergeCli", () => {
  it("takes the other side verbatim and writes no marker when one side is unchanged", async () => {
    const base = baselineText("a", "b");
    const other = baselineText("a");
    const fixture = writeMergeFixture(base, base, other);

    const exitCode = await runKnipUnusedExportsMergeCli([
      fixture.basePath,
      fixture.currentPath,
      fixture.otherPath,
      "sensor-knip-unused-exports.baseline.json",
      fixture.markerPath,
      "deadbeef",
    ]);

    expect(exitCode).toBe(0);
    expect(readFileSync(fixture.currentPath, "utf8")).toBe(other);
    expect(existsSync(fixture.markerPath)).toBe(false);
  });

  it("keeps shared identities and writes a truth-up marker on divergence", async () => {
    const base = baselineText("a", "b");
    const current = baselineText("a", "c");
    const other = baselineText("a", "d");
    const fixture = writeMergeFixture(base, current, other);

    const exitCode = await runKnipUnusedExportsMergeCli([
      fixture.basePath,
      fixture.currentPath,
      fixture.otherPath,
      "sensor-knip-unused-exports.baseline.json",
      fixture.markerPath,
      "deadbeef",
    ]);

    expect(exitCode).toBe(0);
    expect(readFileSync(fixture.currentPath, "utf8")).toBe(baselineText("a"));
    expect(existsSync(fixture.markerPath)).toBe(true);
    expect(readFileSync(fixture.markerPath, "utf8")).toContain("merge-head=deadbeef");
  });

  it("returns a nonzero exit and leaves current untouched when a side cannot be parsed", async () => {
    const base = baselineText("a");
    const current = baselineText("a", "b");
    const fixture = writeMergeFixture(base, current, "{ not json");

    const exitCode = await runKnipUnusedExportsMergeCli([
      fixture.basePath,
      fixture.currentPath,
      fixture.otherPath,
    ]);

    expect(exitCode).toBe(1);
    expect(readFileSync(fixture.currentPath, "utf8")).toBe(current);
  });
});
