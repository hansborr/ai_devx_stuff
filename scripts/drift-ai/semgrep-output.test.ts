import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseSemgrepScanOutput, parseSemgrepVersionOutput } from "./semgrep-output.js";

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "semgrep");

function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURE_DIR, name), "utf8");
}

describe("parseSemgrepVersionOutput", () => {
  it("parses the bare version line semgrep --version prints", () => {
    expect(parseSemgrepVersionOutput("1.165.0\n")).toBe("1.165.0");
  });

  it("parses a version from a labeled line and skips noise", () => {
    expect(parseSemgrepVersionOutput("warning: metrics\nsemgrep 1.165.0\n")).toBe("1.165.0");
  });

  it("returns undefined when no version is present", () => {
    expect(parseSemgrepVersionOutput("command not found\n")).toBeUndefined();
  });
});

describe("parseSemgrepScanOutput", () => {
  it("parses the real logged-out capture without depending on redacted fields", () => {
    const fixture = readFixture("scan-output.logged-out.json");
    const parsed = parseSemgrepScanOutput(fixture);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.scan.engineVersion).toBe("1.165.0");
    expect(parsed.scan.findings).toHaveLength(4);
    expect(parsed.scan.findings[0]).toEqual({
      // The capture's namespaced id (rule config path stem prefix) is preserved
      // verbatim; nothing assumes bare rule ids.
      checkId: "tmp.smoke-empty-catch",
      path: "scripts/drift-ai/dolos-runner.ts",
      startLine: 235,
      startCol: 5,
      endLine: 240,
      endCol: 6,
      message: "Empty catch block swallows errors",
      severity: "WARNING",
      metadata: {
        confidence: "HIGH",
        likelihood: null,
        impact: null,
        category: "correctness",
        subcategory: [],
        cwe: [],
        owasp: [],
        references: [],
      },
    });
    expect(parsed.scan.errors).toEqual([]);
    expect(parsed.scan.skippedRules).toEqual([]);
    expect(parsed.scan.malformedResultCount).toBe(0);
    const raw: unknown = JSON.parse(fixture);
    const scannedPaths = (raw as { paths: { scanned: string[] } }).paths.scanned; // test boundary
    expect(parsed.scan.scannedCount).toBe(scannedPaths.length);
    // Logged-out CE redacts extra.lines / extra.fingerprint to "requires login";
    // the snippet policy means neither field may surface in parsed output.
    expect(JSON.stringify(parsed)).not.toContain("requires login");
  });

  it("parses rich metadata, scan errors, and skipped rules from the synthetic fixture", () => {
    const parsed = parseSemgrepScanOutput(readFixture("scan-output.synthetic-rich.json"));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.scan.findings[0]).toMatchObject({
      checkId: "rules.hardcoded-secret",
      path: "src/server/auth.go",
      severity: "ERROR",
      metadata: {
        confidence: "MEDIUM",
        likelihood: "HIGH",
        impact: "MEDIUM",
        category: "security",
        subcategory: ["audit"],
        cwe: ["CWE-798: Use of Hard-coded Credentials"],
        owasp: ["A07:2021 - Identification and Authentication Failures"],
        references: ["https://example.invalid/rule-docs"],
      },
    });
    // Scalar metadata shapes (string cwe/owasp/subcategory) normalize to lists.
    expect(parsed.scan.findings[1]?.metadata).toMatchObject({
      subcategory: ["audit"],
      cwe: ["CWE-477"],
      owasp: ["A1:2017 misc"],
    });
    expect(parsed.scan.errors).toEqual([
      {
        message: "Syntax error at line src/broken.ts:10",
        level: "warn",
        type: "PartialParsing",
        path: "src/broken.ts",
      },
    ]);
    expect(parsed.scan.skippedRules).toEqual(["rules.invalid-pattern"]);
    expect(parsed.scan.scannedCount).toBe(2);
  });

  it("counts malformed result rows instead of failing or silently dropping them", () => {
    const parsed = parseSemgrepScanOutput(
      JSON.stringify({
        version: "1.165.0",
        results: [{ check_id: "rules.no-path" }],
        errors: [],
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.scan.findings).toEqual([]);
    expect(parsed.scan.malformedResultCount).toBe(1);
  });

  it("counts a zero line number as malformed instead of inventing a line-0 row", () => {
    // Semgrep positions are one-based; a 0 here is a malformed row, not line 0.
    const parsed = parseSemgrepScanOutput(
      JSON.stringify({
        version: "1.165.0",
        results: [
          {
            check_id: "rules.zero-line",
            path: "src/a.ts",
            start: { line: 0, col: 1 },
            end: { line: 0, col: 2 },
            extra: { message: "zero" },
          },
        ],
        errors: [],
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.scan.findings).toEqual([]);
    expect(parsed.scan.malformedResultCount).toBe(1);
  });

  it("rejects invalid JSON as a degraded parse", () => {
    const parsed = parseSemgrepScanOutput("not json {");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/not valid JSON/u);
  });

  it("rejects a non-object document", () => {
    expect(parseSemgrepScanOutput("[]")).toMatchObject({ ok: false });
  });

  it("rejects a document without a results array", () => {
    const parsed = parseSemgrepScanOutput(JSON.stringify({ version: "1.165.0", errors: [] }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/results/u);
  });
});
