import type { EditCheckRegression } from "@musi/lint-ratchet/governance/edit-check.js";
import { describe, expect, it } from "vitest";

import type { RuleDocsEntry } from "../lib/lint-rule-docs.js";
import {
  editCheckRepairCommandFor,
  editCheckTargetsFileToRead,
  withEditCheckRepairCommands,
} from "./modes.js";

function docsEntry(overrides: Partial<RuleDocsEntry>): RuleDocsEntry {
  return {
    id: "local/example-rule",
    description: "Example rule.",
    principle: "Example principle.",
    category: "behavior",
    pairedGuide: "none",
    repairKind: "manual",
    ...overrides,
  };
}

function regression(overrides: Partial<EditCheckRegression>): EditCheckRegression {
  return {
    path: "packages/shared/src/example.ts",
    testId: "ratchet/local-example-rule",
    ruleId: "local/example-rule",
    reason: "new-path",
    baselineCount: 0,
    currentCount: 1,
    ...overrides,
  };
}

describe("editCheckRepairCommandFor", () => {
  it("returns the codemod command for a codemod-repair rule", () => {
    const entry = docsEntry({ repairKind: "codemod", repairCommand: "bun run lint:fix-barrels" });
    expect(editCheckRepairCommandFor(entry)).toBe("bun run lint:fix-barrels");
  });

  it("returns the autofix runner for an autofix-repair rule", () => {
    expect(editCheckRepairCommandFor(docsEntry({ repairKind: "autofix" }))).toBe(
      "bun run lint:fix",
    );
  });

  it("returns undefined for manual and suggestion rules and for rules without docs", () => {
    expect(editCheckRepairCommandFor(docsEntry({ repairKind: "manual" }))).toBeUndefined();
    expect(editCheckRepairCommandFor(docsEntry({ repairKind: "suggestion" }))).toBeUndefined();
    expect(editCheckRepairCommandFor(undefined)).toBeUndefined();
  });
});

describe("withEditCheckRepairCommands", () => {
  it("attaches repair commands to regressions whose rule docs declare a mechanical repair", async () => {
    const docsById = new Map<string, RuleDocsEntry>([
      ["local/autofixable", docsEntry({ id: "local/autofixable", repairKind: "autofix" })],
      ["local/manual-only", docsEntry({ id: "local/manual-only", repairKind: "manual" })],
    ]);
    const rows = [
      regression({ ruleId: "local/autofixable" }),
      regression({ ruleId: "local/manual-only" }),
      regression({ ruleId: "vitest/expect-expect" }),
    ];
    const enriched = await withEditCheckRepairCommands(rows, () => Promise.resolve(docsById));
    expect(enriched.map((row) => row.repairCommand)).toEqual([
      "bun run lint:fix",
      undefined,
      undefined,
    ]);
  });

  it("returns the input untouched without loading docs when there are no regressions", async () => {
    let loads = 0;
    const enriched = await withEditCheckRepairCommands([], () => {
      loads += 1;
      return Promise.resolve(new Map<string, RuleDocsEntry>());
    });
    expect(enriched).toEqual([]);
    expect(loads).toBe(0);
  });

  it("degrades to unenriched regressions with a breadcrumb when rule docs fail to load", async () => {
    const notices: string[] = [];
    const rows = [regression({ ruleId: "local/autofixable" })];
    const enriched = await withEditCheckRepairCommands(
      rows,
      () => Promise.reject(new Error("docs unavailable")),
      (message) => notices.push(message),
    );
    expect(enriched).toEqual(rows);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("omitting repair commands");
  });
});

describe("editCheckTargetsFileToRead", () => {
  it("skips silently when no --targets-file was passed", () => {
    const notices: string[] = [];
    const result = editCheckTargetsFileToRead(
      undefined,
      () => false,
      (message) => notices.push(message),
    );
    expect(result).toBeUndefined();
    expect(notices).toEqual([]);
  });

  it("emits a breadcrumb when the flag named a file that does not exist", () => {
    const notices: string[] = [];
    const result = editCheckTargetsFileToRead(
      "/tmp/targets.txt",
      () => false,
      (message) => notices.push(message),
    );
    expect(result).toBeUndefined();
    expect(notices).toEqual([
      "lint:ratchet: --edit-check targets file not found: /tmp/targets.txt; skipping",
    ]);
  });

  it("returns the path to read when the file exists", () => {
    const notices: string[] = [];
    const result = editCheckTargetsFileToRead(
      "/tmp/targets.txt",
      () => true,
      (message) => notices.push(message),
    );
    expect(result).toBe("/tmp/targets.txt");
    expect(notices).toEqual([]);
  });
});
