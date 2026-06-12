import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
  harnessDiagnosticsSchema,
} from "../../packages/shared/src/schemas/harness-diagnostics.js";
import { HARNESS_DIAGNOSTICS_OUTPUT_ENV } from "../harness/harness-diagnostics-output.js";
import {
  auditJsonlText,
  formatJson,
  formatText,
  type LogsAuditReport,
  parseArgs,
  runLogsAudit,
} from "../logs-audit.js";
import {
  controlForCheck,
  LOGS_AUDIT_DIAGNOSTIC_CONTROL_IDS,
  projectLogsAuditDiagnostics,
  writeLogsAuditDiagnosticsSidecar,
} from "./logs-audit-diagnostics.js";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function fixture(name: string): string {
  return readFileSync(path.join(fixtureDir, name), "utf8");
}

describe("parseArgs", () => {
  it("accepts --file flags, positional files, and format", () => {
    expect(parseArgs(["--file", "server.jsonl", "extra.jsonl", "--format=json"])).toEqual({
      files: ["server.jsonl", "extra.jsonl"],
      format: "json",
    });
  });

  it("rejects missing files, missing option values, and unknown flags", () => {
    expect(() => parseArgs([])).toThrow(/requires at least one log file/u);
    expect(() => parseArgs(["--file"])).toThrow(/--file requires a value/u);
    expect(() => parseArgs(["--format", "yaml"])).toThrow(/--format requires text or json/u);
    expect(() => parseArgs(["--unknown"])).toThrow(/Unknown argument/u);
  });
});

describe("auditJsonlText", () => {
  it("accepts fixture logs that are parseable JSONL with redacted sensitive fields", () => {
    const report = auditJsonlText("redacted-server.jsonl", fixture("redacted-server.jsonl"));
    expect(report.files).toEqual([
      { file: "redacted-server.jsonl", totalLines: 3, records: 3, rejectedLines: 0 },
    ]);
    expect(report.findings).toEqual([]);
  });

  it("accepts representative authz, mutation, and socket broadcast event logs", () => {
    const report = auditJsonlText(
      "business-events-server.jsonl",
      fixture("business-events-server.jsonl"),
    );
    expect(report.files).toEqual([
      { file: "business-events-server.jsonl", totalLines: 5, records: 5, rejectedLines: 0 },
    ]);
    expect(report.findings).toEqual([]);
  });

  it("reports invalid JSONL lines and non-object records", () => {
    const report = auditJsonlText("bad.jsonl", '{"message":"ok"}\n  \nnot-json\n[]\n');
    expect(report.files).toEqual([
      { file: "bad.jsonl", totalLines: 4, records: 1, rejectedLines: 3 },
    ]);
    expect(report.findings).toEqual([
      {
        check: "jsonl",
        file: "bad.jsonl",
        line: 2,
        message: "line is empty",
      },
      {
        check: "jsonl",
        file: "bad.jsonl",
        line: 3,
        message: "line is not valid JSON",
      },
      {
        check: "jsonl",
        file: "bad.jsonl",
        line: 4,
        message: "JSONL record must be an object",
      },
    ]);
  });

  it("reports obvious sensitive fields without echoing secret values", () => {
    const report = auditJsonlText(
      "leaky.jsonl",
      JSON.stringify({
        accessToken: "access-secret",
        req: {
          headers: {
            authorization: "Bearer auth-secret",
            cookie: "musi_refresh=refresh-secret",
            "set-cookie": "musi_refresh=set-cookie-secret",
          },
          url: "/trpc/auth.login?input=raw-secret&token=url-secret&password=password-secret",
        },
      }),
    );

    expect(report.findings.map((finding) => finding.field)).toEqual([
      "accessToken",
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers.set-cookie",
      "req.url?input",
      "req.url?token",
      "req.url?password",
    ]);
    expect(JSON.stringify(report)).not.toContain("secret");
    expect(formatText(report)).not.toContain("secret");
  });

  it("reports chat and whisper content paths without flagging ordinary messages", () => {
    const report = auditJsonlText(
      "chat.jsonl",
      JSON.stringify({
        message: "ordinary log message",
        chat: {
          content: "chat-secret",
          message: { content: "message-secret" },
          whisper: { content: "nested-whisper-secret" },
        },
        messageEnvelope: { content: "not covered by the server redaction contract" },
        payload: {
          content: "payload-secret",
          message: { content: "payload-message-secret" },
        },
        whisper: {
          content: "whisper-content-secret",
          message: "whisper-message-secret",
        },
      }),
    );

    expect(report.findings.map((finding) => finding.field)).toEqual([
      "chat.content",
      "chat.message.content",
      "chat.whisper.content",
      "payload.content",
      "payload.message.content",
      "whisper.content",
      "whisper.message",
    ]);
    expect(JSON.stringify(report)).not.toContain("secret");
  });

  it("allows null and recognized redaction sentinels in sensitive fields and URLs", () => {
    const report = auditJsonlText(
      "redacted.jsonl",
      JSON.stringify({
        accessToken: "[redacted]",
        cookie: "redacted",
        refreshToken: null,
        req: {
          headers: { authorization: "<redacted>" },
          url: "/trpc/auth.refresh?input=redacted&token=%5Bredacted%5D",
        },
      }),
    );
    expect(report.findings).toEqual([]);
  });

  it("reports missing request ids and unstable business event fields", () => {
    const report = auditJsonlText(
      "drift.jsonl",
      [
        JSON.stringify({
          level: 30,
          reqId: "req-known-1",
          req: { id: "req-known-1", method: "POST", url: "/trpc/character.updateStats" },
        }),
        JSON.stringify({
          level: 30,
          event: "authz.campaign.member",
          outcome: "deny",
          actor: { userId: "user-1" },
          campaignId: "campaign-1",
        }),
        JSON.stringify({
          level: 30,
          reqId: "req-known-1",
          event: "character.updateStats",
          outcome: "validation failed for character 123",
          actor: { userId: "user-1" },
          characterId: "character-1",
        }),
        JSON.stringify({
          level: 30,
          reqId: "req-other-1",
          event: "socket.broadcast",
          outcome: "success",
          campaignId: "campaign-1",
        }),
      ].join("\n"),
    );

    expect(report.findings).toEqual([
      {
        check: "request-id",
        file: "drift.jsonl",
        line: 2,
        field: "requestId",
        message: "business event log is missing a request id",
      },
      {
        check: "request-id",
        file: "drift.jsonl",
        line: 4,
        field: "requestId",
        message: "business event request id has no matching request log",
      },
      {
        check: "event-fields",
        file: "drift.jsonl",
        line: 2,
        field: "reason",
        message: "reason is required for deny outcomes",
      },
      {
        check: "event-fields",
        file: "drift.jsonl",
        line: 3,
        field: "outcome",
        message: "mutation outcome must be success or failure",
      },
      {
        check: "event-fields",
        file: "drift.jsonl",
        line: 4,
        field: "socketEvent",
        message: "socketEvent is required for socket.broadcast",
      },
    ]);
  });
});

