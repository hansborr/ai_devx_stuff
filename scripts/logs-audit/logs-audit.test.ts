import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
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
  findLatestCompatibleLogFiles,
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
import { isJsonObject } from "./logs-audit-redaction.js";

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
        file: "sensitive-keys.jsonl",
        line: 1,
        field: "body",
        message: "sensitive field 'body' is not redacted",
      },
      {
        check: "redaction",
        file: "sensitive-keys.jsonl",
        line: 1,
        field: "cookies",
        message: "sensitive field 'cookies' is not redacted",
      },
      {
        check: "redaction",
        file: "sensitive-keys.jsonl",
        line: 1,
        field: "input",
        message: "sensitive field 'input' is not redacted",
      },
      {
        check: "redaction",
        file: "sensitive-keys.jsonl",
        line: 1,
        field: "password",
        message: "sensitive field 'password' is not redacted",
      },
      {
        check: "redaction",
        file: "sensitive-keys.jsonl",
        line: 1,
        field: "raw_body",
        message: "sensitive field 'raw_body' is not redacted",
      },
      {
        check: "redaction",
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
        file: "url-query.jsonl",
        line: 1,
        field: "req.request_url?accessToken",
        message: "sensitive query parameter 'accessToken' is not redacted",
      },
      {
        check: "redaction",
        file: "url-query.jsonl",
        line: 1,
        field: "req.request_url?authorization",
        message: "sensitive query parameter 'authorization' is not redacted",
      },
      {
        check: "redaction",
        file: "url-query.jsonl",
        line: 1,
        field: "req.request_url?cookie",
        message: "sensitive query parameter 'cookie' is not redacted",
      },
      {
        check: "redaction",
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
        file: "array-redaction.jsonl",
        line: 1,
        field: "events[0].token",
        message: "sensitive field 'events[0].token' is not redacted",
      },
      {
        check: "redaction",
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

  it("distinguishes JSON objects from arrays, null, and primitives", () => {
    expect(isJsonObject({ ok: true })).toBe(true);
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject("plain")).toBe(false);
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

  it("reports request-id diagnostics with exact fields and matching semantics", () => {
    const report = auditJsonlText(
      "request-ids.jsonl",
      [
        JSON.stringify({ level: 30, requestId: "request-match", request: { method: "GET" } }),
        JSON.stringify({
          level: 30,
          event: "character.update",
          outcome: "success",
          actor: { userId: "user-1" },
          reqId: "request-match",
        }),
        JSON.stringify({ level: 30, req: { id: "nested-req", method: "GET" } }),
        JSON.stringify({
          level: 30,
          event: "character.update",
          outcome: "success",
          actor: { userId: "user-1" },
          reqId: "nested-req",
        }),
        JSON.stringify({ level: 30, request: { id: "nested-request", method: "GET" } }),
        JSON.stringify({
          level: 30,
          event: "character.update",
          outcome: "success",
          actor: { userId: "user-1" },
          requestId: "nested-request",
        }),
        JSON.stringify({
          level: 30,
          event: "character.update",
          outcome: "success",
          actor: { userId: "user-1" },
          reqId: "",
        }),
        JSON.stringify({
          level: 30,
          event: "character.update",
          outcome: "success",
          actor: { userId: "user-1" },
          requestId: 42,
        }),
        JSON.stringify({
          level: 30,
          event: "character.update",
          outcome: "success",
          actor: { userId: "user-1" },
          req: { id: 42 },
        }),
        JSON.stringify({
          level: 30,
          event: "character.update",
          outcome: "success",
          actor: { userId: "user-1" },
          request: { id: 42 },
        }),
        JSON.stringify({
          level: 30,
          event: "character.update",
          outcome: "success",
          actor: { userId: "user-1" },
          reqId: "request-match",
          requestId: "other-request",
        }),
        JSON.stringify({ level: 30, event: "script.logs-audit", outcome: "success" }),
        JSON.stringify({ level: 30, event: "logs-audit.script.", outcome: "success" }),
        JSON.stringify({ level: 30, reqId: "ordinary-only" }),
        JSON.stringify({ level: 30, reqId: "real-request", req: { method: "GET" } }),
        JSON.stringify({
          level: 30,
          event: "character.update",
          outcome: "success",
          actor: { userId: "user-1" },
          reqId: "ordinary-only",
        }),
        JSON.stringify({ level: 30, req: { method: "GET" } }),
        JSON.stringify({
          level: 30,
          event: "character.update",
          outcome: "success",
          actor: { userId: "user-1" },
          reqId: "unmatched-but-no-request-log",
        }),
        JSON.stringify({
          level: 30,
          event: "character.update",
          outcome: "success",
          actor: { userId: "user-1" },
          reqId: "self-only-business-id",
        }),
        JSON.stringify({
          level: 30,
          event: "character.update",
          outcome: "success",
          actor: { userId: "user-1" },
          reqId: "business-envelope-id",
          req: { method: "POST" },
        }),
      ].join("\n"),
    );

    const reportWithUnidentifiedRequestLog = auditJsonlText(
      "unidentified-request-log.jsonl",
      [
        JSON.stringify({ level: 30, req: { method: "GET" } }),
        JSON.stringify({
          level: 30,
          event: "character.update",
          outcome: "success",
          actor: { userId: "user-1" },
          reqId: "business-without-identifiable-request-log",
        }),
      ].join("\n"),
    );

    expect(report.findings.filter((finding) => finding.check === "request-id")).toEqual([
      {
        check: "request-id",
        file: "request-ids.jsonl",
        line: 7,
        field: "reqId",
        message: "request id must be a string",
      },
      {
        check: "request-id",
        file: "request-ids.jsonl",
        line: 8,
        field: "requestId",
        message: "request id must be a string",
      },
      {
        check: "request-id",
        file: "request-ids.jsonl",
        line: 9,
        field: "req.id",
        message: "request id must be a string",
      },
      {
        check: "request-id",
        file: "request-ids.jsonl",
        line: 10,
        field: "request.id",
        message: "request id must be a string",
      },
      {
        check: "request-id",
        file: "request-ids.jsonl",
        line: 11,
        field: "requestId",
        message: "request id fields disagree",
      },
      {
        check: "request-id",
        file: "request-ids.jsonl",
        line: 7,
        field: "requestId",
        message: "business event log is missing a request id",
      },
      {
        check: "request-id",
        file: "request-ids.jsonl",
        line: 8,
        field: "requestId",
        message: "business event log is missing a request id",
      },
      {
        check: "request-id",
        file: "request-ids.jsonl",
        line: 9,
        field: "requestId",
        message: "business event log is missing a request id",
      },
      {
        check: "request-id",
        file: "request-ids.jsonl",
        line: 10,
        field: "requestId",
        message: "business event log is missing a request id",
      },
      {
        check: "request-id",
        file: "request-ids.jsonl",
        line: 11,
        field: "requestId",
        message: "business event log is missing a request id",
      },
      {
        check: "request-id",
        file: "request-ids.jsonl",
        line: 13,
        field: "requestId",
        message: "business event log is missing a request id",
      },
      {
        check: "request-id",
        file: "request-ids.jsonl",
        line: 16,
        field: "requestId",
        message: "business event request id has no matching request log",
      },
      {
        check: "request-id",
        file: "request-ids.jsonl",
        line: 18,
        field: "requestId",
        message: "business event request id has no matching request log",
      },
      {
        check: "request-id",
        file: "request-ids.jsonl",
        line: 19,
        field: "requestId",
        message: "business event request id has no matching request log",
      },
      {
        check: "request-id",
        file: "request-ids.jsonl",
        line: 20,
        field: "requestId",
        message: "business event request id has no matching request log",
      },
    ]);
    expect(
      reportWithUnidentifiedRequestLog.findings.filter((finding) => finding.check === "request-id"),
    ).toEqual([]);
  });

  it("reports each business event field convention with exact diagnostics", () => {
    const stableEightyCharacterEvent = `character.${"a".repeat(70)}`;
    const report = auditJsonlText(
      "event-fields.jsonl",
      [
        JSON.stringify({ level: 30, event: 7 }),
        JSON.stringify({ level: 30, event: "" }),
        JSON.stringify({ level: 30, event: "1character.update", outcome: "success" }),
        JSON.stringify({ level: 30, event: "character.update!", outcome: "success" }),
        JSON.stringify({ level: 30, event: `character.${"a".repeat(71)}`, outcome: "success" }),
        JSON.stringify({ level: 30, event: stableEightyCharacterEvent, outcome: "success" }),
        JSON.stringify({ level: 30, event: "character.update", outcome: "" }),
        JSON.stringify({ level: 30, event: "character.update" }),
        JSON.stringify({ level: 30, event: "character.update", outcome: "failure" }),
        JSON.stringify({
          level: 30,
          event: "character.update",
          outcome: "failure",
          reason: "",
        }),
        JSON.stringify({
          level: 30,
          event: "character.update",
          outcome: "failure",
          reason: "validation failed",
        }),
        JSON.stringify({
          level: 30,
          event: "character.update",
          outcome: "failure",
          reason: "validation.failed",
        }),
        JSON.stringify({ level: 30, event: "character.update", outcome: "maybe" }),
        JSON.stringify({
          level: 30,
          event: "character.update",
          outcome: "success",
          actor: "user-1",
        }),
        JSON.stringify({
          level: 30,
          event: "character.update",
          outcome: "success",
          actor: {},
        }),
        JSON.stringify({
          level: 30,
          event: "character.update",
          outcome: "success",
          actor: { userId: "" },
        }),
        JSON.stringify({ level: 30, event: "authz.campaign.member", outcome: "allow" }),
        JSON.stringify({
          level: 30,
          event: "authz.campaign.member",
          outcome: "blocked",
          actor: { userId: "user-1" },
        }),
        JSON.stringify({
          level: 30,
          event: "authz.campaign.member",
          outcome: "deny",
          actor: { userId: "user-1" },
        }),
        JSON.stringify({
          level: 30,
          event: "authz.campaign.member",
          outcome: "deny",
          actor: { userId: "user-1" },
          reason: "not.owner",
        }),
        JSON.stringify({ level: 30, event: "socket.broadcast", outcome: "queued" }),
        JSON.stringify({ level: 30, event: "socket.broadcast", outcome: "success" }),
        JSON.stringify({
          level: 30,
          event: "socket.broadcast",
          outcome: "success",
          socketEvent: "",
        }),
        JSON.stringify({
          level: 30,
          event: "socket.broadcast",
          outcome: "success",
          socketEvent: "Campaign Updated",
        }),
        JSON.stringify({
          level: 30,
          event: "socket.broadcast",
          outcome: "skipped",
          socketEvent: "campaign.updated",
        }),
        JSON.stringify({
          level: 30,
          event: "socket.broadcast",
          outcome: "skipped",
          socketEvent: "campaign.updated",
          reason: "no.listeners",
        }),
        JSON.stringify({ level: 30, event: "script.logs-audit", outcome: "whatever" }),
        JSON.stringify({ level: 30, event: "logs-audit.script.", outcome: "whatever" }),
      ].join("\n"),
    );

    expect(report.findings.filter((finding) => finding.check === "event-fields")).toEqual([
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 1,
        field: "event",
        message: "event must be a string",
      },
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 2,
        field: "event",
        message: "event must be a string",
      },
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 3,
        field: "event",
        message: "event must be a stable low-cardinality code",
      },
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 4,
        field: "event",
        message: "event must be a stable low-cardinality code",
      },
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 5,
        field: "event",
        message: "event must be a stable low-cardinality code",
      },
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 7,
        field: "outcome",
        message: "outcome is required for business events",
      },
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 8,
        field: "outcome",
        message: "outcome is required for business events",
      },
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 9,
        field: "reason",
        message: "reason is required for failure outcomes",
      },
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 10,
        field: "reason",
        message: "reason must be a string",
      },
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 11,
        field: "reason",
        message: "reason must be a stable low-cardinality code",
      },
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 13,
        field: "outcome",
        message: "mutation outcome must be success or failure",
      },
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 14,
        field: "actor",
        message: "actor is required with userId",
      },
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 15,
        field: "actor.userId",
        message: "actor.userId must be a string",
      },
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 16,
        field: "actor.userId",
        message: "actor.userId must be a string",
      },
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 17,
        field: "actor",
        message: "actor is required with userId",
      },
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 18,
        field: "outcome",
        message: "authz outcome must be allow or deny",
      },
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 19,
        field: "reason",
        message: "reason is required for deny outcomes",
      },
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 21,
        field: "outcome",
        message: "socket.broadcast outcome must be success or skipped",
      },
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 21,
        field: "socketEvent",
        message: "socketEvent is required for socket.broadcast",
      },
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 22,
        field: "socketEvent",
        message: "socketEvent is required for socket.broadcast",
      },
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 23,
        field: "socketEvent",
        message: "socketEvent is required for socket.broadcast",
      },
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 24,
        field: "socketEvent",
        message: "socketEvent must be a stable low-cardinality code",
      },
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 25,
        field: "reason",
        message: "reason is required for skipped outcomes",
      },
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 28,
        field: "event",
        message: "event must be a stable low-cardinality code",
      },
      {
        check: "event-fields",
        file: "event-fields.jsonl",
        line: 28,
        field: "outcome",
        message: "mutation outcome must be success or failure",
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

describe("runLogsAudit --latest", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root !== undefined) rmSync(root, { recursive: true, force: true });
    }
  });

  function makeTempRoot(): string {
    const root = mkdtempSync(path.join(tmpdir(), "logs-audit-latest-"));
    tempRoots.push(root);
    return root;
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
