import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { auditJsonlText, formatJson, formatText, parseArgs, runLogsAudit } from "./logs-audit.js";

const fixtureDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "logs-audit",
  "fixtures",
);

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
