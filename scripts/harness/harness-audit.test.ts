import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { harnessDiagnosticsSchema } from "@musi/harness-diagnostics/schema.js";
import { describe, expect, it } from "vitest";

import {
  buildAuditReport,
  formatJson,
  formatText,
  type HarnessAuditReport,
  loadEnvelopes,
  parseArgs,
  runHarnessAudit,
} from "../harness-audit.js";
import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";

const fixtureDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "harness-audit",
  "fixtures",
);

function fixturePath(name: string): string {
  return path.join(fixtureDir, name);
}

// Real producer envelopes (lint:ratchet, logs:audit) plus drift:ai projections,
// shaped exactly as their producers emit them. The schema guard below keeps them
// honest so the consumer is exercised against valid envelopes only.
const LINT_RATCHET_CLEAN = "lint-ratchet-clean.json";
const LINT_RATCHET_FINDINGS = "lint-ratchet-findings.json";
const LOGS_AUDIT_FINDINGS = "logs-audit-findings.json";
const DRIFT_AI_SKIPPED = "drift-ai-skipped.json";
const DRIFT_AI_FINDINGS = "drift-ai-findings.json";
const MALFORMED_NOT_JSON = "malformed-not-json.txt";

const tmpRepo = registerTempRootCleanup();

function makeTempRoot(): string {
  const root = tmpRepo.makeTempRepo("harness-audit-");
  return root;
}

describe("parseArgs", () => {
  it("accepts positional inputs, format, and output", () => {
    expect(parseArgs(["a.json", "b.json", "--format=json", "--output", "out.txt"])).toEqual({
      inputs: ["a.json", "b.json"],
      format: "json",
      output: "out.txt",
    });
  });

  it("defaults to text format and no output", () => {
    expect(parseArgs(["only.json"])).toEqual({
      inputs: ["only.json"],
      format: "text",
      output: undefined,
    });
  });

  it("preserves empty string argv entries as positional envelope files", () => {
    expect(parseArgs([""])).toEqual({
      inputs: [""],
      format: "text",
      output: undefined,
    });
  });

  it("rejects missing inputs, bad format, missing values, and unknown flags", () => {
    expect(() => parseArgs([])).toThrow(/requires at least one envelope file/u);
    expect(() => parseArgs(["--format", "yaml"])).toThrow(/--format requires text or json/u);
    expect(() => parseArgs(["--format", "--output", "out.txt"])).toThrow(
      /--format requires a value/u,
    );
    expect(() => parseArgs(["--format=--output", "out.txt"])).toThrow(/--format requires a value/u);
    expect(() => parseArgs(["--format="])).toThrow(/--format requires a value/u);
    expect(() => parseArgs(["--output"])).toThrow(/--output requires a value/u);
    expect(() => parseArgs(["--output", "--format", "json"])).toThrow(/--output requires a value/u);
    expect(() => parseArgs(["--output=--format", "input.json"])).toThrow(
      /--output requires a value/u,
    );
    expect(() => parseArgs(["--output="])).toThrow(/--output requires a value/u);
    expect(() => parseArgs(["--unknown", "x.json"])).toThrow(/Unknown argument/u);
  });
});

describe("on-disk fixtures", () => {
  it("are all valid HarnessDiagnostics envelopes", () => {
    for (const name of [
      LINT_RATCHET_CLEAN,
      LINT_RATCHET_FINDINGS,
      LOGS_AUDIT_FINDINGS,
      DRIFT_AI_SKIPPED,
      DRIFT_AI_FINDINGS,
    ]) {
      const parsed: unknown = JSON.parse(readFileSync(fixturePath(name), "utf8"));
      expect(harnessDiagnosticsSchema.safeParse(parsed).success).toBe(true);
    }
  });
});

