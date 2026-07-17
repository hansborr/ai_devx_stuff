import { describe, expect, it } from "vitest";

import { buildTriageReport, type NamedTriageInput, parseTriageInput } from "./triage-report.js";
import { parseOptionalScanProvenance } from "./triage-report-provenance.js";

function input(path: string, value: unknown): NamedTriageInput {
  return { path, input: parseTriageInput(value) };
}

describe("swarm-ready triage items", () => {
  it("loads legacy scan provenance and preserves the optional v2 fingerprint", () => {
    expect(parseOptionalScanProvenance({ gitHead: "legacy-head", gitDirty: true })).toEqual({
      gitHead: "legacy-head",
      gitDirty: true,
    });
    expect(
      parseOptionalScanProvenance({
        gitHead: "v2-head",
        gitDirty: true,
        stateFingerprint: "0123456789abcdef",
      }),
    ).toEqual({
      gitHead: "v2-head",
      gitDirty: true,
      stateFingerprint: "0123456789abcdef",
    });
  });

  it("preserves structured Semgrep columns alongside display locations", () => {
    const report = buildTriageReport([
      input("semgrep.json", {
        kind: "advisory",
        lane: "prototype",
        subcommand: "semgrep-candidates",
        scanProvenance: { gitHead: "scan-head", gitDirty: false },
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
                checkId: "rules.regex",
                path: "src/query.ts",
                count: 1,
                ranges: [{ startLine: 42, startCol: 10, endLine: 42, endCol: 56 }],
                severity: "WARNING",
                message: null,
                metadata: { cwe: ["CWE-185"] },
              },
            ],
          },
        ],
      }),
    ]);

    expect(report.items[0]).toMatchObject({
      locations: ["src/query.ts:42-42"],
      locationDetails: [
        {
          path: "src/query.ts",
          startLine: 42,
          startCol: 10,
          endLine: 42,
          endCol: 56,
        },
      ],
    });
    expect(report.inputs[0]?.scanProvenance).toEqual({
      gitHead: "scan-head",
      gitDirty: false,
    });
  });

  it("parses drift and Dolos ranges into structured locations", () => {
    const report = buildTriageReport([
      input("drift.json", {
        schemaVersion: 4,
        skippedChecks: [],
        findings: [
          {
            check: "comments",
            file: "src/commented.ts:12:4",
            message: "comment-heavy file",
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
                score: 0.8,
                left: { filePath: "src/a.ts", startLine: 3, endLine: 30, lineCount: 40 },
                right: { filePath: "src/b.ts", startLine: 5, endLine: 32, lineCount: 50 },
                metrics: { similarity: 0.8, totalOverlap: 28, longestFragment: 28 },
              },
            ],
          },
        ],
      }),
    ]);

    expect(report.items.flatMap((item) => item.locationDetails)).toEqual(
      expect.arrayContaining([
        { path: "src/commented.ts", startLine: 12, startCol: 4, endLine: 12, endCol: 4 },
        { path: "src/a.ts", startLine: 3, startCol: null, endLine: 30, endCol: null },
        { path: "src/b.ts", startLine: 5, startCol: null, endLine: 32, endCol: null },
      ]),
    );
  });

  it("reserves review-first for strong Semgrep metadata", () => {
    const semgrepRow = {
      candidateSource: "semgrep",
      path: "src/auth.ts",
      count: 1,
      ranges: [{ startLine: 8, startCol: 2, endLine: 8, endCol: 14 }],
      message: null,
      metadata: { cwe: ["CWE-208"] },
    } as const;
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
              { ...semgrepRow, rank: 1, checkId: "rules.warning", severity: "WARNING" },
              {
                ...semgrepRow,
                rank: 2,
                checkId: "rules.error",
                severity: "ERROR",
                ranges: [{ startLine: 9, startCol: 2, endLine: 9, endCol: 14 }],
              },
            ],
          },
        ],
      }),
    ]);

    expect(report.items.map((item) => [item.evidence[0]?.row, item.priority])).toEqual([
      [2, "review-first"],
      [1, "review"],
    ]);
  });

  it("defers test-only duplicate type and schema shapes", () => {
    const report = buildTriageReport([
      input("drift.json", {
        schemaVersion: 4,
        skippedChecks: [],
        findings: [
          {
            check: "duplicate-types",
            file: "src/a.test.ts:1-5",
            relatedFiles: ["src/b.test.ts:2-6"],
            message: "duplicate type shape",
          },
          {
            check: "duplicate-schemas",
            file: "src/test/a.ts:1-5",
            relatedFiles: ["src/__tests__/b.ts:2-6"],
            message: "duplicate schema shape",
          },
        ],
      }),
    ]);

    expect(report.summary).toMatchObject({ reviewItems: 0, deferredRows: 2 });
    expect(report.deferred).toEqual([
      expect.objectContaining({ reason: "test-only-structure", count: 2 }),
    ]);
  });
});

describe("swarm-ready completeness disclosure", () => {
  it("separates an expected current-scope skip from a partial scan", () => {
    const report = buildTriageReport([
      input("drift.json", {
        schemaVersion: 4,
        scopeMode: "current",
        roots: ["."],
        enabledChecks: ["duplicates", "ghost-files", "comments", "suppressions"],
        skippedChecks: [
          {
            check: "suppressions",
            reason: "only available in changed scope",
            code: "scope-inapplicable",
          },
        ],
        findings: [],
      }),
    ]);

    expect(report.inputs[0]).toMatchObject({
      completeness: "complete-with-inapplicable-checks",
      partial: false,
      inapplicableChecks: [expect.objectContaining({ check: "suppressions" })],
      skippedChecks: [],
    });
  });

  it("marks a processing cap as an unknown tail, not display truncation", () => {
    const report = buildTriageReport([
      input("dolos.json", {
        kind: "advisory",
        lane: "prototype",
        subcommand: "dolos-candidates",
        prerequisites: [],
        degradations: [],
        caps: [
          {
            label: "reported pairs",
            limit: 500,
            hit: true,
            detail: "stopped after 500 reported candidate pairs",
          },
        ],
        sections: [{ totalCandidates: 0, entries: [] }],
      }),
    ]);

    expect(report.summary).toMatchObject({ unshownRows: 0, inputsWithUnknownTail: 1 });
    expect(report.inputs[0]).toMatchObject({
      completeness: "partial",
      unknownBeyondCaps: true,
      unshownRows: 0,
    });
  });
});
