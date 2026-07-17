import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { KNIP_SYMBOL_INCLUDE_CATEGORIES, type KnipRunner } from "./drift-ai/knip-runner.js";
import type { UnusedExportCategory } from "./drift-ai/knip-unused-exports.js";
import {
  formatKnipUnusedExportsBaseline,
  type KnipUnusedExportEntry,
  runKnipUnusedExportsCli,
} from "./sensor-knip-unused-exports.js";
import { registerTempRootCleanup } from "./test-support/tmp-repo.test-helper.js";

const tmpRepo = registerTempRootCleanup();
const SYMBOL_FILE = "src/symbols.ts";
const repoRoot = path.resolve(import.meta.dirname, "..");
const DRIVER_WARN =
  "WARN: knip unused-exports merge driver is missing or stale - run bun run sensor:knip-unused-exports:install-merge-driver";
const CONFLICT_MARKER_TRIPWIRE =
  "sensor-knip-unused-exports.baseline.json is generated; Git conflict markers mean its semantic merge driver was not installed. Run `bun run sensor:knip-unused-exports:install-merge-driver`, restore a parseable side with `bun run baseline:restore-stage -- --ours sensor-knip-unused-exports.baseline.json` (always use stage 2/`--ours`; during rebase stage 2 is the upstream base, not the branch being rebased; if the markers were already committed, restore that side from a parent commit first), then resolve by regenerating with `bun scripts/sensor-knip-unused-exports.ts --update`; never hand-merge this file. Inspect the resulting baseline against both sides before staging; preserve any lower floor from the other side or explicitly accept the regression.";
const SUPPRESS_DRIVER_WARN_ENV = "MUSI_SUPPRESS_MERGE_DRIVER_WARN";

type CategoryCounts = Partial<Record<UnusedExportCategory, number>>;

function entry(category: UnusedExportCategory, symbol: string): KnipUnusedExportEntry {
  return { key: `${category}|${SYMBOL_FILE}|${symbol}`, path: SYMBOL_FILE, category, symbol };
}

function entriesFor(counts: CategoryCounts): KnipUnusedExportEntry[] {
  const entries: KnipUnusedExportEntry[] = [];
  for (let i = 1; i <= (counts.exports ?? 0); i += 1)
    entries.push(entry("exports", `unusedExport${String(i)}`));
  for (let i = 1; i <= (counts.types ?? 0); i += 1)
    entries.push(entry("types", `UnusedType${String(i)}`));
  for (let i = 1; i <= (counts.enumMembers ?? 0); i += 1)
    entries.push(entry("enumMembers", `UnusedEnum.Member${String(i)}`));
  for (let i = 1; i <= (counts.namespaceMembers ?? 0); i += 1)
    entries.push(entry("namespaceMembers", `UnusedNamespace.member${String(i)}`));
  return entries;
}

function baselineText(counts: CategoryCounts): string {
  return formatKnipUnusedExportsBaseline(entriesFor(counts));
}

function knipReporting(reportJson: string): KnipRunner {
  return () => ({ ok: true, reportJson, exitCode: 1, stderr: "" });
}

function unusedExportReport(counts: CategoryCounts): string {
  const issues = [
    {
      file: SYMBOL_FILE,
      exports: Array.from({ length: counts.exports ?? 0 }, (_, i) => ({
        name: `unusedExport${String(i + 1)}`,
      })),
      types: Array.from({ length: counts.types ?? 0 }, (_, i) => ({
        name: `UnusedType${String(i + 1)}`,
      })),
      enumMembers: Array.from({ length: counts.enumMembers ?? 0 }, (_, i) => ({
        namespace: "UnusedEnum",
        name: `Member${String(i + 1)}`,
      })),
      namespaceMembers: Array.from({ length: counts.namespaceMembers ?? 0 }, (_, i) => ({
        namespace: "UnusedNamespace",
        name: `member${String(i + 1)}`,
      })),
    },
  ];
  return JSON.stringify({ issues });
}

function baselineRecord(): Record<string, unknown> {
  return {
    version: 2,
    tool: "knip",
    metric: "unused-export-symbols",
    includeCategories: KNIP_SYMBOL_INCLUDE_CATEGORIES,
    summary: {
      count: 1,
      categories: { exports: 1, types: 0, enumMembers: 0, namespaceMembers: 0 },
    },
    entries: [
      {
        key: `exports|${SYMBOL_FILE}|unusedExport1`,
        path: SYMBOL_FILE,
        category: "exports",
        symbol: "unusedExport1",
      },
    ],
  };
}

function baselineJson(overrides: Record<string, unknown>): string {
  return `${JSON.stringify({ ...baselineRecord(), ...overrides }, null, 2)}\n`;
}

function makeDriverFixture(): string {
  const root = tmpRepo.makeTmpGitRepo("knip-driver-presence-");
  tmpRepo.writeRepoFile(root, "scripts/git/.gitkeep", "");
  copyFileSync(
    path.join(repoRoot, "scripts/git/baseline-merge-driver.sh"),
    path.join(root, "scripts/git/baseline-merge-driver.sh"),
  );
  return root;
}

