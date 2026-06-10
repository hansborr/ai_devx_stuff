import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { formatJson } from "./report-format.js";
import { DRIFT_SCHEMA_VERSION, type DriftReport } from "./types.js";

// Contract fixtures for the portable `drift:ai --format json` report. This surface
// — not the Musi-only `HARNESS_DIAGNOSTICS_OUTPUT` sidecar — is what a foreign-repo
// or downstream consumer reads, so its shape must change deliberately. The golden
// files below are byte-compared against `formatJson` output: adding, removing,
// renaming, or reordering a key fails this test until the fixture is regenerated.
//
// To regenerate after an *intentional* contract change (including a
// `DRIFT_SCHEMA_VERSION` bump), run the suite with `UPDATE_DRIFT_CONTRACT=1` and
// review the resulting fixture diff. The fixtures live in `.prettierignore` so the
// bytes stay exactly what `formatJson` emits.
const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const UPDATE = process.env["UPDATE_DRIFT_CONTRACT"] === "1";

function contractFixture(name: string, rendered: string): string {
  const file = path.join(FIXTURES_DIR, name);
  const contents = `${rendered}\n`;
  if (UPDATE) writeFileSync(file, contents);
  return readFileSync(file, "utf8");
}

// A clean changed-scope run: base/resolvedRef populated, empty roots, no findings
// or skips, and timing omitted so the v3-tolerant (timing-absent) path is covered.
// The scope carries both a plain `modified` entry and a `renamed` entry with
// `previousPath`, so the changed-scope `ScopeFile` shape (status + optional
// previousPath) is byte-pinned under `--include-scope` alongside the current-scope
// shape exercised by FINDINGS_REPORT.
const CLEAN_REPORT: DriftReport = {
  schemaVersion: DRIFT_SCHEMA_VERSION,
  scopeMode: "changed",
  base: "main",
  resolvedRef: "1f3a9c2",
  roots: [],
  configPath: null,
  enabledChecks: ["duplicates", "ghost-files", "comments", "suppressions"],
  skippedChecks: [],
  summary: {
    total: 0,
    byCheck: { duplicates: 0, "ghost-files": 0, comments: 0, suppressions: 0 },
  },
  findings: [],
  scopeCount: 2,
  scope: [
    { scope: "changed", path: "packages/server/src/services/foo.ts", status: "modified" },
    {
      scope: "changed",
      path: "packages/server/src/services/bar.ts",
      status: "renamed",
      previousPath: "packages/server/src/services/baz.ts",
    },
  ],
};

// A current-scope run exercising every optional carrier: a plain finding, a
// `details`-only finding (number/boolean/string[] values), a `details` + drift
// baseline `provenance` finding (no configPath), a target-config `provenance`
// finding (with configPath), skips with and without a machine-readable `code`, and
// the additive v4 timing block.
const FINDINGS_REPORT: DriftReport = {
  schemaVersion: DRIFT_SCHEMA_VERSION,
  scopeMode: "current",
  base: null,
  resolvedRef: null,
  roots: ["packages/server/src", "packages/shared/src"],
  configPath: "drift-ai.config.json",
  enabledChecks: ["duplicates", "import-cycles", "near-duplicates", "orphan-files"],
  skippedChecks: [
    { check: "unused-exports", reason: "no knip config found in target", code: "no-target-config" },
    { check: "suppressions", reason: "only available in changed scope" },
  ],
  summary: {
    total: 4,
    byCheck: { duplicates: 1, "import-cycles": 1, "near-duplicates": 1, "orphan-files": 1 },
  },
  checkTimings: [
    { check: "duplicates", durationMs: 12 },
    { check: "import-cycles", durationMs: 40 },
    { check: "near-duplicates", durationMs: 88 },
    { check: "orphan-files", durationMs: 5 },
  ],
  totalDurationMs: 145,
  findings: [
    {
      check: "duplicates",
      file: "packages/server/src/services/foo.ts",
      message: "12-line copy/paste clone shared with packages/server/src/services/bar.ts",
      hint: "extract the shared block into one helper",
      relatedFiles: ["packages/server/src/services/bar.ts"],
    },
    {
      check: "import-cycles",
      file: "packages/server/src/a.ts",
      message: "import cycle of 3 modules",
      details: {
        cycleSize: 3,
        typeOnly: false,
        members: [
          "packages/server/src/a.ts",
          "packages/server/src/b.ts",
          "packages/server/src/c.ts",
        ],
      },
    },
    {
      check: "near-duplicates",
      file: "packages/server/src/services/x.ts",
      message: "same-shaped function clone of packages/server/src/services/y.ts",
      relatedFiles: ["packages/server/src/services/y.ts"],
      details: { similarity: 0.92, minLines: 8 },
      provenance: { configSource: "drift-baseline", tool: "ts-morph" },
    },
    {
      check: "orphan-files",
      file: "packages/server/src/legacy/unused.ts",
      message: "file is never imported",
      provenance: { configSource: "target-config", tool: "knip", configPath: "knip.json" },
    },
  ],
  scopeCount: 2,
  scope: [
    { scope: "current", path: "packages/server/src/services/foo.ts" },
    { scope: "current", path: "packages/server/src/legacy/unused.ts" },
  ],
};