describe("loadEnvelopes", () => {
  it("loads valid envelope files and records no failures", () => {
    const { envelopes, failures } = loadEnvelopes([
      fixturePath(LINT_RATCHET_FINDINGS),
      fixturePath(LOGS_AUDIT_FINDINGS),
    ]);
    expect(failures).toEqual([]);
    expect(envelopes.map((entry) => entry.envelope.tool)).toEqual(["lint:ratchet", "logs:audit"]);
  });

  it("records an unreadable file as a failure without throwing", () => {
    const { envelopes, failures } = loadEnvelopes(["missing.json"], () => {
      throw new Error("ENOENT: no such file");
    });
    expect(envelopes).toEqual([]);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.path).toBe("missing.json");
    expect(failures[0]?.reason).toContain("could not read envelope file");
  });

  it("records invalid JSON as a failure", () => {
    const { failures } = loadEnvelopes(["bad.json"], () => "not json at all");
    expect(failures[0]?.reason).toContain("not valid JSON");
  });

  it("records a schema-valid-JSON-but-wrong-shape envelope as a failure", () => {
    const { failures } = loadEnvelopes(["wrong.json"], () =>
      JSON.stringify({
        version: "1",
        tool: "drift:ai",
        findings: [],
        summary: { blocking: 9, warning: 0, info: 0, byControl: {} },
      }),
    );
    expect(failures[0]?.reason).toContain("failed harnessDiagnosticsSchema");
  });

  it("partially loads: keeps valid envelopes and isolates the malformed one", () => {
    const { envelopes, failures } = loadEnvelopes([
      fixturePath(DRIFT_AI_FINDINGS),
      fixturePath(MALFORMED_NOT_JSON),
    ]);
    expect(envelopes.map((entry) => entry.envelope.tool)).toEqual(["drift:ai"]);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.path).toContain(MALFORMED_NOT_JSON);
  });
});

describe("buildAuditReport", () => {
  function loadReport(names: readonly string[]): HarnessAuditReport {
    const { envelopes, failures } = loadEnvelopes(names.map(fixturePath));
    return buildAuditReport(envelopes, failures);
  }

  it("groups findings by tool with per-control severity counts and totals", () => {
    const report = loadReport([LINT_RATCHET_FINDINGS, LOGS_AUDIT_FINDINGS, DRIFT_AI_FINDINGS]);

    expect(report.tools.map((tool) => tool.tool)).toEqual([
      "drift:ai",
      "lint:ratchet",
      "logs:audit",
    ]);
    expect(report.totals).toEqual({
      envelopes: 3,
      tools: 3,
      blocking: 4,
      warning: 2,
      info: 0,
      total: 6,
    });

    const drift = report.tools.find((tool) => tool.tool === "drift:ai");
    expect(drift?.warning).toBe(2);
    expect(drift?.controls).toEqual([
      { control: "check/drift-ai-orphan-files", blocking: 0, warning: 1, info: 0, total: 1 },
      { control: "drift-scope/current", blocking: 0, warning: 1, info: 0, total: 1 },
    ]);
  });

  it("merges multiple envelopes that share a tool id into one group", () => {
    const report = loadReport([DRIFT_AI_FINDINGS, DRIFT_AI_SKIPPED]);
    expect(report.tools).toHaveLength(1);
    const drift = report.tools[0];
    expect(drift?.tool).toBe("drift:ai");
    expect(drift?.envelopes).toBe(2);
    expect(drift?.sources).toHaveLength(2);
    // findings (warn) and skipped checks (info) are distinguished within the tool
    expect(drift?.warning).toBe(2);
    expect(drift?.info).toBe(1);
    // Totals fold info into the sum: blocking 0 + warning 2 + info 1 = 3. This
    // pins the `+ counts.info` term in totalOf; a `- counts.info` mutant yields 1.
    expect(drift?.blocking).toBe(0);
    expect(drift?.total).toBe(3);
    expect(report.totals.total).toBe(3);
    // The shared control collects the warn (findings) and info (skipped) rows,
    // so its per-control total must also count the info row: 1 warning + 1 info.
    const sharedControl = drift?.controls.find(
      (control) => control.control === "drift-scope/current",
    );
    expect(sharedControl).toEqual({
      control: "drift-scope/current",
      blocking: 0,
      warning: 1,
      info: 1,
      total: 2,
    });
  });

  it("treats a clean envelope as zero findings, not a missing tool", () => {
    const report = loadReport([LINT_RATCHET_CLEAN]);
    expect(report.tools).toHaveLength(1);
    expect(report.tools[0]?.total).toBe(0);
    expect(report.totals.total).toBe(0);
  });
});