describe("runLogsAudit", () => {
  it("returns exit 0 and text output when all files pass", () => {
    const result = runLogsAudit({
      argv: ["--file", "server.jsonl"],
      readFile: () => fixture("redacted-server.jsonl"),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("logs:audit: 1 file(s) audited");
    expect(result.stdout).toContain("OK: JSONL parsed and sensitive fields are redacted");
  });

  it("returns exit 1 and JSON output when findings exist", () => {
    const result = runLogsAudit({
      argv: ["--format", "json", "server.jsonl"],
      readFile: () => '{"token":"unredacted"}\n',
    });

    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { findings: Array<{ check: string }> };
    expect(parsed.findings).toEqual([
      {
        check: "redaction",
        file: "server.jsonl",
        line: 1,
        field: "token",
        message: "sensitive field 'token' is not redacted",
      },
    ]);
    expect(formatJson(result.report ?? { files: [], findings: [] })).toContain('"findings"');
  });

  it("returns exit 2 for invalid args and exit 0 for help", () => {
    expect(runLogsAudit({ argv: [] }).exitCode).toBe(2);
    const help = runLogsAudit({ argv: ["--help"] });
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("Usage:");
  });
});

const manifestText = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "harness.controls.json"),
  "utf8",
);

function auditReport(findings: LogsAuditReport["findings"]): LogsAuditReport {
  return {
    files: [{ file: "server.jsonl", totalLines: 1, records: 0, rejectedLines: 0 }],
    findings,
  };
}

