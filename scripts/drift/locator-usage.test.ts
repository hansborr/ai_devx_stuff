import { mkdirSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import {
  buildLocatorUsageReport,
  countOccurrences,
  discoverSourceFiles,
  formatJson,
  formatText,
  parseArgs,
  runLocatorUsage,
} from "./locator-usage.js";

const tmpRepo = registerTempRootCleanup();
let originalCwd: string | undefined;

afterEach(() => {
  if (originalCwd !== undefined) {
    process.chdir(originalCwd);
    originalCwd = undefined;
  }
});

function makeTempRepo(): string {
  const root = tmpRepo.makeTempRepo("locator-usage-test-");
  mkdirSync(path.join(root, "e2e", "page-objects"), { recursive: true });
  return root;
}

function writeRepoFile(repoRoot: string, relativePath: string, contents: string): void {
  tmpRepo.writeRepoFile(repoRoot, relativePath, contents);
}

function thrownMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected function to throw");
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

  it("throws help on --help and -h", () => {
    expect(() => parseArgs(["--help"], "/repo")).toThrow(/bun run drift:e2e/u);
    expect(() => parseArgs(["-h"], "/repo")).toThrow(/bun run drift:e2e/u);
  });

  it("throws when --format has no following value", () => {
    expect(() => parseArgs(["--format"], "/repo")).toThrow(/--format requires a value/u);
  });

  it("throws when --format receives another option as its value", () => {
    expect(() => parseArgs(["--format", "--help"], "/repo")).toThrow(/--format requires a value/u);
    expect(() => parseArgs(["--format=--help"], "/repo")).toThrow(/--format requires a value/u);
  });

  it("preserves empty string argv entries as unknown arguments", () => {
    const unknownMessage = thrownMessage(() => parseArgs(["--nope"], "/repo"));
    expect(thrownMessage(() => parseArgs([""], "/repo"))).toBe(
      unknownMessage.replace("--nope", ""),
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

    const report = buildLocatorUsageReport(repoRoot);

    expect(report.totalLocatorCalls).toBe(3);
    expect(report.filesWithLocatorCalls).toBe(2);
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
    const report = buildLocatorUsageReport(repoRoot);

    expect(formatText(report)).toContain("raw .locator( calls: 1");
    expect(formatText(report)).not.toContain("ratcheted debt files");
    expect(formatText(report)).toContain("    e2e/a.spec.ts: 1");
    expect(JSON.parse(formatJson(report))).toMatchObject({
      schemaVersion: 2,
      totalLocatorCalls: 1,
    });
  });

  it("formats an empty report with the OK success line and no by-file section", () => {
    const repoRoot = makeTempRepo();
    writeRepoFile(repoRoot, "e2e/a.spec.ts", "page.getByRole('button');\n");
    const report = buildLocatorUsageReport(repoRoot);

    expect(report.files).toEqual([]);
    const text = formatText(report);
    expect(text).toContain("OK: no raw .locator( calls found.");
    expect(text).not.toContain("  by file:");
  });

  it("counts non-overlapping source-text occurrences", () => {
    expect(countOccurrences(".locator(.locator(", ".locator(")).toBe(2);
  });
});

describe("runLocatorUsage", () => {
  function chdirToTempRepo(): string {
    const repoRoot = makeTempRepo();
    if (originalCwd === undefined) originalCwd = process.cwd();
    process.chdir(repoRoot);
    return repoRoot;
  }

  it("emits the text report and exit code 0 by default", () => {
    chdirToTempRepo();
    writeRepoFile(process.cwd(), "e2e/a.spec.ts", "page.locator('a');\n");

    const result = runLocatorUsage([]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("raw .locator( calls: 1");
    expect(() => JSON.parse(result.stdout)).toThrow();
  });

  it("emits the JSON report when --format json is given", () => {
    chdirToTempRepo();
    writeRepoFile(process.cwd(), "e2e/a.spec.ts", "page.locator('a');\n");

    const result = runLocatorUsage(["--format", "json"]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schemaVersion: 2,
      totalLocatorCalls: 1,
    });
  });

  it("maps a usage error to exit code 2", () => {
    chdirToTempRepo();

    const result = runLocatorUsage(["--format", "xml"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("--format requires text or json");
  });

  it("maps --help to exit code 0 with usage text", () => {
    chdirToTempRepo();

    const result = runLocatorUsage(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("bun run drift:e2e");
  });
});
