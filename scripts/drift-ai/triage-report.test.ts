import { describe, expect, it } from "vitest";

import { DEFAULT_CHECKS } from "./check-metadata.js";
import { buildTriageReport, type NamedTriageInput, parseTriageInput } from "./triage-report.js";
import type { DolosRowInput } from "./triage-report-contracts.js";
import { isTestLocation } from "./triage-report-locations.js";

function input(path: string, value: unknown): NamedTriageInput {
  return { path, input: parseTriageInput(value) };
}

describe("buildTriageReport", () => {
  it("accepts drift findings without an optional repair hint", () => {
    const report = buildTriageReport([
      input("drift.json", {
        schemaVersion: 4,
        skippedChecks: [],
        findings: [
          {
            check: "comments",
            file: "src/a.ts",
            message: "comment-heavy file",
          },
        ],
      }),
    ]);

    expect(report.items).toHaveLength(1);
    expect(report.items[0]?.evidence[0]).toMatchObject({ message: "comment-heavy file" });
    expect(report.items[0]?.evidence[0]).not.toHaveProperty("detail");
  });

  it("preserves drift finding provenance in triage evidence", () => {
    const report = buildTriageReport([
      input("drift.json", {
        schemaVersion: 4,
        skippedChecks: [],
        findings: [
          {
            check: "orphan-files",
            file: "src/orphan.ts",
            message: "orphan candidate",
            provenance: {
              configSource: "drift-baseline",
              tool: "knip",
            },
          },
        ],
      }),
    ]);

    expect(report.items[0]?.evidence[0]).toMatchObject({
      provenance: { configSource: "drift-baseline", tool: "knip" },
    });
  });

  it("emits unique ids for distinct rows with the same source location", () => {
    const sharedRange = [{ startLine: 8, startCol: 2, endLine: 8, endCol: 14 }];
    const report = buildTriageReport([
      input("drift.json", {
        schemaVersion: 4,
        skippedChecks: [],
        findings: [
          { check: "comments", file: "src/a.ts", message: "first comment signal" },
          { check: "comments", file: "src/a.ts", message: "second comment signal" },
        ],
      }),
      input("semgrep.json", {
        kind: "advisory",
        lane: "prototype",
        subcommand: "semgrep-candidates",
        prerequisites: [],
        degradations: [],
        caps: [],
        sections: [
          {
            totalCandidates: 2,
            entries: [
              {
                rank: 1,
                candidateSource: "semgrep",
                checkId: "rules.first",
                path: "src/auth.ts",
                count: 1,
                ranges: sharedRange,
                severity: "WARNING",
                message: null,
                metadata: { cwe: ["CWE-208"] },
              },
              {
                rank: 2,
                candidateSource: "semgrep",
                checkId: "rules.second",
                path: "src/auth.ts",
                count: 1,
                ranges: sharedRange,
                severity: "WARNING",
                message: null,
                metadata: { cwe: ["CWE-209"] },
              },
            ],
          },
        ],
      }),
    ]);

    expect(report.items).toHaveLength(4);
    expect(new Set(report.items.map((item) => item.id)).size).toBe(4);
  });

  it("keeps distinct Semgrep rules without CWEs at the same range separate", () => {
    const sharedRange = [{ startLine: 8, startCol: 2, endLine: 8, endCol: 14 }];
    const report = buildTriageReport([
      input("semgrep.json", {
        kind: "advisory",
        lane: "prototype",
        subcommand: "semgrep-candidates",
        prerequisites: [],
        degradations: [],
        caps: [],
        sections: [
          {
            totalCandidates: 2,
            entries: [
              {
                rank: 1,
                candidateSource: "semgrep",
                checkId: "rules.first",
                path: "src/auth.ts",
                count: 1,
                ranges: sharedRange,
                severity: "WARNING",
                message: "first rule message",
                metadata: { cwe: [] },
              },
              {
                rank: 2,
                candidateSource: "semgrep",
                checkId: "rules.second",
                path: "src/auth.ts",
                count: 1,
                ranges: sharedRange,
                severity: "WARNING",
                message: "second rule message",
                metadata: { cwe: [] },
              },
            ],
          },
        ],
      }),
    ]);

    expect(report.summary).toMatchObject({ reviewRows: 2, reviewItems: 2, mergedRows: 0 });
    expect(report.items.map((item) => item.title).sort()).toEqual([
      "first rule message",
      "second rule message",
    ]);
  });

  it("defers explicitly informational and high-volume drift noise", () => {
    const report = buildTriageReport([
      input("drift.json", {
        schemaVersion: 4,
        skippedChecks: [],
        findings: [
          {
            check: "duplicate-literals",
            file: "src/a.ts:1-1",
            message: "literal repeated",
            hint: "inspect it",
            relatedFiles: ["src/b.ts:1-1"],
            details: { value: "example" },
          },
          {
            check: "import-cycles",
            file: "src/a.ts",
            message: "type-only cycle",
            hint: "inspect it",
            relatedFiles: ["src/b.ts"],
            details: { typeOnly: true },
          },
          {
            check: "module-doc-paths",
            file: "src/MODULE.md:12",
            message: "stale path",
            hint: "update it",
          },
        ],
      }),
    ]);

    expect(report.summary).toMatchObject({
      inputRows: 3,
      reviewRows: 1,
      reviewItems: 1,
      deferredRows: 2,
      mergedRows: 0,
    });
    expect(report.deferred).toEqual([
      expect.objectContaining({ reason: "type-only-cycle", count: 1 }),
      expect.objectContaining({ reason: "unranked-literal", count: 1 }),
    ]);
    expect(report.items[0]).toMatchObject({
      priority: "review-first",
      category: "maintenance",
      locations: ["src/MODULE.md:12"],
    });
  });

  it("keeps opted-in literals and type-only cycles in the review queue", () => {
    const report = buildTriageReport(
      [
        input("drift.json", {
          schemaVersion: 4,
          skippedChecks: [],
          findings: [
            {
              check: "duplicate-literals",
              file: "src/a.ts:1-1",
              message: "literal repeated",
              relatedFiles: ["src/b.ts:1-1"],
            },
            {
              check: "import-cycles",
              file: "src/a.ts",
              message: "type-only cycle",
              relatedFiles: ["src/b.ts"],
              details: { typeOnly: true },
            },
          ],
        }),
      ],
      { includeLiterals: true, includeTypeOnlyCycles: true },
    );

    expect(report.summary).toMatchObject({ reviewRows: 2, reviewItems: 2, deferredRows: 0 });
    expect(report.items.map((item) => item.title)).toEqual(["type-only cycle", "literal repeated"]);
  });

  it("defers test-only constants and literals across repository test conventions", () => {
    const report = buildTriageReport(
      [
        input("drift.json", {
          schemaVersion: 4,
          skippedChecks: [],
          findings: [
            {
              check: "duplicate-constants",
              file: "packages/server/src/auth-test-helper.ts:1-2",
              message: "constant repeated",
              relatedFiles: ["packages/server/src/test/fixtures-auth.ts:3-4"],
            },
            {
              check: "duplicate-literals",
              file: "packages/client/src/__tests__/auth.ts:5-6",
              message: "literal repeated",
              relatedFiles: ["packages/client/src/test/fixtures-auth.ts:7-8"],
            },
          ],
        }),
      ],
      { includeLiterals: true },
    );

    expect(report.summary).toMatchObject({ reviewItems: 0, deferredRows: 2 });
    expect(report.deferred).toEqual([
      expect.objectContaining({ reason: "test-only-constant", count: 1 }),
      expect.objectContaining({ reason: "test-only-literal", count: 1 }),
    ]);
  });

  it("defers test-only drift clone findings", () => {
    const report = buildTriageReport([
      input("drift.json", {
        schemaVersion: 4,
        skippedChecks: [],
        findings: [
          {
            check: "duplicates",
            file: "src/a.test.ts:1-20",
            message: "exact clone in tests",
            relatedFiles: ["src/b.spec.ts:3-22"],
          },
          {
            check: "near-duplicates",
            file: "src/test/a-helper.ts:5-25",
            message: "near clone in tests",
            relatedFiles: ["src/__tests__/b-helper.ts:7-27"],
          },
        ],
      }),
    ]);

    expect(report.summary).toMatchObject({ reviewItems: 0, deferredRows: 2 });
    expect(report.deferred).toEqual([
      expect.objectContaining({ reason: "test-only-clone", count: 2 }),
    ]);
  });

  it("keeps legacy single-location test clone findings for review", () => {
    const report = buildTriageReport([
      input("legacy-drift.json", {
        schemaVersion: 4,
        skippedChecks: [],
        findings: [
          {
            check: "duplicates",
            file: "src/a.test.ts:1-20",
            message: "legacy clone without relatedFiles",
          },
        ],
      }),
    ]);

    expect(report.summary).toMatchObject({ reviewItems: 1, deferredRows: 0 });
    expect(report.items[0]).toMatchObject({
      id: "drift:legacy-drift.json:duplicates:0:src/a.test.ts:1-20",
      locations: ["src/a.test.ts:1-20"],
    });
  });

  it("keeps clone findings with one distinct test location for review", () => {
    const report = buildTriageReport([
      input("drift.json", {
        schemaVersion: 4,
        skippedChecks: [],
        findings: [
          {
            check: "duplicates",
            file: "src/a.test.ts:1-20",
            message: "clone with repeated primary location",
            relatedFiles: ["src/a.test.ts:1-20"],
          },
        ],
      }),
    ]);

    expect(report.summary).toMatchObject({ reviewItems: 1, deferredRows: 0 });
    expect(report.items[0]?.locations).toEqual(["src/a.test.ts:1-20"]);
  });

  it("does not merge non-clone findings from different input files", () => {
    const finding = { check: "comments", file: "src/a.ts" };
    const report = buildTriageReport([
      input("first.json", {
        schemaVersion: 4,
        skippedChecks: [],
        findings: [{ ...finding, message: "first report finding" }],
      }),
      input("second.json", {
        schemaVersion: 4,
        skippedChecks: [],
        findings: [{ ...finding, message: "second report finding" }],
      }),
    ]);

    expect(report.summary).toMatchObject({ reviewRows: 2, reviewItems: 2, mergedRows: 0 });
    expect(report.items.map((item) => item.title).sort()).toEqual([
      "first report finding",
      "second report finding",
    ]);
  });

  it("deduplicates a primary location repeated in relatedFiles", () => {
    const report = buildTriageReport([
      input("drift.json", {
        schemaVersion: 4,
        skippedChecks: [],
        findings: [
          {
            check: "ghost-files",
            file: "src/foo-helper.ts",
            message: "suspicious sibling pair",
            relatedFiles: ["src/foo-helper.ts", "src/foo.ts"],
          },
        ],
      }),
    ]);

    expect(report.items[0]?.locations).toEqual(["src/foo-helper.ts", "src/foo.ts"]);
  });

  it("collapses equivalent Semgrep rules and defers matches in test fixtures", () => {
    const sharedRange = [{ startLine: 8, startCol: 2, endLine: 8, endCol: 14 }];
    const report = buildTriageReport([
      input("semgrep.json", {
        kind: "advisory",
        lane: "prototype",
        subcommand: "semgrep-candidates",
        prerequisites: [],
        degradations: [],
        caps: [],
        sections: [
          {
            totalCandidates: 3,
            entries: [
              {
                rank: 1,
                candidateSource: "semgrep",
                checkId: "rules.first",
                path: "src/auth.ts",
                count: 1,
                ranges: sharedRange,
                severity: "WARNING",
                message: null,
                metadata: { cwe: ["CWE-208"] },
              },
              {
                rank: 2,
                candidateSource: "semgrep",
                checkId: "rules.second",
                path: "src/auth.ts",
                count: 1,
                ranges: sharedRange,
                severity: "WARNING",
                message: null,
                metadata: { cwe: ["CWE-208"] },
              },
              {
                rank: 3,
                candidateSource: "semgrep",
                checkId: "rules.example",
                path: "src/auth.test.ts",
                count: 1,
                ranges: sharedRange,
                severity: "WARNING",
                message: null,
                metadata: { cwe: ["CWE-208"] },
              },
            ],
          },
        ],
      }),
    ]);

    expect(report.summary).toMatchObject({
      inputRows: 3,
      reviewRows: 2,
      reviewItems: 1,
      deferredRows: 1,
      mergedRows: 1,
    });
    expect(report.items[0]?.evidence).toHaveLength(2);
    expect(report.deferred).toEqual([
      expect.objectContaining({ reason: "test-only-security-example", count: 1 }),
    ]);
  });

  it("deduplicates Semgrep locations whose ranges differ only by column", () => {
    const report = buildTriageReport([
      input("semgrep.json", {
        kind: "advisory",
        lane: "prototype",
        subcommand: "semgrep-candidates",
        prerequisites: [],
        degradations: [],
        caps: [],
        sections: [
          {
            totalCandidates: 1,
            entries: [
              {
                rank: 1,
                candidateSource: "semgrep",
                checkId: "rules.example",
                path: "src/auth.ts",
                count: 2,
                ranges: [
                  { startLine: 8, startCol: 2, endLine: 8, endCol: 14 },
                  { startLine: 8, startCol: 20, endLine: 8, endCol: 32 },
                ],
                severity: "WARNING",
                message: "two matches on one line",
                metadata: { cwe: [] },
              },
            ],
          },
        ],
      }),
    ]);

    expect(report.items[0]?.locations).toEqual(["src/auth.ts:8-8"]);
  });

  it("treats dot test-helper files as test-only evidence", () => {
    const report = buildTriageReport([
      input("semgrep.json", {
        kind: "advisory",
        lane: "prototype",
        subcommand: "semgrep-candidates",
        prerequisites: [],
        degradations: [],
        caps: [],
        sections: [
          {
            totalCandidates: 1,
            entries: [
              {
                rank: 1,
                candidateSource: "semgrep",
                checkId: "rules.example",
                path: "src/auth.test-helper.ts",
                count: 1,
                ranges: [{ startLine: 8, startCol: 2, endLine: 8, endCol: 14 }],
                severity: "WARNING",
                message: null,
                metadata: { cwe: ["CWE-208"] },
              },
            ],
          },
        ],
      }),
    ]);

    expect(report.summary).toMatchObject({ reviewItems: 0, deferredRows: 1 });
    expect(report.deferred).toEqual([
      expect.objectContaining({ reason: "test-only-security-example", count: 1 }),
    ]);
  });

  it("defers security examples and clones in repository test-support directories", () => {
    const testSupportPaths = [
      "e2e/helpers/api.ts",
      "scripts/fixtures/x.ts",
      "scripts/test-support/x.ts",
      "examples/lint-ratchet-demo/x.ts",
    ];
    const report = buildTriageReport([
      input("drift.json", {
        schemaVersion: 4,
        skippedChecks: [],
        findings: testSupportPaths.map((path) => ({
          check: "duplicates",
          file: `${path}:1-20`,
          message: "deliberate test-support clone",
          relatedFiles: [`${path.replace(/\.ts$/u, "-copy.ts")}:21-40`],
        })),
      }),
      input("semgrep.json", {
        kind: "advisory",
        lane: "prototype",
        subcommand: "semgrep-candidates",
        prerequisites: [],
        degradations: [],
        caps: [],
        sections: [
          {
            totalCandidates: testSupportPaths.length,
            entries: testSupportPaths.map((path, index) => ({
              rank: index + 1,
              candidateSource: "semgrep",
              checkId: "rules.example",
              path,
              count: 1,
              ranges: [{ startLine: 8, startCol: 2, endLine: 8, endCol: 14 }],
              severity: "WARNING",
              message: null,
              metadata: { cwe: ["CWE-208"] },
            })),
          },
        ],
      }),
    ]);

    expect(report.summary).toMatchObject({ reviewItems: 0, deferredRows: 8 });
    expect(report.deferred).toEqual([
      expect.objectContaining({ reason: "test-only-clone", count: 4 }),
      expect.objectContaining({ reason: "test-only-security-example", count: 4 }),
    ]);
  });

  it("marks advisories with unmet prerequisites as partial", () => {
    const report = buildTriageReport([
      input("semgrep.json", {
        kind: "advisory",
        lane: "prototype",
        subcommand: "semgrep-candidates",
        prerequisites: [
          {
            name: "semgrep engine",
            satisfied: false,
            detail: "semgrep was not available on PATH",
          },
        ],
        degradations: [],
        caps: [],
        sections: [{ totalCandidates: 0, entries: [] }],
      }),
    ]);

    expect(report.inputs[0]).toMatchObject({
      partial: true,
      unmetPrerequisites: [{ name: "semgrep engine", detail: "semgrep was not available on PATH" }],
    });
  });

  it("marks drift reports with skipped checks as partial and retains their reasons", () => {
    const report = buildTriageReport([
      input("drift.json", {
        schemaVersion: 4,
        skippedChecks: [
          {
            check: "duplicates",
            reason: "jscpd was not installed",
            code: "tool-not-installed",
          },
          { check: "near-duplicates", reason: "ts-morph timed out" },
        ],
        findings: [],
      }),
    ]);

    expect(report.inputs[0]).toMatchObject({
      partial: true,
      skippedChecks: [
        {
          check: "duplicates",
          reason: "jscpd was not installed",
          code: "tool-not-installed",
        },
        { check: "near-duplicates", reason: "ts-morph timed out" },
      ],
    });
  });

  it("retains drift scan coverage and marks restricted scans as partial", () => {
    const report = buildTriageReport([
      input("drift.json", {
        schemaVersion: 4,
        scopeMode: "changed",
        roots: ["packages/server/src"],
        enabledChecks: ["duplicates"],
        skippedChecks: [],
        findings: [],
      }),
    ]);

    expect(report.inputs[0]).toMatchObject({
      partial: true,
      scopeMode: "changed",
      roots: ["packages/server/src"],
      enabledChecks: ["duplicates"],
    });
  });

  it("marks a current full-scope default-check scan as complete", () => {
    const report = buildTriageReport([
      input("drift.json", {
        schemaVersion: 4,
        scopeMode: "current",
        roots: ["."],
        enabledChecks: DEFAULT_CHECKS,
        skippedChecks: [],
        findings: [],
      }),
    ]);

    expect(report.inputs[0]).toMatchObject({
      partial: false,
      scopeMode: "current",
      roots: ["."],
      enabledChecks: DEFAULT_CHECKS,
    });
  });

  it("retains hit-cap details and degradation reasons in advisory summaries", () => {
    const report = buildTriageReport([
      input("dolos.json", {
        kind: "advisory",
        lane: "prototype",
        subcommand: "dolos-candidates",
        prerequisites: [],
        degradations: ["Dolos timed out before returning candidates"],
        caps: [
          { label: "reported pairs", limit: 1000, hit: true, detail: "stopped at 1000 pairs" },
          { label: "files", limit: 500, hit: false, detail: null },
        ],
        sections: [{ totalCandidates: 0, entries: [] }],
      }),
    ]);

    expect(report.inputs[0]).toMatchObject({
      partial: true,
      hitCaps: [{ label: "reported pairs", detail: "stopped at 1000 pairs" }],
      degradations: ["Dolos timed out before returning candidates"],
    });
  });

  it("merges clone evidence by file pair and applies the fragment floor", () => {
    const report = buildTriageReport(
      [
        input("drift.json", {
          schemaVersion: 4,
          skippedChecks: [],
          findings: [
            {
              check: "duplicates",
              file: "src/a.ts:10-40",
              message: "near duplicate",
              hint: "compare it",
              relatedFiles: ["src/b.ts:20-50"],
              details: { similarity: 0.95 },
            },
          ],
        }),
        input("dolos.json", {
          kind: "advisory",
          lane: "prototype",
          subcommand: "dolos-candidates",
          prerequisites: [],
          degradations: [],
          caps: [{ label: "reported pairs", limit: 1000, hit: true, detail: "partial" }],
          sections: [
            {
              totalCandidates: 4,
              entries: [
                {
                  rank: 1,
                  candidateSource: "dolos",
                  score: 0.99,
                  left: { filePath: "src/b.ts", startLine: 1, endLine: 80, lineCount: 80 },
                  right: { filePath: "src/a.ts", startLine: 1, endLine: 70, lineCount: 70 },
                  metrics: { similarity: 0.99, totalOverlap: 60, longestFragment: 40 },
                },
                {
                  rank: 2,
                  candidateSource: "dolos",
                  score: 0.9,
                  left: { filePath: "src/c.ts", startLine: 1, endLine: 20, lineCount: 20 },
                  right: { filePath: "src/d.ts", startLine: 1, endLine: 20, lineCount: 20 },
                  metrics: { similarity: 0.9, totalOverlap: 10, longestFragment: 8 },
                },
                {
                  rank: 3,
                  candidateSource: "dolos",
                  score: 1,
                  left: {
                    filePath: "src/e.test.ts",
                    startLine: 1,
                    endLine: 20,
                    lineCount: 20,
                  },
                  right: {
                    filePath: "src/f.test.ts",
                    startLine: 1,
                    endLine: 20,
                    lineCount: 20,
                  },
                  metrics: { similarity: 1, totalOverlap: 30, longestFragment: 30 },
                },
              ],
            },
          ],
        }),
      ],
      { minCloneFragment: 20 },
    );

    expect(report.summary).toMatchObject({
      inputRows: 4,
      reviewRows: 2,
      reviewItems: 1,
      deferredRows: 2,
      mergedRows: 1,
      unshownRows: 1,
    });
    expect(report.items[0]?.evidence.map((evidence) => evidence.source)).toEqual([
      "drift:duplicates",
      "dolos",
    ]);
    expect(report.items[0]?.locations).toEqual([
      "src/a.ts:10-40",
      "src/b.ts:20-50",
      "src/b.ts:1-80",
      "src/a.ts:1-70",
    ]);
    expect(report.deferred).toEqual([
      expect.objectContaining({ reason: "short-clone-fragment", count: 1 }),
      expect.objectContaining({ reason: "test-only-clone", count: 1 }),
    ]);
    expect(report.inputs[1]).toMatchObject({ partial: true, unshownRows: 1 });
  });

  it("prefers drift titles and retains drift messages when Dolos is processed first", () => {
    const report = buildTriageReport([
      input("dolos.json", {
        kind: "advisory",
        lane: "prototype",
        subcommand: "dolos-candidates",
        prerequisites: [],
        degradations: [],
        caps: [],
        sections: [
          {
            totalCandidates: 1,
            entries: [
              {
                rank: 1,
                candidateSource: "dolos",
                score: 0.99,
                left: { filePath: "src/a.ts", startLine: 1, endLine: 70, lineCount: 70 },
                right: { filePath: "src/b.ts", startLine: 1, endLine: 80, lineCount: 80 },
                metrics: { similarity: 0.99, totalOverlap: 60, longestFragment: 40 },
              },
            ],
          },
        ],
      }),
      input("drift.json", {
        schemaVersion: 4,
        skippedChecks: [],
        findings: [
          {
            check: "duplicates",
            file: "src/a.ts:10-40",
            message: "exact duplicate implementation",
            hint: "extract the shared implementation",
            relatedFiles: ["src/b.ts:20-50"],
          },
        ],
      }),
    ]);

    expect(report.items[0]).toMatchObject({
      title: "exact duplicate implementation",
      evidence: [
        expect.objectContaining({ source: "dolos" }),
        expect.objectContaining({
          source: "drift:duplicates",
          message: "exact duplicate implementation",
          detail: "extract the shared implementation",
        }),
      ],
    });
  });

  it("intentionally merges cross-file clone rows by file pair across differing ranges", () => {
    const dolosRow = (
      rank: number,
      left: { readonly filePath: string; readonly startLine: number; readonly endLine: number },
      right: { readonly filePath: string; readonly startLine: number; readonly endLine: number },
    ): DolosRowInput => ({
      rank,
      candidateSource: "dolos",
      score: 0.95,
      left: { ...left, lineCount: left.endLine - left.startLine + 1 },
      right: { ...right, lineCount: right.endLine - right.startLine + 1 },
      metrics: { similarity: 0.95, totalOverlap: 40, longestFragment: 20 },
    });
    const dolosInput = (entries: readonly unknown[]): NamedTriageInput =>
      input("dolos.json", {
        kind: "advisory",
        lane: "prototype",
        subcommand: "dolos-candidates",
        prerequisites: [],
        degradations: [],
        caps: [],
        sections: [{ totalCandidates: entries.length, entries }],
      });
    const mixedReport = buildTriageReport([
      input("drift.json", {
        schemaVersion: 4,
        skippedChecks: [],
        findings: [
          {
            check: "duplicates",
            file: "src/a.ts:10-20",
            message: "cross-file duplicate",
            relatedFiles: ["src/b.ts:30-40"],
          },
        ],
      }),
      dolosInput([
        dolosRow(
          1,
          { filePath: "src/b.ts", startLine: 50, endLine: 69 },
          { filePath: "src/a.ts", startLine: 70, endLine: 89 },
        ),
      ]),
    ]);
    const dolosOnlyReport = buildTriageReport([
      dolosInput([
        dolosRow(
          1,
          { filePath: "src/a.ts", startLine: 1, endLine: 20 },
          { filePath: "src/b.ts", startLine: 21, endLine: 40 },
        ),
        dolosRow(
          2,
          { filePath: "src/b.ts", startLine: 50, endLine: 69 },
          { filePath: "src/a.ts", startLine: 70, endLine: 89 },
        ),
      ]),
    ]);

    // Documented design: drift:triage usage merges cross-file clones by file pair, not range.
    expect(mixedReport.summary).toMatchObject({ reviewRows: 2, reviewItems: 1, mergedRows: 1 });
    expect(mixedReport.items[0]).toMatchObject({
      id: "pair:src/a.ts<=>src/b.ts",
      locations: ["src/a.ts:10-20", "src/b.ts:30-40", "src/b.ts:50-69", "src/a.ts:70-89"],
      evidence: [
        expect.objectContaining({ source: "drift:duplicates" }),
        expect.objectContaining({ source: "dolos" }),
      ],
    });
    expect(dolosOnlyReport.summary).toMatchObject({
      reviewRows: 2,
      reviewItems: 1,
      mergedRows: 1,
    });
    expect(dolosOnlyReport.items[0]).toMatchObject({
      id: "pair:src/a.ts<=>src/b.ts",
      locations: ["src/a.ts:1-20", "src/b.ts:21-40", "src/b.ts:50-69", "src/a.ts:70-89"],
      evidence: [
        expect.objectContaining({ source: "dolos", row: 1 }),
        expect.objectContaining({ source: "dolos", row: 2 }),
      ],
    });
  });

  it("keeps same-file drift fragments separate from whole-file Dolos evidence", () => {
    const report = buildTriageReport([
      input("drift.json", {
        schemaVersion: 4,
        skippedChecks: [],
        findings: [
          {
            check: "duplicates",
            file: "src/a.ts:10-20",
            message: "first internal duplicate",
            relatedFiles: ["src/a.ts:40-50"],
          },
          {
            check: "duplicates",
            file: "src/a.ts:60-70",
            message: "second internal duplicate",
            relatedFiles: ["src/a.ts:90-100"],
          },
        ],
      }),
      input("dolos.json", {
        kind: "advisory",
        lane: "prototype",
        subcommand: "dolos-candidates",
        prerequisites: [],
        degradations: [],
        caps: [],
        sections: [
          {
            totalCandidates: 1,
            entries: [
              {
                rank: 1,
                candidateSource: "dolos",
                score: 1,
                left: { filePath: "src/a.ts", startLine: 1, endLine: 100, lineCount: 100 },
                right: { filePath: "src/a.ts", startLine: 1, endLine: 100, lineCount: 100 },
                metrics: { similarity: 1, totalOverlap: 22, longestFragment: 22 },
              },
            ],
          },
        ],
      }),
    ]);

    expect(report.summary).toMatchObject({ reviewRows: 3, reviewItems: 3, mergedRows: 0 });
    expect(report.items.map((item) => item.locations)).toEqual([
      ["src/a.ts:10-20", "src/a.ts:40-50"],
      ["src/a.ts:60-70", "src/a.ts:90-100"],
      ["src/a.ts:1-100"],
    ]);
    expect(report.items.map((item) => item.evidence)).toEqual([
      [expect.objectContaining({ source: "drift:duplicates" })],
      [expect.objectContaining({ source: "drift:duplicates" })],
      [expect.objectContaining({ source: "dolos" })],
    ]);
  });
});