describe("portable --format json report contract", () => {
  it("renders a clean run, omitting scope and timing", () => {
    const rendered = formatJson(CLEAN_REPORT);
    const parsed = JSON.parse(rendered) as Record<string, unknown>;
    expect(parsed["schemaVersion"]).toBe(DRIFT_SCHEMA_VERSION);
    expect(parsed).not.toHaveProperty("scope");
    expect(parsed).not.toHaveProperty("checkTimings");
    expect(`${rendered}\n`).toBe(contractFixture("report-contract.clean.json", rendered));
  });

  it("renders findings with details, provenance, skip codes, and timing", () => {
    const rendered = formatJson(FINDINGS_REPORT);
    const parsed = JSON.parse(rendered) as Record<string, unknown>;
    expect(parsed["schemaVersion"]).toBe(DRIFT_SCHEMA_VERSION);
    expect(parsed).not.toHaveProperty("scope");
    expect(`${rendered}\n`).toBe(contractFixture("report-contract.findings.json", rendered));
  });

  it("appends scope after scopeCount only when includeScope is set", () => {
    const rendered = formatJson(FINDINGS_REPORT, { includeScope: true });
    const parsed = JSON.parse(rendered) as Record<string, unknown>;
    expect(parsed["scope"]).toEqual(FINDINGS_REPORT.scope);
    const keys = Object.keys(parsed);
    expect(keys.indexOf("scopeCount")).toBeLessThan(keys.indexOf("scope"));
    expect(`${rendered}\n`).toBe(
      contractFixture("report-contract.findings.with-scope.json", rendered),
    );
  });

  it("pins the changed-scope scope entry shape (status, previousPath) under includeScope", () => {
    const rendered = formatJson(CLEAN_REPORT, { includeScope: true });
    const parsed = JSON.parse(rendered) as Record<string, unknown>;
    expect(parsed["scope"]).toEqual(CLEAN_REPORT.scope);
    expect(`${rendered}\n`).toBe(
      contractFixture("report-contract.clean.with-scope.json", rendered),
    );
  });

  // A `DRIFT_SCHEMA_VERSION` bump must travel with regenerated fixtures, so guard
  // each golden file's declared version against the live constant.
  it("keeps every fixture's schemaVersion on the live DRIFT_SCHEMA_VERSION", () => {
    for (const name of [
      "report-contract.clean.json",
      "report-contract.clean.with-scope.json",
      "report-contract.findings.json",
      "report-contract.findings.with-scope.json",
    ]) {
      const parsed = JSON.parse(readFileSync(path.join(FIXTURES_DIR, name), "utf8")) as Record<
        string,
        unknown
      >;
      expect(parsed["schemaVersion"]).toBe(DRIFT_SCHEMA_VERSION);
    }
  });
});
