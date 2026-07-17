import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  formatNearDuplicatesBaseline,
  type NearDuplicateBaselineEntry,
} from "./sensor-near-duplicates.js";
import { runNearDuplicatesMergeCli } from "./sensor-near-duplicates-merge-cli.js";
import { registerTempRootCleanup } from "./test-support/tmp-repo.test-helper.js";

const tmpRepo = registerTempRootCleanup();

function entry(name: string): NearDuplicateBaselineEntry {
  const leftFile = `src/${name}-left.ts`;
  const rightFile = `src/${name}-right.ts`;
  const left = `${leftFile}#left`;
  const right = `${rightFile}#right`;
  return { key: `${left} <=> ${right}`, left, right, leftFile, rightFile, count: 1 };
}

function baselineText(...names: readonly string[]): string {
  return formatNearDuplicatesBaseline(names.map(entry));
}

describe("runNearDuplicatesMergeCli", () => {
  it("marks a one-sided drain for truth-up even when the merge uses the fast path", async () => {
    const root = tmpRepo.makeTempRepo("near-duplicates-merge-fast-path-");
    const basePath = path.join(root, "base.json");
    const currentPath = path.join(root, "current.json");
    const otherPath = path.join(root, "other.json");
    const markerPath = path.join(root, "truth-up");
    writeFileSync(basePath, baselineText("live-clone"));
    writeFileSync(currentPath, baselineText("live-clone"));
    writeFileSync(otherPath, baselineText());

    const exitCode = await runNearDuplicatesMergeCli([
      basePath,
      currentPath,
      otherPath,
      "sensor-near-duplicates.baseline.json",
      markerPath,
      "deadbeef",
    ]);

    expect(exitCode).toBe(0);
    expect(readFileSync(currentPath, "utf8")).toBe(baselineText());
    expect(existsSync(markerPath)).toBe(true);
  });

  it("keeps only shared debt when branches drain different pairs", async () => {
    const root = tmpRepo.makeTempRepo("near-duplicates-merge-");
    const basePath = path.join(root, "base.json");
    const currentPath = path.join(root, "current.json");
    const otherPath = path.join(root, "other.json");
    const markerPath = path.join(root, "truth-up");
    writeFileSync(basePath, baselineText("shared", "current-drain", "other-drain"));
    writeFileSync(currentPath, baselineText("shared", "other-drain"));
    writeFileSync(otherPath, baselineText("shared", "current-drain"));

    const exitCode = await runNearDuplicatesMergeCli([
      basePath,
      currentPath,
      otherPath,
      "sensor-near-duplicates.baseline.json",
      markerPath,
      "deadbeef",
    ]);

    expect(exitCode).toBe(0);
    expect(readFileSync(currentPath, "utf8")).toBe(baselineText("shared"));
    expect(existsSync(markerPath)).toBe(true);
  });

  it("preserves distinct reviewed admissions from both branches", async () => {
    const root = tmpRepo.makeTempRepo("near-duplicates-merge-admissions-");
    const basePath = path.join(root, "base.json");
    const currentPath = path.join(root, "current.json");
    const otherPath = path.join(root, "other.json");
    const markerPath = path.join(root, "truth-up");
    const currentAdmission = { ...entry("current-admission"), admissionReason: "reviewed here" };
    const otherAdmission = { ...entry("other-admission"), admissionReason: "reviewed there" };
    writeFileSync(basePath, baselineText());
    writeFileSync(currentPath, formatNearDuplicatesBaseline([currentAdmission]));
    writeFileSync(otherPath, formatNearDuplicatesBaseline([otherAdmission]));

    const exitCode = await runNearDuplicatesMergeCli([
      basePath,
      currentPath,
      otherPath,
      "sensor-near-duplicates.baseline.json",
      markerPath,
      "deadbeef",
    ]);

    expect(exitCode).toBe(0);
    expect(readFileSync(currentPath, "utf8")).toBe(
      formatNearDuplicatesBaseline([currentAdmission, otherAdmission]),
    );
    expect(existsSync(markerPath)).toBe(false);
  });

  it("continues intersecting unreviewed one-sided additions", async () => {
    const root = tmpRepo.makeTempRepo("near-duplicates-merge-unreviewed-");
    const basePath = path.join(root, "base.json");
    const currentPath = path.join(root, "current.json");
    const otherPath = path.join(root, "other.json");
    const markerPath = path.join(root, "truth-up");
    writeFileSync(basePath, baselineText());
    writeFileSync(currentPath, baselineText("current-unreviewed"));
    writeFileSync(otherPath, baselineText("other-unreviewed"));

    const exitCode = await runNearDuplicatesMergeCli([
      basePath,
      currentPath,
      otherPath,
      "sensor-near-duplicates.baseline.json",
      markerPath,
      "deadbeef",
    ]);

    expect(exitCode).toBe(0);
    expect(readFileSync(currentPath, "utf8")).toBe(baselineText());
    expect(existsSync(markerPath)).toBe(true);
  });
});