describe("formatText", () => {
  function textFor(names: readonly string[]): string {
    const { envelopes, failures } = loadEnvelopes(names.map(fixturePath));
    return formatText(buildAuditReport(envelopes, failures));
  }

  it("renders tool groups, per-control counts, and the report-only footer", () => {
    const text = textFor([LINT_RATCHET_FINDINGS, LOGS_AUDIT_FINDINGS, DRIFT_AI_SKIPPED]);
    expect(text).toContain("lint:ratchet");
    expect(text).toContain("logs:audit");
    expect(text).toContain("drift:ai");
    expect(text).toContain("lint/local/complexity: 1 blocking");
    expect(text).toContain("logs-audit/redaction: 1 blocking");
    expect(text).toContain("drift-scope/current: 1 info");
    expect(text).toContain("artifact, not an edit-loop gate");
    expect(text).toContain("Report-only: findings above never change");
  });

  it("labels a clean tool's section as having no findings", () => {
    expect(textFor([LINT_RATCHET_CLEAN])).toContain("clean (no findings)");
  });

  it("lists infrastructure failures in their own section", () => {
    const { envelopes, failures } = loadEnvelopes([
      fixturePath(LOGS_AUDIT_FINDINGS),
      fixturePath(MALFORMED_NOT_JSON),
    ]);
    const text = formatText(buildAuditReport(envelopes, failures));
    expect(text).toContain("Unreadable or malformed envelopes (1):");
    expect(text).toContain(MALFORMED_NOT_JSON);
    expect(text).toContain("not valid JSON");
  });

  // Exact, whole-line pins on the per-control `severityMix` segments. Loose
  // toContain checks tolerate a dropped or spuriously-added sibling segment, so
  // these find the rendered line and assert its full content, closing the
  // `> 0` inclusion boundaries on each severity (lines 163-165 of the report).
  function controlLine(text: string, control: string): string | undefined {
    return text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith(`${control}:`));
  }

  it("renders an info-only control as exactly its info segment (no zero blocking/warning)", () => {
    // drift-ai-skipped's lone control has blocking 0, warning 0, info 1.
    const line = controlLine(textFor([DRIFT_AI_SKIPPED]), "drift-scope/current");
    // info > 0 false-flip drops the segment; blocking/warning > 0 true-flips add
    // a spurious "0 blocking"/"0 warning" prefix — an exact match kills all three.
    expect(line).toBe("drift-scope/current: 1 info");
  });

  it("renders a blocking-only control as exactly its blocking segment (no zero info appended)", () => {
    // lint-ratchet-findings' complexity control has blocking 1, warning 0, info 0.
    const line = controlLine(textFor([LINT_RATCHET_FINDINGS]), "lint/local/complexity");
    // An `info >= 0` mutant would append a spurious "0 info"; a blocking > 0
    // false-flip would empty the segment — the exact line pins both out.
    expect(line).toBe("lint/local/complexity: 1 blocking");
  });
});

describe("formatJson", () => {
  it("serializes the full report object", () => {
    const { envelopes, failures } = loadEnvelopes([fixturePath(LOGS_AUDIT_FINDINGS)]);
    const report = buildAuditReport(envelopes, failures);
    const parsed: unknown = JSON.parse(formatJson(report));
    expect(parsed).toEqual(report);
  });
});