describe("projectLogsAuditDiagnostics", () => {
  it("projects a clean report to a valid empty envelope", () => {
    const envelope = projectLogsAuditDiagnostics(auditReport([]));
    expect(envelope.tool).toBe("logs:audit");
    expect(envelope.version).toBe(HARNESS_DIAGNOSTICS_SCHEMA_VERSION);
    expect(envelope.findings).toEqual([]);
    expect(envelope.summary).toEqual({ blocking: 0, warning: 0, info: 0, byControl: {} });
    expect(harnessDiagnosticsSchema.safeParse(envelope).success).toBe(true);
  });

  it("projects audit findings to block entries, carrying the field in reason", () => {
    const envelope = projectLogsAuditDiagnostics(
      auditReport([
        {
          check: "redaction",
          file: "server.jsonl",
          line: 1,
          field: "token",
          message: "sensitive field 'token' is not redacted",
        },
      ]),
    );
    const [entry] = envelope.findings;
    expect(entry).toMatchObject({
      control: "logs-audit/redaction",
      severity: "block",
      path: "server.jsonl",
      line: 1,
      why: "sensitive field 'token' is not redacted",
      reason: "token",
      repairKind: "manual",
    });
    expect(entry?.howToFix).toContain("Redact");
    expect(envelope.summary.blocking).toBe(1);
    expect(envelope.summary.warning).toBe(0);
    expect(envelope.summary.byControl).toEqual({ "logs-audit/redaction": 1 });
    expect(harnessDiagnosticsSchema.safeParse(envelope).success).toBe(true);
  });

  it("omits reason and line for findings without a field or line", () => {
    const envelope = projectLogsAuditDiagnostics(
      auditReport([{ check: "input", file: "missing.jsonl", message: "could not read log file" }]),
    );
    const [entry] = envelope.findings;
    expect(entry?.control).toBe("logs-audit/input");
    expect(entry?.line).toBeUndefined();
    expect(entry?.reason).toBeUndefined();
    expect(entry === undefined ? {} : entry).not.toHaveProperty("reason");
    expect(harnessDiagnosticsSchema.safeParse(envelope).success).toBe(true);
  });

  it("maps every check to its logs-audit control, all resolving in the manifest", () => {
    expect(controlForCheck("input")).toBe("logs-audit/input");
    expect(controlForCheck("jsonl")).toBe("logs-audit/jsonl");
    expect(controlForCheck("redaction")).toBe("logs-audit/redaction");
    expect(controlForCheck("request-id")).toBe("logs-audit/request-id");
    expect(controlForCheck("event-fields")).toBe("logs-audit/event-fields");
    for (const control of LOGS_AUDIT_DIAGNOSTIC_CONTROL_IDS) {
      expect(manifestText).toContain(`"id": "${control}"`);
    }
  });

  it("orders findings deterministically by control, then path, then line", () => {
    const envelope = projectLogsAuditDiagnostics(
      auditReport([
        { check: "redaction", file: "b.jsonl", line: 2, field: "token", message: "later" },
        { check: "redaction", file: "b.jsonl", line: 1, field: "cookie", message: "earlier" },
        { check: "input", file: "a.jsonl", message: "could not read log file" },
      ]),
    );
    // logs-audit/input sorts before logs-audit/redaction; within a control,
    // ascending path then line.
    expect(envelope.findings.map((finding) => [finding.control, finding.line])).toEqual([
      ["logs-audit/input", undefined],
      ["logs-audit/redaction", 1],
      ["logs-audit/redaction", 2],
    ]);
  });

  it("never echoes a secret value into the projected envelope", () => {
    const envelope = projectLogsAuditDiagnostics(
      auditJsonlText("leaky.jsonl", JSON.stringify({ token: "super-secret-value" })),
    );
    expect(envelope.summary.blocking).toBeGreaterThan(0);
    expect(JSON.stringify(envelope)).not.toContain("super-secret-value");
  });
});

