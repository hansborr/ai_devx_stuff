import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  formatMaxLinesExceptionsBaseline,
  makeMaxLinesExceptionEntry,
  type MaxLinesExceptionEntry,
} from "./max-lines-exceptions-core.js";
import { runMaxLinesExceptionsMergeCli } from "./max-lines-exceptions-merge-cli.js";
import { registerTempRootCleanup } from "./test-support/tmp-repo.test-helper.js";

const tmpRepo = registerTempRootCleanup();

function entry(pathname: string, cap = 400): MaxLinesExceptionEntry {
  return makeMaxLinesExceptionEntry({
    path: pathname,
    cap,
    severity: "warn",
    reason: "legacy file pending split",
    lifecycle: "candidate-for-split",
    ratchetExcluded: true,
  });
}

function baselineText(...paths: readonly string[]): string {
  return formatMaxLinesExceptionsBaseline(paths.map((pathname) => entry(pathname)));
}

function baselineEntries(...entries: readonly MaxLinesExceptionEntry[]): string {
  return formatMaxLinesExceptionsBaseline(entries);
}

interface MergeFixture {
  readonly basePath: string;
  readonly currentPath: string;
  readonly otherPath: string;
  readonly markerPath: string;
}

function writeMergeFixture(base: string, current: string, other: string): MergeFixture {
  const root = tmpRepo.makeTempRepo("max-lines-merge-cli-");
  const basePath = path.join(root, "base.json");
  const currentPath = path.join(root, "current.json");
  const otherPath = path.join(root, "other.json");
  writeFileSync(basePath, base);
  writeFileSync(currentPath, current);
  writeFileSync(otherPath, other);
  return { basePath, currentPath, otherPath, markerPath: path.join(root, "marker") };
}

describe("runMaxLinesExceptionsMergeCli", () => {
  it("keeps shared exception entries and emits normalized hard-fail-safe JSON", async () => {
    const base = baselineText("src/a.ts", "src/b.ts", "src/c.ts");
    const current = baselineText("src/a.ts", "src/c.ts");
    const other = baselineText("src/b.ts", "src/c.ts");
    const fixture = writeMergeFixture(base, current, other);

    const exitCode = await runMaxLinesExceptionsMergeCli([
      fixture.basePath,
      fixture.currentPath,
      fixture.otherPath,
      "eslint-config/max-lines-exceptions.baseline.json",
    ]);

    expect(exitCode).toBe(0);
    expect(readFileSync(fixture.currentPath, "utf8")).toBe(baselineText("src/c.ts"));
    expect(existsSync(fixture.markerPath)).toBe(false);
  });

  it("preserves disjoint exceptions added by both sides", async () => {
    const base = baselineText("src/c.ts");
    const current = baselineEntries(entry("src/a.ts", 410), entry("src/c.ts"));
    const other = baselineEntries(entry("src/b.ts", 420), entry("src/c.ts"));
    const fixture = writeMergeFixture(base, current, other);

    const exitCode = await runMaxLinesExceptionsMergeCli([
      fixture.basePath,
      fixture.currentPath,
      fixture.otherPath,
      "eslint-config/max-lines-exceptions.baseline.json",
    ]);

    expect(exitCode).toBe(0);
    expect(readFileSync(fixture.currentPath, "utf8")).toBe(
      baselineEntries(entry("src/a.ts", 410), entry("src/b.ts", 420), entry("src/c.ts")),
    );
  });

  it("writes a pre-merge-head marker when conflicting caps take the minimum", async () => {
    const base = baselineEntries(entry("src/a.ts", 500));
    const current = baselineEntries(entry("src/a.ts", 420));
    const other = baselineEntries(entry("src/a.ts", 430));
    const fixture = writeMergeFixture(base, current, other);
    const preMergeHead = "1234567890123456789012345678901234567890";

    const exitCode = await runMaxLinesExceptionsMergeCli([
      fixture.basePath,
      fixture.currentPath,
      fixture.otherPath,
      "eslint-config/max-lines-exceptions.baseline.json",
      fixture.markerPath,
      preMergeHead,
    ]);

    expect(exitCode).toBe(0);
    expect(readFileSync(fixture.currentPath, "utf8")).toBe(baselineEntries(entry("src/a.ts", 420)));
    expect(readFileSync(fixture.markerPath, "utf8")).toBe(
      `max-lines exceptions baseline semantic merge requires post-merge truth-up\npre-merge-head=${preMergeHead}\n`,
    );
  });

  it("takes the other side verbatim and writes no marker when one side is unchanged", async () => {
    const base = baselineText("src/a.ts", "src/b.ts");
    const other = baselineText("src/a.ts");
    const fixture = writeMergeFixture(base, base, other);

    const exitCode = await runMaxLinesExceptionsMergeCli([
      fixture.basePath,
      fixture.currentPath,
      fixture.otherPath,
      "eslint-config/max-lines-exceptions.baseline.json",
    ]);

    expect(exitCode).toBe(0);
    expect(readFileSync(fixture.currentPath, "utf8")).toBe(other);
  });

  it("returns a nonzero exit and leaves current untouched when a side cannot be parsed", async () => {
    const base = baselineText("src/a.ts");
    const current = baselineText("src/a.ts", "src/b.ts");
    const fixture = writeMergeFixture(base, current, "{ not json");

    const exitCode = await runMaxLinesExceptionsMergeCli([
      fixture.basePath,
      fixture.currentPath,
      fixture.otherPath,
    ]);

    expect(exitCode).toBe(1);
    expect(readFileSync(fixture.currentPath, "utf8")).toBe(current);
  });
});
