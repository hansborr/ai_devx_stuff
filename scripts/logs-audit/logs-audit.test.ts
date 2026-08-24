import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
  harnessDiagnosticsSchema,
} from "@musi/harness-diagnostics/schema.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HARNESS_DIAGNOSTICS_OUTPUT_ENV } from "../harness/harness-diagnostics-output.js";
import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import {
  controlForCheck,
  LOGS_AUDIT_DIAGNOSTIC_CONTROL_IDS,
  projectLogsAuditDiagnostics,
  writeLogsAuditDiagnosticsSidecar,
} from "./logs-audit-diagnostics.js";
import { formatJson, formatText } from "./logs-audit-format.js";
import { auditJsonlText } from "./logs-audit-ingestion.js";
import { defaultLatestLogRoots, findLatestCompatibleLogFiles } from "./logs-audit-latest.js";
import { parseArgs, runLogsAudit } from "./logs-audit-runner.js";
import type { JsonObject, LogsAuditFinding, LogsAuditReport } from "./logs-audit-types.js";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function fixture(name: string): string {
  return readFileSync(path.join(fixtureDir, name), "utf8");
}

type ExpectedAuditScenarioFinding = Omit<LogsAuditFinding, "file" | "line"> & {
  readonly record: number;
};

interface AuditScenario {
  readonly name: string;
  readonly records: JsonObject[];
  readonly expected: ExpectedAuditScenarioFinding[];
}

interface AuditScenarioGroup {
  readonly name: string;
  readonly scenarios: AuditScenario[];
}

function expectAuditScenario(check: LogsAuditFinding["check"], scenario: AuditScenario): void {
  const file = `${check}-${scenario.name.replaceAll(" ", "-")}.jsonl`;
  const report = auditJsonlText(
    file,
    scenario.records.map((record) => JSON.stringify(record)).join("\n"),
  );
  const expected = scenario.expected.map(({ record, ...finding }) => ({
    ...finding,
    file,
    line: record + 1,
  }));

  expect(report.findings.filter((finding) => finding.check === check)).toEqual(expected);
}

describe("logs:audit CLI front door", () => {
  it("stays an export-free executable delegate", () => {
    const entrypoint = readFileSync(path.join(process.cwd(), "scripts/logs-audit.ts"), "utf8");

    expect(entrypoint).not.toMatch(/^export /mu);
  });
});

