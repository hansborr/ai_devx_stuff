import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { parseArgs } from "./cli-args.js";
import type { DAEMON_REQUEST_SCHEMA } from "./daemon-protocol.js";
import {
  buildPingRequest,
  CODE_INTEL_DAEMON_PROTOCOL_VERSION,
  type CodeIntelDaemonRequest,
  decodeDaemonRequest,
  isPongResult,
} from "./daemon-protocol.js";

type IsAssignable<From, To> = [From] extends [To] ? true : false;
type AssertAssignable<Assignable extends true> = Assignable;
export type RequestSchemaMutualAssignability = [
  AssertAssignable<IsAssignable<CodeIntelDaemonRequest, z.output<typeof DAEMON_REQUEST_SCHEMA>>>,
  AssertAssignable<IsAssignable<z.output<typeof DAEMON_REQUEST_SCHEMA>, CodeIntelDaemonRequest>>,
];

describe("code:intel daemon protocol", () => {
  const routableCommands: CodeIntelDaemonRequest["command"][] = [
    { kind: "def", location: { col: 14, file: "scripts/example.ts", line: 3 } },
    { kind: "defName", name: "example" },
    { kind: "exports", file: "scripts/example.ts" },
    {
      depth: 2,
      excludeTests: true,
      file: "scripts/example.ts",
      kind: "dependents",
      limit: 10,
      project: "server",
    },
    {
      kind: "refs",
      limit: 5,
      location: { col: 14, file: "scripts/example.ts", line: 3 },
    },
    {
      depth: 1,
      file: "scripts/example.ts",
      kind: "tests",
      limit: 4,
      project: "shared",
    },
    { kind: "ping" },
  ];

  it.each(routableCommands)("decodes the $kind request arm", (command) => {
    const request: CodeIntelDaemonRequest = {
      command,
      id: `request-${command.kind}`,
      protocolVersion: CODE_INTEL_DAEMON_PROTOCOL_VERSION,
    };

    expect(decodeDaemonRequest(JSON.stringify(request))).toEqual({
      kind: "ok",
      request,
    });
  });

  it("restores the default tests depth after JSON serialization", () => {
    const command = parseArgs(["tests", "scripts/example.ts"]).command;
    if (command.kind !== "tests") throw new Error("expected tests command");
    const request: CodeIntelDaemonRequest = {
      command,
      id: "default-tests",
      protocolVersion: CODE_INTEL_DAEMON_PROTOCOL_VERSION,
    };
    const payload = JSON.stringify(request);

    expect(payload).toContain('"depth":null');
    expect(decodeDaemonRequest(payload)).toEqual({ kind: "ok", request });
  });

  it.each([
    { command: { kind: "def" }, id: "missing-location" },
    { command: { file: "scripts/example.ts", kind: "overview" }, id: "overview" },
    { command: { kind: "unknown" }, id: "unknown" },
    {
      command: { file: "scripts/example.ts", kind: "exports", surprise: true },
      id: "extra-field",
    },
  ])("rejects an undecodable request while preserving string id $id", (request) => {
    expect(
      decodeDaemonRequest(
        JSON.stringify({
          ...request,
          protocolVersion: CODE_INTEL_DAEMON_PROTOCOL_VERSION,
        }),
      ),
    ).toMatchObject({ id: request.id, kind: "error" });
  });

  it("rejects a non-string id instead of promoting it to the request type", () => {
    expect(
      decodeDaemonRequest(
        JSON.stringify({
          command: { kind: "defName", name: "example" },
          id: 42,
          protocolVersion: CODE_INTEL_DAEMON_PROTOCOL_VERSION,
        }),
      ),
    ).toMatchObject({ id: "unknown", kind: "error" });
  });

  it("builds and recognizes only the declared ping/pong lifecycle arms", () => {
    expect(buildPingRequest("probe-id")).toEqual({
      command: { kind: "ping" },
      id: "probe-id",
      protocolVersion: CODE_INTEL_DAEMON_PROTOCOL_VERSION,
    });
    expect(isPongResult({ kind: "pong" })).toBe(true);
    expect(isPongResult({ kind: "results", header: "pong", results: [] })).toBe(false);
  });
});
