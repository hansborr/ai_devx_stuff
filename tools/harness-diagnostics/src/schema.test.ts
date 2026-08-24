import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  buildHarnessDiagnostics,
  compareHarnessFindings,
  HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
  type HarnessDiagnosticNote,
  type HarnessDiagnostics,
  harnessDiagnosticsSchema,
  type HarnessFinding,
  harnessFindingSchema,
  summarizeHarnessFindings,
} from "./schema.js";

const JSON_INDENT = 2;

function expectSchemaParseSuccess<TSchema extends z.ZodType>(
  schema: TSchema,
  input: NoInfer<z.input<TSchema>>,
): z.output<TSchema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    expect.fail(
      `Expected Zod parse to succeed; issues:\n${JSON.stringify(result.error.issues, null, JSON_INDENT)}`,
    );
  }
  return result.data;
}

function expectParseFailure<T>(result: z.ZodSafeParseResult<T>): z.ZodError<T> {
  if (result.success) {
    expect.fail(
      `Expected Zod parse to fail; got parsed data:\n${JSON.stringify(result.data, null, JSON_INDENT)}`,
    );
  }
  return result.error;
}

const validLintFinding: HarnessFinding = {
  control: "lint/local/type-assertion-boundary",
  severity: "warn",
  path: "packages/server/src/foo.ts",
  line: 42,
  ruleId: "local/type-assertion-boundary",
  messageId: "missingBoundary",
  why: "Unannotated type assertion hides bugs from the type checker.",
  howToFix: "Replace `as` with a narrowing helper or annotate the boundary.",
  repairKind: "manual",
};

const validCodemodFinding: HarnessFinding = {
  control: "lint/local/structured-logging",
  severity: "warn",
  path: "packages/server/src/bar.ts",
  why: "Interpolated log message defeats aggregation.",
  howToFix: "Move the dynamic value into a structured field.",
  repairKind: "codemod",
  repairCommand: "bun run codemod:structured-logging-fix",
};

const validSensorFinding: HarnessFinding = {
  control: "sensor/blob-size",
  severity: "block",
  why: "Staged blob exceeds the configured size threshold.",
  howToFix: "Remove the blob from staging or raise the threshold deliberately.",
  repairKind: "manual",
};

const validInfoFinding: HarnessFinding = {
  control: "sensor/knip",
  severity: "info",
  why: "An unused export was detected by knip.",
  howToFix: "Remove the unused export or wire it into a consumer.",
  repairKind: "manual",
};

const validNote: HarnessDiagnosticNote = {
  kind: "recovery-command",
  message: "Accept intentional debt only after reviewing the regression.",
  command: 'bun run lint:ratchet:update -- --allow-worse --reason "<why>"',
};

describe("harnessFindingSchema", () => {
  it("accepts a lint finding with rule metadata", () => {
    expectSchemaParseSuccess(harnessFindingSchema, validLintFinding);
  });

  it("accepts an optional finding kind discriminator", () => {
    expectSchemaParseSuccess(harnessFindingSchema, { ...validLintFinding, kind: "regression" });
  });

  it("rejects an unknown finding kind discriminator", () => {
    expectParseFailure(
      harnessFindingSchema.safeParse({ ...validLintFinding, kind: "future-kind" }),
    );
  });

  it("accepts a codemod finding with repairCommand", () => {
    expectSchemaParseSuccess(harnessFindingSchema, validCodemodFinding);
  });

  it("accepts a sensor finding without path or line", () => {
    expectSchemaParseSuccess(harnessFindingSchema, validSensorFinding);
  });

  it("rejects a codemod finding without repairCommand", () => {
    const { repairCommand: _omit, ...rest } = validCodemodFinding;
    const error = expectParseFailure(harnessFindingSchema.safeParse(rest));
    expect(error.issues.some((i) => i.path.join(".") === "repairCommand")).toBe(true);
  });

  it("rejects a manual finding that carries a repairCommand", () => {
    const error = expectParseFailure(
      harnessFindingSchema.safeParse({ ...validLintFinding, repairCommand: "bun run nope" }),
    );
    expect(error.issues.some((i) => i.path.join(".") === "repairCommand")).toBe(true);
  });

  it("rejects line without path", () => {
    const { path: _omit, ...rest } = validLintFinding;
    const error = expectParseFailure(harnessFindingSchema.safeParse(rest));
    expect(error.issues.some((i) => i.path.join(".") === "line")).toBe(true);
  });

  it("rejects an unknown severity", () => {
    expectParseFailure(
      harnessFindingSchema.safeParse({ ...validSensorFinding, severity: "critical" }),
    );
  });

  it("rejects a malformed control id", () => {
    expectParseFailure(
      harnessFindingSchema.safeParse({ ...validSensorFinding, control: "blob-size" }),
    );
  });

  it("rejects a control id with leading junk before the anchored start", () => {
    const error = expectParseFailure(
      harnessFindingSchema.safeParse({ ...validSensorFinding, control: "BAD sensor/blob-size" }),
    );
    expect(error.issues.some((i) => i.path.join(".") === "control")).toBe(true);
  });

  it("rejects a control id with trailing junk after the anchored end", () => {
    const error = expectParseFailure(
      harnessFindingSchema.safeParse({ ...validSensorFinding, control: "sensor/blob-size BAD" }),
    );
    expect(error.issues.some((i) => i.path.join(".") === "control")).toBe(true);
  });

  it("rejects an empty reason", () => {
    const error = expectParseFailure(
      harnessFindingSchema.safeParse({ ...validLintFinding, reason: "" }),
    );
    expect(error.issues.some((i) => i.path.join(".") === "reason")).toBe(true);
  });

  it("rejects unknown extra properties", () => {
    expectParseFailure(harnessFindingSchema.safeParse({ ...validSensorFinding, extra: "nope" }));
  });
});