describe("runHarnessAudit", () => {
  it("reads real fixture files and renders a grouped text report (exit 0)", () => {
    const result = runHarnessAudit({
      argv: [fixturePath(LINT_RATCHET_FINDINGS), fixturePath(LOGS_AUDIT_FINDINGS)],
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("lint:ratchet");
    expect(result.stdout).toContain("logs:audit");
    expect(result.report?.totals.tools).toBe(2);
  });

  it("keeps report-only semantics: block-severity findings still exit 0", () => {
    const result = runHarnessAudit({ argv: [fixturePath(LOGS_AUDIT_FINDINGS)] });
    expect(result.report?.totals.blocking).toBeGreaterThan(0);
    expect(result.exitCode).toBe(0);
  });

  it("exits 2 when an envelope file is malformed", () => {
    const result = runHarnessAudit({
      argv: [fixturePath(LOGS_AUDIT_FINDINGS), fixturePath(MALFORMED_NOT_JSON)],
    });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("Unreadable or malformed envelopes (1):");
  });

  it("renders a no-valid-envelopes report and exits 2 when every input is malformed", () => {
    const result = runHarnessAudit({ argv: [fixturePath(MALFORMED_NOT_JSON)] });
    expect(result.exitCode).toBe(2);
    expect(result.report?.tools).toEqual([]);
    expect(result.stdout).toContain("No valid envelopes were read.");
    expect(result.stdout).toContain("Unreadable or malformed envelopes (1):");
  });

  it("emits JSON when --format json is passed", () => {
    const result = runHarnessAudit({
      argv: ["--format", "json", fixturePath(DRIFT_AI_FINDINGS)],
    });
    const parsed: unknown = JSON.parse(result.stdout);
    expect(parsed).toEqual(result.report);
    expect(result.report?.tools[0]?.tool).toBe("drift:ai");
  });

  it("still emits valid JSON and exits 2 when --format json meets a malformed envelope", () => {
    const result = runHarnessAudit({
      argv: ["--format", "json", fixturePath(LOGS_AUDIT_FINDINGS), fixturePath(MALFORMED_NOT_JSON)],
    });
    expect(result.exitCode).toBe(2);
    const parsed: unknown = JSON.parse(result.stdout);
    expect(parsed).toEqual(result.report);
    expect(result.report?.failures).toHaveLength(1);
  });

  it("writes the rendered report to --output and confirms on stdout", () => {
    const outputPath = path.join(makeTempRoot(), "nested", "report.txt");
    const result = runHarnessAudit({
      argv: ["--output", outputPath, fixturePath(LINT_RATCHET_FINDINGS)],
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`wrote text report to ${outputPath}`);
    expect(result.stdout).not.toContain("unreadable/malformed");
    expect(readFileSync(outputPath, "utf8")).toContain("lint:ratchet");
  });

  it("writes the report file but still exits 2 when an --output run has a malformed envelope", () => {
    const outputPath = path.join(makeTempRoot(), "report.txt");
    const result = runHarnessAudit({
      argv: [
        "--output",
        outputPath,
        fixturePath(LOGS_AUDIT_FINDINGS),
        fixturePath(MALFORMED_NOT_JSON),
      ],
    });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain(`wrote text report to ${outputPath}`);
    expect(result.stdout).toContain("(1 envelope(s) unreadable/malformed - see report)");
    expect(readFileSync(outputPath, "utf8")).toContain("Unreadable or malformed envelopes (1):");
  });

  it("treats an unwritable --output path as a tool error (exit 2)", () => {
    const result = runHarnessAudit({
      argv: ["--output", "/dev/null/report.txt", fixturePath(LINT_RATCHET_FINDINGS)],
      writeFile: () => {
        throw new Error("ENOTDIR");
      },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("could not write report");
  });

  it("returns exit 2 for invalid args and exit 0 for help", () => {
    expect(runHarnessAudit({ argv: [] }).exitCode).toBe(2);
    const help = runHarnessAudit({ argv: ["--help"] });
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("Usage:");
  });
});