describe("writeLogsAuditDiagnosticsSidecar and runLogsAudit sidecar", () => {
  const tempRoots: string[] = [];

  beforeEach(() => {
    vi.stubEnv(HARNESS_DIAGNOSTICS_OUTPUT_ENV, undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root !== undefined) rmSync(root, { recursive: true, force: true });
    }
  });

  function makeTempRoot(): string {
    const root = mkdtempSync(path.join(tmpdir(), "logs-audit-diagnostics-"));
    tempRoots.push(root);
    return root;
  }

  it("is a no-op when the env var is unset", () => {
    expect(() => {
      writeLogsAuditDiagnosticsSidecar(auditReport([]));
    }).not.toThrow();
  });

  it("writes a schema-valid envelope when the env var names a path", () => {
    const outputPath = path.join(makeTempRoot(), "nested", "diag.json");
    vi.stubEnv(HARNESS_DIAGNOSTICS_OUTPUT_ENV, outputPath);

    writeLogsAuditDiagnosticsSidecar(
      auditReport([
        {
          check: "redaction",
          file: "server.jsonl",
          line: 1,
          field: "token",
          message: "sensitive field 'token' is not redacted",
        },
      ]),
    );

    expect(existsSync(outputPath)).toBe(true);
    const written = harnessDiagnosticsSchema.parse(JSON.parse(readFileSync(outputPath, "utf8")));
    expect(written.tool).toBe("logs:audit");
    expect(written.summary.blocking).toBe(1);
  });

  it("re-throws a descriptive error when the sidecar path cannot be written", () => {
    const dirAsOutput = path.join(makeTempRoot(), "diag-dir");
    mkdirSync(dirAsOutput);
    vi.stubEnv(HARNESS_DIAGNOSTICS_OUTPUT_ENV, dirAsOutput);

    expect(() => {
      writeLogsAuditDiagnosticsSidecar(auditReport([]));
    }).toThrow(/HARNESS_DIAGNOSTICS_OUTPUT sidecar/u);
  });

  it("writes the sidecar through runLogsAudit while leaving native stdout unchanged", () => {
    const outputPath = path.join(makeTempRoot(), "diag", "logs.json");
    vi.stubEnv(HARNESS_DIAGNOSTICS_OUTPUT_ENV, outputPath);

    const result = runLogsAudit({
      argv: ["--file", "server.jsonl"],
      readFile: () => fixture("redacted-server.jsonl"),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("logs:audit: 1 file(s) audited");
    expect(result.stdout).toContain("OK: JSONL parsed and sensitive fields are redacted");
    const written = harnessDiagnosticsSchema.parse(JSON.parse(readFileSync(outputPath, "utf8")));
    expect(written.tool).toBe("logs:audit");
    expect(written.findings).toEqual([]);
  });

  it("projects malformed-log findings as block entries while preserving exit 1", () => {
    const outputPath = path.join(makeTempRoot(), "logs.json");
    vi.stubEnv(HARNESS_DIAGNOSTICS_OUTPUT_ENV, outputPath);

    const result = runLogsAudit({ argv: ["server.jsonl"], readFile: () => "not-json\n" });

    expect(result.exitCode).toBe(1);
    const written = harnessDiagnosticsSchema.parse(JSON.parse(readFileSync(outputPath, "utf8")));
    expect(written.summary.blocking).toBeGreaterThan(0);
    expect(written.findings.every((finding) => finding.severity === "block")).toBe(true);
    expect(written.findings.some((finding) => finding.control === "logs-audit/jsonl")).toBe(true);
  });

  it("projects an unreadable-file input finding as a block entry while preserving exit 1", () => {
    const outputPath = path.join(makeTempRoot(), "logs.json");
    vi.stubEnv(HARNESS_DIAGNOSTICS_OUTPUT_ENV, outputPath);

    const result = runLogsAudit({
      argv: ["missing.jsonl"],
      readFile: () => {
        throw new Error("ENOENT: no such file");
      },
    });

    expect(result.exitCode).toBe(1);
    const written = harnessDiagnosticsSchema.parse(JSON.parse(readFileSync(outputPath, "utf8")));
    const [entry] = written.findings;
    expect(entry?.control).toBe("logs-audit/input");
    expect(entry?.severity).toBe("block");
    expect(entry?.path).toBe("missing.jsonl");
    expect(entry?.why).toBe("could not read log file");
    expect(entry?.line).toBeUndefined();
    expect(entry?.reason).toBeUndefined();
    expect(written.summary.byControl).toEqual({ "logs-audit/input": 1 });
  });

  it("treats an unwritable sidecar path as a tool error (exit 2)", () => {
    const dirAsOutput = path.join(makeTempRoot(), "diag-dir");
    mkdirSync(dirAsOutput);
    vi.stubEnv(HARNESS_DIAGNOSTICS_OUTPUT_ENV, dirAsOutput);

    const result = runLogsAudit({ argv: ["server.jsonl"], readFile: () => '{"message":"ok"}\n' });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("HARNESS_DIAGNOSTICS_OUTPUT sidecar");
  });

  it("writes no sidecar when the env var is unset", () => {
    const outputPath = path.join(makeTempRoot(), "logs.json");

    const result = runLogsAudit({ argv: ["server.jsonl"], readFile: () => '{"message":"ok"}\n' });

    expect(result.exitCode).toBe(0);
    expect(existsSync(outputPath)).toBe(false);
  });
});