describe("parseArgs", () => {
  it("accepts --file flags, positional files, and format", () => {
    expect(parseArgs(["--file", "server.jsonl", "extra.jsonl", "--format=json"])).toEqual({
      files: ["server.jsonl", "extra.jsonl"],
      format: "json",
    });
  });

  it("preserves empty string argv entries as positional log files", () => {
    expect(parseArgs([""])).toEqual({
      files: [""],
      format: "text",
    });
  });

  it("rejects missing files, missing option values, and unknown flags", () => {
    expect(() => parseArgs([])).toThrow(/requires at least one log file/u);
    expect(() => parseArgs(["--file"])).toThrow(/--file requires a value/u);
    expect(() => parseArgs(["--file", "--latest"])).toThrow(/--file requires a value/u);
    expect(() => parseArgs(["--file=--latest"])).toThrow(/--file requires a value/u);
    expect(() => parseArgs(["--file="])).toThrow(/--file requires a value/u);
    expect(() => parseArgs(["--format", "--latest"])).toThrow(/--format requires a value/u);
    expect(() => parseArgs(["--format=--latest"])).toThrow(/--format requires a value/u);
    expect(() => parseArgs(["--format="])).toThrow(/--format requires a value/u);
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

  it("accepts files ending in multiple trailing newlines without findings", () => {
    for (const contents of ['{"message":"ok"}\n\n', '{"message":"ok"}\n\n\n']) {
      const report = auditJsonlText("trailing.jsonl", contents);
      expect(report.files).toEqual([
        { file: "trailing.jsonl", totalLines: 1, records: 1, rejectedLines: 0 },
      ]);
      expect(report.findings).toEqual([]);
    }
  });

  it("reports an all-blank file as clean (every line is trailing slop)", () => {
    // Pins the leaf-31 drop-all-trailing-blanks policy at its extreme: a file
    // of only newlines audits clean (previously "\n" flagged one empty line).
    for (const contents of ["\n", "\n\n\n"]) {
      const report = auditJsonlText("blank.jsonl", contents);
      expect(report.files).toEqual([
        { file: "blank.jsonl", totalLines: 0, records: 0, rejectedLines: 0 },
      ]);
      expect(report.findings).toEqual([]);
    }
  });

  it("still flags an interior empty line when the file ends in trailing newlines", () => {
    const report = auditJsonlText("interior.jsonl", '{"message":"ok"}\n\n{"message":"ok"}\n\n');
    expect(report.files).toEqual([
      { file: "interior.jsonl", totalLines: 3, records: 2, rejectedLines: 1 },
    ]);
    expect(report.findings).toEqual([
      {
        check: "jsonl",
        file: "interior.jsonl",
        line: 2,
        message: "line is empty",
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
    expect(report.findings.map((finding) => finding.redactionKind)).toEqual([
      "sensitive-field",
      "sensitive-field",
      "sensitive-field",
      "sensitive-field",
      "url-param",
      "url-param",
      "url-param",
    ]);
    expect(JSON.stringify(report)).not.toContain("secret");
    const text = formatText(report);
    expect(text).not.toContain("secret");
    expect(text).toContain("redactUrlForLogs");
    expect(text).toContain("LOGGER_REDACT_PATHS in packages/server/src/app.ts");
    // Remedy is tailored per finding type: object fields point at
    // LOGGER_REDACT_PATHS, URL query params at redactUrlForLogs.
    const lineFor = (field: string): string =>
      text.split("\n").find((line) => line.includes(` ${field} `)) ?? "";
    const objectFieldLine = lineFor("req.headers.cookie");
    expect(objectFieldLine).toContain("LOGGER_REDACT_PATHS");
    expect(objectFieldLine).not.toContain("redactUrlForLogs");
    const urlParamLine = lineFor("req.url?token");
    expect(urlParamLine).toContain("redactUrlForLogs");
    expect(urlParamLine).not.toContain("LOGGER_REDACT_PATHS");
  });

  it("routes the redaction remedy by finding type, not the field string", () => {
    // An object key containing '?' must still get the LOGGER_REDACT_PATHS
    // remedy. The earlier field.includes("?") discriminator would misroute this
    // to the URL remedy, so this fixture guards the typed redactionKind routing.
    const report = auditJsonlText(
      "weird-key.jsonl",
      JSON.stringify({ "a?b": { token: "object-secret" } }),
    );

    expect(report.findings.map((finding) => finding.field)).toEqual(["a?b.token"]);
    expect(report.findings.map((finding) => finding.redactionKind)).toEqual(["sensitive-field"]);
    const text = formatText(report);
    const line = text.split("\n").find((entry) => entry.includes(" a?b.token ")) ?? "";
    expect(line).toContain("LOGGER_REDACT_PATHS");
    expect(line).not.toContain("redactUrlForLogs");
  });

  it("reports every sensitive key variant with exact redaction diagnostics", () => {
    const report = auditJsonlText(
      "sensitive-keys.jsonl",
      JSON.stringify({
        body: { nested: "body-secret" },
        cookies: "cookie-jar-secret",
        input: "input-secret",
        password: "password-secret",
        raw_body: "raw-body-secret",
        refresh_token: "refresh-token-secret",
      }),
    );

    expect(report.findings).toEqual([
      {
        check: "redaction",
        redactionKind: "sensitive-field",
        file: "sensitive-keys.jsonl",
        line: 1,
        field: "body",
        message: "sensitive field 'body' is not redacted",
      },
      {
        check: "redaction",
        redactionKind: "sensitive-field",
        file: "sensitive-keys.jsonl",
        line: 1,
        field: "cookies",
        message: "sensitive field 'cookies' is not redacted",
      },
      {
        check: "redaction",
        redactionKind: "sensitive-field",
        file: "sensitive-keys.jsonl",
        line: 1,
        field: "input",
        message: "sensitive field 'input' is not redacted",
      },
      {
        check: "redaction",
        redactionKind: "sensitive-field",
        file: "sensitive-keys.jsonl",
        line: 1,
        field: "password",
        message: "sensitive field 'password' is not redacted",
      },
      {
        check: "redaction",
        redactionKind: "sensitive-field",
        file: "sensitive-keys.jsonl",
        line: 1,
        field: "raw_body",
        message: "sensitive field 'raw_body' is not redacted",
      },
      {
        check: "redaction",
        redactionKind: "sensitive-field",
        file: "sensitive-keys.jsonl",
        line: 1,
        field: "refresh_token",
        message: "sensitive field 'refresh_token' is not redacted",
      },
    ]);
    expect(JSON.stringify(report)).not.toContain("secret");
  });

  it("reports chat and whisper content paths without flagging ordinary messages", () => {
    const report = auditJsonlText(
      "chat.jsonl",
      JSON.stringify({
        logMessage: "ordinary log message",
        chat: {
          content: "chat-secret",
          message: { content: "message-secret" },
          whisper: { content: "nested-whisper-secret" },
        },
        message: {
          content: "top-level-message-secret",
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
      "message.content",
      "payload.content",
      "payload.message.content",
      "whisper.content",
      "whisper.message",
    ]);
    expect(JSON.stringify(report)).not.toContain("secret");
  });

  it("reports array-indexed chat and whisper content paths", () => {
    const report = auditJsonlText(
      "array-chat.jsonl",
      JSON.stringify({
        chat: {
          message: [{ content: "array-chat-message-secret" }],
          whisper: [{ content: "array-chat-whisper-secret" }],
        },
        payload: {
          message: [{ content: "array-payload-message-secret" }],
        },
        whisper: [{ message: "array-whisper-message-secret" }],
      }),
    );

    expect(report.findings.map((finding) => finding.field)).toEqual([
      "chat.message[0].content",
      "chat.whisper[0].content",
      "payload.message[0].content",
      "whisper[0].message",
    ]);
    expect(JSON.stringify(report)).not.toContain("secret");
  });

  it("reports URL query parameters with exact fields and messages", () => {
    const report = auditJsonlText(
      "url-query.jsonl",
      JSON.stringify({
        req: {
          request_url:
            "/trpc/auth.refresh?traceId=trace-1&accessToken=access-secret&authorization=auth-secret&cookie=cookie-secret&refresh_token=refresh-secret",
        },
      }),
    );

    expect(report.findings).toEqual([
      {
        check: "redaction",
        redactionKind: "url-param",
        file: "url-query.jsonl",
        line: 1,
        field: "req.request_url?accessToken",
        message: "sensitive query parameter 'accessToken' is not redacted",
      },
      {
        check: "redaction",
        redactionKind: "url-param",
        file: "url-query.jsonl",
        line: 1,
        field: "req.request_url?authorization",
        message: "sensitive query parameter 'authorization' is not redacted",
      },
      {
        check: "redaction",
        redactionKind: "url-param",
        file: "url-query.jsonl",
        line: 1,
        field: "req.request_url?cookie",
        message: "sensitive query parameter 'cookie' is not redacted",
      },
      {
        check: "redaction",
        redactionKind: "url-param",
        file: "url-query.jsonl",
        line: 1,
        field: "req.request_url?refresh_token",
        message: "sensitive query parameter 'refresh_token' is not redacted",
      },
    ]);
    expect(JSON.stringify(report)).not.toContain("secret");
  });

  it("recurses through arrays while preserving indexed field paths", () => {
    const report = auditJsonlText(
      "array-redaction.jsonl",
      JSON.stringify({
        events: [
          { token: "array-token-secret" },
          { nested: { authorization: "array-auth-secret" } },
        ],
      }),
    );

    expect(report.findings).toEqual([
      {
        check: "redaction",
        redactionKind: "sensitive-field",
        file: "array-redaction.jsonl",
        line: 1,
        field: "events[0].token",
        message: "sensitive field 'events[0].token' is not redacted",
      },
      {
        check: "redaction",
        redactionKind: "sensitive-field",
        file: "array-redaction.jsonl",
        line: 1,
        field: "events[1].nested.authorization",
        message: "sensitive field 'events[1].nested.authorization' is not redacted",
      },
    ]);
  });

  it("allows null, case-insensitive sentinels, and trimmed redaction sentinels", () => {
    const report = auditJsonlText(
      "redacted.jsonl",
      JSON.stringify({
        accessToken: "[redacted]",
        cookie: "redacted",
        password: "  ReDaCtEd  ",
        rawBody: "***",
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
        JSON.stringify({ level: 30, event: "script.logs-audit", outcome: "whatever" }),
        JSON.stringify({ level: 30, event: "logs-audit.script.", outcome: "whatever" }),
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
        JSON.stringify({ level: 30, reqId: 42 }),
      ].join("\n"),
    );

    expect(report.findings).toEqual([
      {
        check: "request-id",
        file: "drift.jsonl",
        line: 7,
        field: "reqId",
        message: "request id must be a string",
      },
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
        message: "business event log is missing a request id",
      },
      {
        check: "request-id",
        file: "drift.jsonl",
        line: 6,
        field: "requestId",
        message: "business event request id has no matching request log",
      },
      {
        check: "event-fields",
        file: "drift.jsonl",
        line: 2,
        field: "event",
        message: "event must be a stable low-cardinality code",
      },
      {
        check: "event-fields",
        file: "drift.jsonl",
        line: 2,
        field: "outcome",
        message: "mutation outcome must be success or failure",
      },
      {
        check: "event-fields",
        file: "drift.jsonl",
        line: 4,
        field: "reason",
        message: "reason is required for deny outcomes",
      },
      {
        check: "event-fields",
        file: "drift.jsonl",
        line: 5,
        field: "outcome",
        message: "mutation outcome must be success or failure",
      },
      {
        check: "event-fields",
        file: "drift.jsonl",
        line: 6,
        field: "socketEvent",
        message: "socketEvent is required for socket.broadcast",
      },
    ]);
  });

  describe("request-id policy", () => {
    const groups = [
      {
        name: "extraction-field variants",
        scenarios: [
          {
            name: "matches a top-level requestId request log to a reqId business event",
            records: [
              { level: 30, requestId: "request-match", request: { method: "GET" } },
              { level: 30, reqId: "independent-request-log", req: { method: "GET" } },
              {
                level: 30,
                event: "character.update",
                outcome: "success",
                actor: { userId: "user-1" },
                reqId: "request-match",
              },
            ],
            expected: [],
          },
          {
            name: "matches a nested req id request log",
            records: [
              { level: 30, req: { id: "nested-req", method: "GET" } },
              {
                level: 30,
                requestId: "independent-request-log",
                request: { method: "GET" },
              },
              {
                level: 30,
                event: "character.update",
                outcome: "success",
                actor: { userId: "user-1" },
                reqId: "nested-req",
              },
            ],
            expected: [],
          },
          {
            name: "matches a nested request id request log",
            records: [
              { level: 30, request: { id: "nested-request", method: "GET" } },
              { level: 30, reqId: "independent-request-log", req: { method: "GET" } },
              {
                level: 30,
                event: "character.update",
                outcome: "success",
                actor: { userId: "user-1" },
                requestId: "nested-request",
              },
            ],
            expected: [],
          },
        ],
      },
      {
        name: "malformed ids",
        scenarios: [
          {
            name: "rejects an empty reqId",
            records: [
              {
                level: 30,
                event: "character.update",
                outcome: "success",
                actor: { userId: "user-1" },
                reqId: "",
              },
            ],
            expected: [
              {
                record: 0,
                check: "request-id",
                field: "reqId",
                message: "request id must be a string",
              },
              {
                record: 0,
                check: "request-id",
                field: "requestId",
                message: "business event log is missing a request id",
              },
            ],
          },
          {
            name: "rejects a non-string requestId",
            records: [
              {
                level: 30,
                event: "character.update",
                outcome: "success",
                actor: { userId: "user-1" },
                requestId: 42,
              },
            ],
            expected: [
              {
                record: 0,
                check: "request-id",
                field: "requestId",
                message: "request id must be a string",
              },
              {
                record: 0,
                check: "request-id",
                field: "requestId",
                message: "business event log is missing a request id",
              },
            ],
          },
          {
            name: "rejects a non-string nested req id",
            records: [
              {
                level: 30,
                event: "character.update",
                outcome: "success",
                actor: { userId: "user-1" },
                req: { id: 42 },
              },
            ],
            expected: [
              {
                record: 0,
                check: "request-id",
                field: "req.id",
                message: "request id must be a string",
              },
              {
                record: 0,
                check: "request-id",
                field: "requestId",
                message: "business event log is missing a request id",
              },
            ],
          },
          {
            name: "rejects a non-string nested request id",
            records: [
              {
                level: 30,
                event: "character.update",
                outcome: "success",
                actor: { userId: "user-1" },
                request: { id: 42 },
              },
            ],
            expected: [
              {
                record: 0,
                check: "request-id",
                field: "request.id",
                message: "request id must be a string",
              },
              {
                record: 0,
                check: "request-id",
                field: "requestId",
                message: "business event log is missing a request id",
              },
            ],
          },
        ],
      },
      {
        name: "field disagreement",
        scenarios: [
          {
            name: "rejects disagreeing request id fields",
            records: [
              {
                level: 30,
                event: "character.update",
                outcome: "success",
                actor: { userId: "user-1" },
                reqId: "request-match",
                requestId: "other-request",
              },
            ],
            expected: [
              {
                record: 0,
                check: "request-id",
                field: "requestId",
                message: "request id fields disagree",
              },
              {
                record: 0,
                check: "request-id",
                field: "requestId",
                message: "business event log is missing a request id",
              },
            ],
          },
        ],
      },
      {
        name: "missing id and script exemption",
        scenarios: [
          {
            name: "exempts script-prefixed events but not a reversed prefix",
            records: [
              { level: 30, event: "script.logs-audit", outcome: "success" },
              { level: 30, event: "logs-audit.script.", outcome: "success" },
            ],
            expected: [
              {
                record: 1,
                check: "request-id",
                field: "requestId",
                message: "business event log is missing a request id",
              },
            ],
          },
        ],
      },
      {
        name: "request-log recognition",
        scenarios: [
          {
            name: "does not treat an ordinary log id as a request-log id",
            records: [
              { level: 30, reqId: "ordinary-only" },
              { level: 30, reqId: "real-request", req: { method: "GET" } },
              {
                level: 30,
                event: "character.update",
                outcome: "success",
                actor: { userId: "user-1" },
                reqId: "ordinary-only",
              },
            ],
            expected: [
              {
                record: 2,
                check: "request-id",
                field: "requestId",
                message: "business event request id has no matching request log",
              },
            ],
          },
          {
            name: "does not arm matching when a request envelope has no id",
            records: [
              { level: 30, req: { method: "GET" } },
              {
                level: 30,
                event: "character.update",
                outcome: "success",
                actor: { userId: "user-1" },
                reqId: "business-without-identifiable-request-log",
              },
            ],
            expected: [],
          },
          {
            name: "does not treat a business event id as its own request-log id",
            records: [
              { level: 30, reqId: "real-request", req: { method: "GET" } },
              {
                level: 30,
                event: "character.update",
                outcome: "success",
                actor: { userId: "user-1" },
                reqId: "self-only-business-id",
              },
            ],
            expected: [
              {
                record: 1,
                check: "request-id",
                field: "requestId",
                message: "business event request id has no matching request log",
              },
            ],
          },
          {
            name: "does not treat a business event request envelope as a request log",
            records: [
              { level: 30, reqId: "real-request", req: { method: "GET" } },
              {
                level: 30,
                event: "character.update",
                outcome: "success",
                actor: { userId: "user-1" },
                reqId: "business-envelope-id",
                req: { method: "POST" },
              },
            ],
            expected: [
              {
                record: 1,
                check: "request-id",
                field: "requestId",
                message: "business event request id has no matching request log",
              },
            ],
          },
        ],
      },
      {
        name: "unmatched ids",
        scenarios: [
          {
            name: "reports an unmatched id when an identifiable request log arms matching",
            records: [
              { level: 30, reqId: "real-request", req: { method: "GET" } },
              {
                level: 30,
                event: "character.update",
                outcome: "success",
                actor: { userId: "user-1" },
                reqId: "unmatched-but-no-request-log",
              },
            ],
            expected: [
              {
                record: 1,
                check: "request-id",
                field: "requestId",
                message: "business event request id has no matching request log",
              },
            ],
          },
        ],
      },
    ] satisfies readonly AuditScenarioGroup[];

    describe.each<AuditScenarioGroup>(groups)("$name", ({ scenarios }) => {
      it.each<AuditScenario>(scenarios)("$name", (scenario) => {
        expect.hasAssertions();
        expectAuditScenario("request-id", scenario);
      });
    });
  });

  describe("event-fields policy", () => {
    const groups = [
      {
        name: "event syntax and cardinality",
        scenarios: [
          {
            name: "rejects a non-string event",
            records: [{ level: 30, event: 7 }],
            expected: [
              {
                record: 0,
                check: "event-fields",
                field: "event",
                message: "event must be a string",
              },
            ],
          },
          {
            name: "rejects an empty event",
            records: [{ level: 30, event: "" }],
            expected: [
              {
                record: 0,
                check: "event-fields",
                field: "event",
                message: "event must be a string",
              },
            ],
          },
          {
            name: "rejects an event that starts with a number",
            records: [{ level: 30, event: "1character.update", outcome: "success" }],
            expected: [
              {
                record: 0,
                check: "event-fields",
                field: "event",
                message: "event must be a stable low-cardinality code",
              },
            ],
          },
          {
            name: "rejects an event with unstable punctuation",
            records: [{ level: 30, event: "character.update!", outcome: "success" }],
            expected: [
              {
                record: 0,
                check: "event-fields",
                field: "event",
                message: "event must be a stable low-cardinality code",
              },
            ],
          },
          {
            name: "rejects an event longer than eighty characters",
            records: [{ level: 30, event: `character.${"a".repeat(71)}`, outcome: "success" }],
            expected: [
              {
                record: 0,
                check: "event-fields",
                field: "event",
                message: "event must be a stable low-cardinality code",
              },
            ],
          },
          {
            name: "accepts an eighty-character event",
            records: [{ level: 30, event: `character.${"a".repeat(70)}`, outcome: "success" }],
            expected: [],
          },
        ],
      },
      {
        name: "outcome",
        scenarios: [
          {
            name: "rejects an empty outcome",
            records: [{ level: 30, event: "character.update", outcome: "" }],
            expected: [
              {
                record: 0,
                check: "event-fields",
                field: "outcome",
                message: "outcome is required for business events",
              },
            ],
          },
          {
            name: "rejects a missing outcome",
            records: [{ level: 30, event: "character.update" }],
            expected: [
              {
                record: 0,
                check: "event-fields",
                field: "outcome",
                message: "outcome is required for business events",
              },
            ],
          },
          {
            name: "rejects an unsupported mutation outcome",
            records: [{ level: 30, event: "character.update", outcome: "maybe" }],
            expected: [
              {
                record: 0,
                check: "event-fields",
                field: "outcome",
                message: "mutation outcome must be success or failure",
              },
            ],
          },
        ],
      },
      {
        name: "mutation/default family",
        scenarios: [
          {
            name: "applies mutation/default policy to an unknown event family",
            records: [{ level: 30, event: "workflow.transition", outcome: "failure" }],
            expected: [
              {
                record: 0,
                check: "event-fields",
                field: "reason",
                message: "reason is required for failure outcomes",
              },
            ],
          },
        ],
      },
      {
        name: "reason",
        scenarios: [
          {
            name: "requires a reason for failure outcomes",
            records: [{ level: 30, event: "character.update", outcome: "failure" }],
            expected: [
              {
                record: 0,
                check: "event-fields",
                field: "reason",
                message: "reason is required for failure outcomes",
              },
            ],
          },
          {
            name: "rejects an empty reason",
            records: [{ level: 30, event: "character.update", outcome: "failure", reason: "" }],
            expected: [
              {
                record: 0,
                check: "event-fields",
                field: "reason",
                message: "reason must be a string",
              },
            ],
          },
          {
            name: "rejects an unstable reason",
            records: [
              {
                level: 30,
                event: "character.update",
                outcome: "failure",
                reason: "validation failed",
              },
            ],
            expected: [
              {
                record: 0,
                check: "event-fields",
                field: "reason",
                message: "reason must be a stable low-cardinality code",
              },
            ],
          },
          {
            name: "accepts a stable failure reason",
            records: [
              {
                level: 30,
                event: "character.update",
                outcome: "failure",
                reason: "validation.failed",
              },
            ],
            expected: [],
          },
        ],
      },
      {
        name: "actor",
        scenarios: [
          {
            name: "rejects a non-object actor",
            records: [
              { level: 30, event: "character.update", outcome: "success", actor: "user-1" },
            ],
            expected: [
              {
                record: 0,
                check: "event-fields",
                field: "actor",
                message: "actor is required with userId",
              },
            ],
          },
          {
            name: "rejects an actor without a userId",
            records: [{ level: 30, event: "character.update", outcome: "success", actor: {} }],
            expected: [
              {
                record: 0,
                check: "event-fields",
                field: "actor.userId",
                message: "actor.userId must be a string",
              },
            ],
          },
          {
            name: "rejects an actor with an empty userId",
            records: [
              {
                level: 30,
                event: "character.update",
                outcome: "success",
                actor: { userId: "" },
              },
            ],
            expected: [
              {
                record: 0,
                check: "event-fields",
                field: "actor.userId",
                message: "actor.userId must be a string",
              },
            ],
          },
        ],
      },
      {
        name: "authz",
        scenarios: [
          {
            name: "requires an actor for authz events",
            records: [{ level: 30, event: "authz.campaign.member", outcome: "allow" }],
            expected: [
              {
                record: 0,
                check: "event-fields",
                field: "actor",
                message: "actor is required with userId",
              },
            ],
          },
          {
            name: "rejects an unsupported authz outcome",
            records: [
              {
                level: 30,
                event: "authz.campaign.member",
                outcome: "blocked",
                actor: { userId: "user-1" },
              },
            ],
            expected: [
              {
                record: 0,
                check: "event-fields",
                field: "outcome",
                message: "authz outcome must be allow or deny",
              },
            ],
          },
          {
            name: "requires a reason for denied authz events",
            records: [
              {
                level: 30,
                event: "authz.campaign.member",
                outcome: "deny",
                actor: { userId: "user-1" },
              },
            ],
            expected: [
              {
                record: 0,
                check: "event-fields",
                field: "reason",
                message: "reason is required for deny outcomes",
              },
            ],
          },
          {
            name: "accepts a stable denied authz reason",
            records: [
              {
                level: 30,
                event: "authz.campaign.member",
                outcome: "deny",
                actor: { userId: "user-1" },
                reason: "not.owner",
              },
            ],
            expected: [],
          },
        ],
      },
      {
        name: "socket event",
        scenarios: [
          {
            name: "rejects an unsupported broadcast outcome and missing socketEvent",
            records: [{ level: 30, event: "socket.broadcast", outcome: "queued" }],
            expected: [
              {
                record: 0,
                check: "event-fields",
                field: "outcome",
                message: "socket.broadcast outcome must be success or skipped",
              },
              {
                record: 0,
                check: "event-fields",
                field: "socketEvent",
                message: "socketEvent is required for socket.broadcast",
              },
            ],
          },
          {
            name: "requires socketEvent for successful broadcasts",
            records: [{ level: 30, event: "socket.broadcast", outcome: "success" }],
            expected: [
              {
                record: 0,
                check: "event-fields",
                field: "socketEvent",
                message: "socketEvent is required for socket.broadcast",
              },
            ],
          },
          {
            name: "rejects an empty socketEvent",
            records: [
              { level: 30, event: "socket.broadcast", outcome: "success", socketEvent: "" },
            ],
            expected: [
              {
                record: 0,
                check: "event-fields",
                field: "socketEvent",
                message: "socketEvent is required for socket.broadcast",
              },
            ],
          },
          {
            name: "rejects an unstable socketEvent",
            records: [
              {
                level: 30,
                event: "socket.broadcast",
                outcome: "success",
                socketEvent: "Campaign Updated",
              },
            ],
            expected: [
              {
                record: 0,
                check: "event-fields",
                field: "socketEvent",
                message: "socketEvent must be a stable low-cardinality code",
              },
            ],
          },
          {
            name: "requires a reason for skipped broadcasts",
            records: [
              {
                level: 30,
                event: "socket.broadcast",
                outcome: "skipped",
                socketEvent: "campaign.updated",
              },
            ],
            expected: [
              {
                record: 0,
                check: "event-fields",
                field: "reason",
                message: "reason is required for skipped outcomes",
              },
            ],
          },
          {
            name: "accepts a stable skipped broadcast reason",
            records: [
              {
                level: 30,
                event: "socket.broadcast",
                outcome: "skipped",
                socketEvent: "campaign.updated",
                reason: "no.listeners",
              },
            ],
            expected: [],
          },
        ],
      },
      {
        name: "script exemption",
        scenarios: [
          {
            name: "exempts script-prefixed events",
            records: [{ level: 30, event: "script.logs-audit", outcome: "whatever" }],
            expected: [],
          },
          {
            name: "does not exempt a reversed script prefix",
            records: [{ level: 30, event: "logs-audit.script.", outcome: "whatever" }],
            expected: [
              {
                record: 0,
                check: "event-fields",
                field: "event",
                message: "event must be a stable low-cardinality code",
              },
              {
                record: 0,
                check: "event-fields",
                field: "outcome",
                message: "mutation outcome must be success or failure",
              },
            ],
          },
        ],
      },
    ] satisfies readonly AuditScenarioGroup[];

    describe.each<AuditScenarioGroup>(groups)("$name", ({ scenarios }) => {
      it.each<AuditScenario>(scenarios)("$name", (scenario) => {
        expect.hasAssertions();
        expectAuditScenario("event-fields", scenario);
      });
    });
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
        redactionKind: "sensitive-field",
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

describe("runLogsAudit --latest", () => {
  const tmpRepo = registerTempRootCleanup();

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function makeTempRoot(): string {
    return tmpRepo.makeTempRepo("logs-audit-latest-");
  }

  function writeLog(root: string, relativePath: string, contents: string, mtime: Date): string {
    const filePath = path.join(root, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, contents, "utf8");
    utimesSync(filePath, mtime, mtime);
    return filePath;
  }

  it("selects the newest compatible verify or hook JSONL log", () => {
    const root = makeTempRoot();
    const verifyLogs = path.join(root, "verify");
    const hookLogs = path.join(root, "hook");
    const older = writeLog(
      verifyLogs,
      "server.jsonl",
      '{"message":"older"}\n',
      new Date("2026-01-01T00:00:00.000Z"),
    );
    const newer = writeLog(
      hookLogs,
      "server.jsonl",
      '{"message":"newer"}\n',
      new Date("2026-01-02T00:00:00.000Z"),
    );
    writeLog(hookLogs, "test.log", "plain task output\n", new Date("2026-01-03T00:00:00.000Z"));

    expect(findLatestCompatibleLogFiles([verifyLogs, hookLogs])).toEqual([newer]);

    const result = runLogsAudit({
      argv: ["--latest"],
      latestLogRoots: [verifyLogs, hookLogs],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`${newer}: 1 record(s), 0 rejected line(s)`);
    expect(result.stdout).not.toContain(older);
  });

  it("selects a single deterministic newest log when roots tie on mtime", () => {
    const root = makeTempRoot();
    const verifyLogs = path.join(root, "verify");
    const hookLogs = path.join(root, "hook");
    const tie = new Date("2026-01-01T00:00:00.000Z");
    const verifyLog = writeLog(verifyLogs, "server.jsonl", '{"message":"verify"}\n', tie);
    const hookLog = writeLog(hookLogs, "server.jsonl", '{"message":"hook"}\n', tie);

    const selected = findLatestCompatibleLogFiles([verifyLogs, hookLogs]);

    expect(selected).toHaveLength(1);
    expect(selected).toEqual([[verifyLog, hookLog].sort((l, r) => l.localeCompare(r))[0]]);
  });

  it("deduplicates latest roots that resolve to the same directory", () => {
    const root = makeTempRoot();
    const latest = writeLog(
      root,
      "server.jsonl",
      '{"message":"latest"}\n',
      new Date("2026-01-01T00:00:00.000Z"),
    );

    expect(findLatestCompatibleLogFiles([root, `${root}${path.sep}`])).toEqual([latest]);
  });

  it("no-ops with a bounded hint when no compatible logs exist", () => {
    const root = makeTempRoot();
    const verifyLogs = path.join(root, "verify");
    const hookLogs = path.join(root, "hook");
    writeLog(verifyLogs, "lint.log", "plain lint output\n", new Date("2026-01-01T00:00:00.000Z"));

    const result = runLogsAudit({
      argv: ["--latest"],
      latestLogRoots: [verifyLogs, hookLogs],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchInlineSnapshot(
      `"logs:audit --latest: no compatible JSONL logs found in verify/hook log dirs; run \`bun run verify:changed\` to populate logs before retrying."`,
    );
    expect(result.report).toBeUndefined();
  });

  it("keeps malformed explicitly selected logs as hard failures", () => {
    const result = runLogsAudit({
      argv: ["server.jsonl"],
      readFile: () => "not-json\n",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("ERROR jsonl: server.jsonl:1 - line is not valid JSON");
  });

  it("fails when the newest compatible latest log is malformed", () => {
    const root = makeTempRoot();
    const latest = writeLog(
      root,
      "server.jsonl",
      "not-json\n",
      new Date("2026-01-01T00:00:00.000Z"),
    );

    const result = runLogsAudit({
      argv: ["--latest"],
      latestLogRoots: [root],
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(`ERROR jsonl: ${latest}:1 - line is not valid JSON`);
  });

  // A missing env contract and an empty log directory are different conditions
  // and must never share an exit code: `--latest` with no logs stays the
  // landed graceful-degradation zero (docs/ai-harness.md), while an unrouted
  // `--latest` is a CLI misuse and joins the file's other exit-2 cases.
  it("fails closed with exit 2 when no log directories were configured", () => {
    const result = runLogsAudit({ argv: ["--latest"], latestLogRoots: [] });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toMatchInlineSnapshot(
      `"logs:audit --latest: no verify/hook log directories configured. Run \`bun run logs:audit --latest\`: the package script's shell shim exports MUSI_STANDARD_VERIFY_LOG_DIR and MUSI_STANDARD_BUN_LOG_DIR from scripts/lib/verify-metadata.sh, and a direct \`bun scripts/logs-audit.ts --latest\` no longer derives them."`,
    );
    expect(result.report).toBeUndefined();
  });

  it("reads the process env when no roots are injected", () => {
    vi.stubEnv("MUSI_VERIFY_LOG_DIR", undefined);
    vi.stubEnv("MUSI_STANDARD_VERIFY_LOG_DIR", undefined);
    vi.stubEnv("AI_BUN_LOG_DIR", undefined);
    vi.stubEnv("MUSI_STANDARD_BUN_LOG_DIR", undefined);
    // Present but irrelevant: these are the inputs the deleted TypeScript
    // derivation used to consume, so leaving them set proves nothing
    // reconstructs a path from them.
    vi.stubEnv("REPO_ROOT", "/nonexistent/repo");
    vi.stubEnv("MUSI_VERIFY_STATE_ROOT", "/nonexistent/state");

    const missing = runLogsAudit({ argv: ["--latest"] });
    expect(missing.exitCode).toBe(2);
    expect(missing.stdout).toContain("no verify/hook log directories configured");

    const root = makeTempRoot();
    const latest = writeLog(
      root,
      "server.jsonl",
      '{"message":"latest"}\n',
      new Date("2026-01-01T00:00:00.000Z"),
    );
    vi.stubEnv("MUSI_STANDARD_VERIFY_LOG_DIR", root);

    const found = runLogsAudit({ argv: ["--latest"] });
    expect(found.exitCode).toBe(0);
    expect(found.stdout).toContain(latest);
  });
});

describe("defaultLatestLogRoots", () => {
  it("resolves the override env var ahead of the standard one", () => {
    expect(
      defaultLatestLogRoots({
        AI_BUN_LOG_DIR: "/hook/override",
        MUSI_STANDARD_BUN_LOG_DIR: "/hook/standard",
        MUSI_STANDARD_VERIFY_LOG_DIR: "/verify/standard",
        MUSI_VERIFY_LOG_DIR: "/verify/override",
      }),
    ).toEqual(["/verify/override", "/hook/override"]);
  });

  it("keeps whichever directory the env supplies and drops duplicates", () => {
    expect(defaultLatestLogRoots({ MUSI_STANDARD_VERIFY_LOG_DIR: "/only/verify" })).toEqual([
      "/only/verify",
    ]);
    expect(defaultLatestLogRoots({ AI_BUN_LOG_DIR: "/only/hook" })).toEqual(["/only/hook"]);
    expect(
      defaultLatestLogRoots({
        MUSI_STANDARD_BUN_LOG_DIR: "/same/dir",
        MUSI_STANDARD_VERIFY_LOG_DIR: "/same/dir",
      }),
    ).toEqual(["/same/dir"]);
  });

  // Bash's `${MUSI_VERIFY_LOG_DIR:-…}` — the form every shell reader of these
  // names uses (scripts/verify.sh, scripts/land.sh, scripts/verify-logs.sh,
  // scripts/ai-hooks/stop-policy.sh, scripts/ai-hooks/session-state.sh) —
  // treats a set-but-empty override as unset and falls back to the standard
  // directory. A wrapper that exports MUSI_VERIFY_LOG_DIR="" (unset
  // interpolation, an empty CI input) therefore has verify.sh writing to the
  // standard dir; reading `??` here instead would drop that whole log family
  // and audit only the hook log, with no error and exit 0 — the same silent
  // divergence this module exists to remove.
  it("treats a set-but-empty override as unset, like every shell reader", () => {
    expect(
      defaultLatestLogRoots({
        AI_BUN_LOG_DIR: "",
        MUSI_STANDARD_BUN_LOG_DIR: "/hook/standard",
        MUSI_STANDARD_VERIFY_LOG_DIR: "/verify/standard",
        MUSI_VERIFY_LOG_DIR: "",
      }),
    ).toEqual(["/verify/standard", "/hook/standard"]);
    expect(
      defaultLatestLogRoots({
        MUSI_STANDARD_VERIFY_LOG_DIR: "/verify/standard",
        MUSI_VERIFY_LOG_DIR: "",
      }),
    ).toEqual(["/verify/standard"]);
  });

  it("reports nothing configured only when neither name carries a value", () => {
    expect(
      defaultLatestLogRoots({
        AI_BUN_LOG_DIR: "",
        MUSI_STANDARD_BUN_LOG_DIR: "",
        MUSI_STANDARD_VERIFY_LOG_DIR: "",
        MUSI_VERIFY_LOG_DIR: "",
      }),
    ).toEqual([]);
  });

  // Regression pin for the defect this module was built around: it used to
  // rebuild scripts/lib/verify-metadata.sh's state-path protocol from
  // REPO_ROOT and MUSI_VERIFY_STATE_ROOT whenever no log dir was exported, so
  // a bash-side layout change left `--latest` reading a directory nobody
  // writes to and reporting "no compatible logs". These are declared outside
  // the literal so the excess-property check does not hide the point: they are
  // no longer inputs at all.
  it("never reconstructs a state path from the old derivation inputs", () => {
    const retiredDerivationInputs: Record<string, string> = {
      MUSI_VERIFY_STATE_ROOT: "/state-root",
      REPO_ROOT: "/repo-root",
    };

    expect(defaultLatestLogRoots(retiredDerivationInputs)).toEqual([]);
    expect(defaultLatestLogRoots({})).toEqual([]);
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
    // The projection contract is that the `line` key is absent, not
    // present-and-undefined: `entry?.line` being undefined is satisfied by both
    // shapes, so guard the key's absence explicitly the same way `reason` is.
    expect(entry === undefined ? {} : entry).not.toHaveProperty("line");
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
  const tmpRepo = registerTempRootCleanup();

  beforeEach(() => {
    vi.stubEnv(HARNESS_DIAGNOSTICS_OUTPUT_ENV, undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function makeTempRoot(): string {
    return tmpRepo.makeTempRepo("logs-audit-diagnostics-");
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