describe("parseTriageInput", () => {
  it("rejects Semgrep advisory rows with no ranges", () => {
    expect(() =>
      parseTriageInput({
        kind: "advisory",
        lane: "prototype",
        subcommand: "semgrep-candidates",
        prerequisites: [],
        degradations: [],
        caps: [],
        sections: [
          {
            totalCandidates: 1,
            entries: [
              {
                rank: 1,
                candidateSource: "semgrep",
                checkId: "rules.example",
                path: "src/auth.ts",
                count: 0,
                ranges: [],
                severity: "WARNING",
                message: "locationless match",
                metadata: { cwe: [] },
              },
            ],
          },
        ],
      }),
    ).toThrow(/malformed semgrep-candidates row at section 0 index 0/u);
  });

  it("identifies malformed Semgrep advisory rows by section and index", () => {
    expect(() =>
      parseTriageInput({
        kind: "advisory",
        lane: "prototype",
        subcommand: "semgrep-candidates",
        prerequisites: [],
        degradations: [],
        caps: [],
        sections: [
          {
            totalCandidates: 1,
            entries: [
              {
                rank: 1,
                candidateSource: "semgrep",
                checkId: "rules.example",
                path: "src/auth.ts",
                count: 1,
                ranges: [{ startLine: 8, startCol: 2, endLine: 8, endCol: 14 }],
                severity: "WARNING",
                metadata: { cwe: [] },
              },
            ],
          },
        ],
      }),
    ).toThrow(/malformed semgrep-candidates row at section 0 index 0/u);
  });

  it.each([-1, 0, 1.5])(
    "rejects contradictory Semgrep totalCandidates value %s",
    (totalCandidates) => {
      expect(() =>
        parseTriageInput({
          kind: "advisory",
          lane: "prototype",
          subcommand: "semgrep-candidates",
          prerequisites: [],
          degradations: [],
          caps: [],
          sections: [
            {
              totalCandidates,
              entries: [
                {
                  rank: 1,
                  candidateSource: "semgrep",
                  checkId: "rules.example",
                  path: "src/auth.ts",
                  count: 1,
                  ranges: [{ startLine: 8, startCol: 2, endLine: 8, endCol: 14 }],
                  severity: "WARNING",
                  message: null,
                  metadata: { cwe: [] },
                },
              ],
            },
          ],
        }),
      ).toThrow(/malformed semgrep-candidates section at index 0/u);
    },
  );

  it("rejects drift reports that omit skippedChecks", () => {
    expect(() => parseTriageInput({ schemaVersion: 4, findings: [] })).toThrow(
      /malformed skippedChecks/u,
    );
  });

  it("identifies malformed drift finding and skipped-check entries", () => {
    expect(() =>
      parseTriageInput({
        schemaVersion: 4,
        skippedChecks: [],
        findings: [{ check: "comments", file: "src/a.ts" }],
      }),
    ).toThrow(/malformed finding at index 0/u);
    expect(() =>
      parseTriageInput({
        schemaVersion: 4,
        skippedChecks: [{ check: "duplicates" }],
        findings: [],
      }),
    ).toThrow(/malformed skippedChecks entry at index 0/u);
    expect(() =>
      parseTriageInput({
        schemaVersion: 4,
        skippedChecks: [{ check: "duplicates", reason: "unavailable", code: 42 }],
        findings: [],
      }),
    ).toThrow(/malformed skippedChecks entry at index 0/u);
  });

  it("rejects unsupported drift schema versions with a clear message", () => {
    expect(() => parseTriageInput({ schemaVersion: 5, findings: [] })).toThrow(
      /unsupported drift schemaVersion 5; expected 4/u,
    );
  });

  it("rejects drift finding chunks instead of treating them as complete reports", () => {
    expect(() =>
      parseTriageInput({
        schemaVersion: 4,
        chunkIndex: 0,
        totalFindings: 12,
        findings: [],
      }),
    ).toThrow(/drift finding chunks are not supported/u);
  });

  it("rejects unsupported JSON contracts", () => {
    expect(() => parseTriageInput({ findings: [] })).toThrow(/supported drift report/u);
  });
});

describe("isTestLocation", () => {
  it.each([
    "test/auth-helper.ts",
    "tests/auth-helper.ts:4-8",
    "__tests__/auth-helper.ts",
    "packages/server/tests/auth-helper.ts",
  ])("recognizes test directory path %s", (path) => {
    expect(isTestLocation(path)).toBe(true);
  });

  it.each(["src/e2e-utils.ts", "src/fixtures.ts"])(
    "does not treat lookalike path %s as a test location",
    (path) => {
      expect(isTestLocation(path)).toBe(false);
    },
  );
});
