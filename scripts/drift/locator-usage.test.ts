import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildLocatorUsageReport,
  countOccurrences,
  discoverSourceFiles,
  formatJson,
  formatText,
  parseArgs,
} from "./locator-usage.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

function makeTempRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), "locator-usage-test-"));
  tempRoots.push(root);
  mkdirSync(path.join(root, "e2e", "page-objects"), { recursive: true });
  return root;
}

function writeRepoFile(repoRoot: string, relativePath: string, contents: string): void {
  const absolutePath = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
}

describe("parseArgs", () => {
  it("defaults to text output", () => {
    expect(parseArgs([], "/repo")).toEqual({ format: "text", repoRoot: "/repo" });
  });

  it("accepts json format", () => {
    expect(parseArgs(["--format=json"], "/repo").format).toBe("json");
    expect(parseArgs(["--format", "json"], "/repo").format).toBe("json");
  });

  it("rejects unknown formats", () => {
    expect(() => parseArgs(["--format", "yaml"], "/repo")).toThrow(
      /--format requires text or json/u,
    );
  });
});

describe("locator usage report", () => {
  it("counts raw locator calls by e2e source file in deterministic order", () => {
    const repoRoot = makeTempRepo();
    writeRepoFile(repoRoot, "e2e/a.spec.ts", "page.locator('a');\npage.getByRole('button');\n");
    writeRepoFile(
      repoRoot,
      "e2e/page-objects/panel.po.ts",
      "this.page.locator('.panel').locator('button');\n",
    );
    writeRepoFile(repoRoot, "e2e/page-objects/empty.po.ts", "page.getByRole('link');\n");

    const report = buildLocatorUsageReport(repoRoot, 3);

    expect(report.totalLocatorCalls).toBe(3);
    expect(report.filesWithLocatorCalls).toBe(2);
    expect(report.debtFileCount).toBe(3);
    expect(report.files).toEqual([
      { path: "e2e/a.spec.ts", count: 1 },
      { path: "e2e/page-objects/panel.po.ts", count: 2 },
    ]);
  });

  it("discovers TypeScript e2e sources only", () => {
    const repoRoot = makeTempRepo();
    writeRepoFile(repoRoot, "e2e/a.spec.ts", "");
    writeRepoFile(repoRoot, "e2e/b.spec.tsx", "");
    writeRepoFile(repoRoot, "e2e/readme.md", ".locator(");

    expect(discoverSourceFiles(path.join(repoRoot, "e2e"), "e2e")).toEqual([
      "e2e/a.spec.ts",
      "e2e/b.spec.tsx",
    ]);
  });

  it("formats text and json summaries", () => {
    const repoRoot = makeTempRepo();
    writeRepoFile(repoRoot, "e2e/a.spec.ts", "page.locator('a');\n");
    const report = buildLocatorUsageReport(repoRoot, 1);

    expect(formatText(report)).toContain("raw .locator( calls: 1");
    expect(formatText(report)).toContain("local/e2e-prefer-role-selectors ratcheted debt files: 1");
    expect(formatText(report)).toContain("    e2e/a.spec.ts: 1");
    expect(JSON.parse(formatJson(report))).toMatchObject({
      totalLocatorCalls: 1,
      debtFileCount: 1,
    });
  });

  it("counts non-overlapping source-text occurrences", () => {
    expect(countOccurrences(".locator(.locator(", ".locator(")).toBe(2);
  });
});