const validEnvelope: HarnessDiagnostics = {
  version: HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
  tool: "lint:agent",
  findings: [validLintFinding, validCodemodFinding, validSensorFinding],
  summary: {
    blocking: 1,
    warning: 2,
    info: 0,
    byControl: {
      "lint/local/type-assertion-boundary": 1,
      "lint/local/structured-logging": 1,
      "sensor/blob-size": 1,
    },
  },
};

describe("harnessDiagnosticsSchema", () => {
  it("accepts a well-formed envelope", () => {
    expectSchemaParseSuccess(harnessDiagnosticsSchema, validEnvelope);
  });

  it("accepts an empty findings array with zeroed summary", () => {
    expectSchemaParseSuccess(harnessDiagnosticsSchema, {
      version: HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
      tool: "doctor",
      findings: [],
      summary: { blocking: 0, warning: 0, info: 0, byControl: {} },
    });
  });

  it("accepts optional envelope-level notes", () => {
    expectSchemaParseSuccess(harnessDiagnosticsSchema, { ...validEnvelope, notes: [validNote] });
  });

  it("rejects malformed envelope-level notes", () => {
    expectParseFailure(
      harnessDiagnosticsSchema.safeParse({
        ...validEnvelope,
        notes: [{ ...validNote, command: "" }],
      }),
    );
  });

  it("rejects a wrong schema version", () => {
    expectParseFailure(harnessDiagnosticsSchema.safeParse({ ...validEnvelope, version: "2" }));
  });

  it("accepts an arbitrary non-empty tool id (the envelope tool is a permissive transport)", () => {
    expectSchemaParseSuccess(harnessDiagnosticsSchema, { ...validEnvelope, tool: "made-up-tool" });
  });

  it("rejects an empty tool id", () => {
    expectParseFailure(harnessDiagnosticsSchema.safeParse({ ...validEnvelope, tool: "" }));
  });

  it("accepts the drift:ai, logs:audit, and harness:audit producer/consumer ids", () => {
    for (const tool of ["drift:ai", "logs:audit", "harness:audit"] as const) {
      expectSchemaParseSuccess(harnessDiagnosticsSchema, {
        version: HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
        tool,
        findings: [],
        summary: { blocking: 0, warning: 0, info: 0, byControl: {} },
      });
    }
  });

  it("rejects an envelope whose summary counts disagree with findings", () => {
    const error = expectParseFailure(
      harnessDiagnosticsSchema.safeParse({
        ...validEnvelope,
        summary: { ...validEnvelope.summary, blocking: 0 },
      }),
    );
    expect(error.issues.some((i) => i.path.join(".").startsWith("summary"))).toBe(true);
  });

  it("rejects an envelope whose summary.info disagrees with the findings", () => {
    const findings = [validLintFinding, validInfoFinding];
    const summary = summarizeHarnessFindings(findings);
    const error = expectParseFailure(
      harnessDiagnosticsSchema.safeParse({
        version: HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
        tool: "lint:agent",
        findings,
        summary: { ...summary, info: summary.info + 1 },
      }),
    );
    expect(error.issues.some((i) => i.path.join(".") === "summary")).toBe(true);
  });

  it("rejects an envelope whose byControl count is wrong", () => {
    const error = expectParseFailure(
      harnessDiagnosticsSchema.safeParse({
        ...validEnvelope,
        summary: {
          ...validEnvelope.summary,
          byControl: { ...validEnvelope.summary.byControl, "sensor/blob-size": 5 },
        },
      }),
    );
    expect(error.issues.some((i) => i.path.join(".").includes("sensor/blob-size"))).toBe(true);
  });

  it("rejects an envelope whose byControl names a control with no finding", () => {
    expectParseFailure(
      harnessDiagnosticsSchema.safeParse({
        ...validEnvelope,
        summary: {
          ...validEnvelope.summary,
          byControl: { ...validEnvelope.summary.byControl, "sensor/knip": 1 },
        },
      }),
    );
  });
});