function installDriver(root: string): void {
  execFileSync(
    "bash",
    [path.join(repoRoot, "scripts/git/install-knip-unused-exports-merge-driver.sh")],
    {
      cwd: root,
      stdio: "ignore",
    },
  );
}

describe("runKnipUnusedExportsCli", () => {
  it("warns once in check and update modes when the merge driver is missing", () => {
    const root = makeDriverFixture();
    const baselinePath = path.join(root, "sensor-knip-unused-exports.baseline.json");
    const warnings: string[] = [];
    const runner = knipReporting(unusedExportReport({ exports: 1 }));
    writeFileSync(baselinePath, baselineText({ exports: 1 }));

    const check = runKnipUnusedExportsCli({
      argv: [],
      cwd: root,
      runner,
      warn: (line) => warnings.push(line),
    });
    expect(check.exitCode).toBe(0);
    expect(check.stdout).not.toContain(DRIVER_WARN);
    expect(warnings).toEqual([DRIVER_WARN]);

    warnings.length = 0;
    const update = runKnipUnusedExportsCli({
      argv: ["--update"],
      cwd: root,
      runner,
      warn: (line) => warnings.push(line),
    });
    expect(update.exitCode).toBe(0);
    expect(update.stdout).not.toContain(DRIVER_WARN);
    expect(warnings).toEqual([DRIVER_WARN]);
  });

  it("stays silent when the merge driver is installed or warning probes are suppressed", () => {
    const root = makeDriverFixture();
    const baselinePath = path.join(root, "sensor-knip-unused-exports.baseline.json");
    const runner = knipReporting(unusedExportReport({ exports: 1 }));
    writeFileSync(baselinePath, baselineText({ exports: 1 }));
    installDriver(root);

    const installedWarnings: string[] = [];
    expect(
      runKnipUnusedExportsCli({
        argv: [],
        cwd: root,
        runner,
        warn: (line) => installedWarnings.push(line),
      }).exitCode,
    ).toBe(0);
    expect(installedWarnings).toEqual([]);

    const ciRoot = makeDriverFixture();
    const ciWarnings: string[] = [];
    writeFileSync(
      path.join(ciRoot, "sensor-knip-unused-exports.baseline.json"),
      baselineText({ exports: 1 }),
    );
    expect(
      runKnipUnusedExportsCli({
        argv: [],
        cwd: ciRoot,
        env: { CI: "1" },
        runner,
        warn: (line) => ciWarnings.push(line),
      }).exitCode,
    ).toBe(0);
    expect(ciWarnings).toEqual([]);

    const suppressedWarnings: string[] = [];
    expect(
      runKnipUnusedExportsCli({
        argv: [],
        cwd: ciRoot,
        env: { [SUPPRESS_DRIVER_WARN_ENV]: "1" },
        runner,
        warn: (line) => suppressedWarnings.push(line),
      }).exitCode,
    ).toBe(0);
    expect(suppressedWarnings).toEqual([]);
  });

  it("passes when the current identities match the baseline", () => {
    const root = tmpRepo.writeRepo({
      "sensor-knip-unused-exports.baseline.json": baselineText({ exports: 1, types: 1 }),
    });

    const result = runKnipUnusedExportsCli({
      argv: [],
      cwd: root,
      runner: knipReporting(unusedExportReport({ exports: 1, types: 1 })),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("OK: knip unused-export symbols match baseline 2 identities");
  });

  it("fails and names the new identity when an unused export is added", () => {
    const root = tmpRepo.writeRepo({
      "sensor-knip-unused-exports.baseline.json": baselineText({ exports: 1 }),
    });

    const result = runKnipUnusedExportsCli({
      argv: [],
      cwd: root,
      runner: knipReporting(unusedExportReport({ exports: 2 })),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("added 1 new identity");
    expect(result.stdout).toContain(`+ exports|${SYMBOL_FILE}|unusedExport2`);
  });

  it("fails a same-count swap that a count-only floor would miss", () => {
    const root = tmpRepo.writeRepo({
      "sensor-knip-unused-exports.baseline.json": formatKnipUnusedExportsBaseline([
        entry("exports", "retiredSymbol"),
      ]),
    });

    const result = runKnipUnusedExportsCli({
      argv: [],
      cwd: root,
      runner: knipReporting(unusedExportReport({ exports: 1 })),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("added 1 new identity");
    expect(result.stdout).toContain(`+ exports|${SYMBOL_FILE}|unusedExport1`);
    expect(result.stdout).toContain(`- exports|${SYMBOL_FILE}|retiredSymbol`);
  });

  it("fails and requires lowering the baseline when identities disappear", () => {
    const root = tmpRepo.writeRepo({
      "sensor-knip-unused-exports.baseline.json": baselineText({ exports: 3 }),
    });

    const result = runKnipUnusedExportsCli({
      argv: [],
      cwd: root,
      runner: knipReporting(unusedExportReport({ exports: 1 })),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("dropped 2 baseline identities");
    expect(result.stdout).toContain(
      "run bun scripts/sensor-knip-unused-exports.ts --update to lock it in by lowering the committed baseline.",
    );
    expect(result.stdout).toContain(`- exports|${SYMBOL_FILE}|unusedExport2`);
  });

  it("writes a deterministic identity baseline in update mode", () => {
    const root = tmpRepo.makeTempRepo("sensor-knip-unused-exports-");
    const baselinePath = path.join(root, "baseline.json");

    const result = runKnipUnusedExportsCli({
      argv: ["--update", `--baseline=${baselinePath}`],
      cwd: root,
      runner: knipReporting(unusedExportReport({ exports: 1, enumMembers: 1 })),
    });

    expect(result.exitCode).toBe(0);
    expect(readFileSync(baselinePath, "utf8")).toBe(baselineText({ exports: 1, enumMembers: 1 }));
  });

  it("returns an infrastructure failure when knip cannot run", () => {
    const root = tmpRepo.writeRepo({
      "sensor-knip-unused-exports.baseline.json": baselineText({}),
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
    { name: "invalid JSON", baseline: "{", expected: "ERROR: baseline is not valid JSON:" },
    {
      name: "wrong version",
      baseline: baselineJson({ version: 1 }),
      expected: "ERROR: baseline version must be 2",
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
      name: "entry key mismatch",
      baseline: baselineJson({
        summary: {
          count: 1,
          categories: { exports: 1, types: 0, enumMembers: 0, namespaceMembers: 0 },
        },
        entries: [
          {
            key: "exports|src/symbols.ts|wrong",
            path: SYMBOL_FILE,
            category: "exports",
            symbol: "unusedExport1",
          },
        ],
      }),
      expected: "entry key must be 'exports|src/symbols.ts|unusedExport1'",
    },
  ])("returns an infrastructure failure for $name in the baseline", ({ baseline, expected }) => {
    const root = tmpRepo.writeRepo({ "sensor-knip-unused-exports.baseline.json": baseline });

    const result = runKnipUnusedExportsCli({
      argv: [],
      cwd: root,
      runner: knipReporting(unusedExportReport({ exports: 1 })),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain(expected);
  });

  it("replaces a generic JSON error with merge-driver recovery for conflict markers", () => {
    const root = tmpRepo.writeRepo({
      "sensor-knip-unused-exports.baseline.json":
        '<<<<<<< ours\n{"version":2}\n=======\n{"version":2}\n>>>>>>> theirs\n',
    });

    const result = runKnipUnusedExportsCli({
      argv: [],
      cwd: root,
      runner: knipReporting(unusedExportReport({})),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe(`ERROR: ${CONFLICT_MARKER_TRIPWIRE}`);
    expect(result.stdout).not.toContain("JSON");
  });

  it("blocks summary drift until update regenerates the derived summary", () => {
    const root = tmpRepo.writeRepo({
      "sensor-knip-unused-exports.baseline.json": baselineJson({
        summary: {
          count: 2,
          categories: { exports: 2, types: 0, enumMembers: 0, namespaceMembers: 0 },
        },
      }),
    });

    const result = runKnipUnusedExportsCli({
      argv: [],
      cwd: root,
      runner: knipReporting(unusedExportReport({ exports: 1 })),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("WARN: baseline summary does not match the entries");
    expect(result.stdout).toContain(
      'derived {"count":1,"categories":{"exports":1,"types":0,"enumMembers":0,"namespaceMembers":0}}',
    );
    expect(result.stdout).toContain(
      'committed {"count":2,"categories":{"exports":2,"types":0,"enumMembers":0,"namespaceMembers":0}}',
    );
    expect(result.stdout).toContain("run: bun scripts/sensor-knip-unused-exports.ts --update");
    expect(result.stdout).toContain("OK: knip unused-export symbols match baseline 1 identities");

    const updateResult = runKnipUnusedExportsCli({
      argv: ["--update"],
      cwd: root,
      runner: knipReporting(unusedExportReport({ exports: 1 })),
    });

    expect(updateResult.exitCode).toBe(0);
    expect(readFileSync(path.join(root, "sensor-knip-unused-exports.baseline.json"), "utf8")).toBe(
      baselineText({ exports: 1 }),
    );

    const repairedCheck = runKnipUnusedExportsCli({
      argv: [],
      cwd: root,
      runner: knipReporting(unusedExportReport({ exports: 1 })),
    });

    expect(repairedCheck.exitCode).toBe(0);
    expect(repairedCheck.stdout).not.toContain("WARN:");
  });

  it("keeps entry mismatch failure messaging ahead of simultaneous summary drift", () => {
    const root = tmpRepo.writeRepo({
      "sensor-knip-unused-exports.baseline.json": baselineJson({
        summary: {
          count: 2,
          categories: { exports: 2, types: 0, enumMembers: 0, namespaceMembers: 0 },
        },
      }),
    });

    const result = runKnipUnusedExportsCli({
      argv: [],
      cwd: root,
      runner: knipReporting(unusedExportReport({ exports: 2 })),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("FAIL: knip unused-export symbols added 1 new identity");
    expect(result.stdout).not.toContain("WARN: baseline summary does not match the entries");
    expect(result.stdout).not.toContain("run: bun scripts/sensor-knip-unused-exports.ts --update");
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