describe("summarizeHarnessFindings", () => {
  it("counts severities and groups by control", () => {
    expect(
      summarizeHarnessFindings([validLintFinding, validCodemodFinding, validSensorFinding]),
    ).toEqual({
      blocking: 1,
      warning: 2,
      info: 0,
      byControl: {
        "lint/local/type-assertion-boundary": 1,
        "lint/local/structured-logging": 1,
        "sensor/blob-size": 1,
      },
    });
  });

  it("counts info-severity findings into the info bucket", () => {
    expect(
      summarizeHarnessFindings([validLintFinding, validInfoFinding, validSensorFinding]),
    ).toEqual({
      blocking: 1,
      warning: 1,
      info: 1,
      byControl: {
        "lint/local/type-assertion-boundary": 1,
        "sensor/knip": 1,
        "sensor/blob-size": 1,
      },
    });
  });

  it("returns a zeroed summary for an empty findings list", () => {
    expect(summarizeHarnessFindings([])).toEqual({
      blocking: 0,
      warning: 0,
      info: 0,
      byControl: {},
    });
  });

  it("produces a summary the envelope schema accepts", () => {
    const findings = [validLintFinding, validCodemodFinding, validSensorFinding];
    const envelope = {
      version: HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
      tool: "lint:agent" as const,
      findings,
      summary: summarizeHarnessFindings(findings),
    };
    expectSchemaParseSuccess(harnessDiagnosticsSchema, envelope);
  });
});

describe("compareHarnessFindings and buildHarnessDiagnostics", () => {
  it("orders findings by control, path, line, then why", () => {
    const findings: readonly HarnessFinding[] = [
      { ...validSensorFinding, why: "z no path" },
      { ...validLintFinding, path: "b.ts", line: 2, why: "z later line" },
      { ...validLintFinding, path: "b.ts", line: 1, why: "z later text" },
      { ...validLintFinding, path: "b.ts", line: 1, why: "a earlier text" },
      { ...validLintFinding, path: "a.ts", line: 9, why: "z earlier path" },
    ];

    expect([...findings].sort(compareHarnessFindings).map((finding) => finding.why)).toEqual([
      "z earlier path",
      "a earlier text",
      "z later text",
      "z later line",
      "z no path",
    ]);
  });

  it("builds a summary-consistent envelope without mutating the caller's findings", () => {
    const findings: readonly HarnessFinding[] = [
      { ...validLintFinding, path: "b.ts", why: "second" },
      { ...validLintFinding, path: "a.ts", why: "first" },
    ];

    const envelope = buildHarnessDiagnostics("lint:agent", findings, { notes: [validNote] });

    expect(findings.map((finding) => finding.path)).toEqual(["b.ts", "a.ts"]);
    expect(envelope.findings.map((finding) => finding.path)).toEqual(["a.ts", "b.ts"]);
    expect(envelope.notes).toEqual([validNote]);
    expect(envelope.summary).toEqual(summarizeHarnessFindings(envelope.findings));
    expectSchemaParseSuccess(harnessDiagnosticsSchema, envelope);
  });
});
