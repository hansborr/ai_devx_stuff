import { z } from "zod";

import { isRecord } from "../lib/records.js";
import type {
  CodeIntelQueryResult,
  ExecutableCliCommand,
  IntelResult,
  ProjectFilter,
  SourceLocation,
} from "./types.js";

// v2 (backlog unit 109-S3): the supported-scope guard now covers every
// single-file command, and a stale pre-S3 daemon lacks that guard, so its
// answers would diverge from one-shot runs. Bumping the version retires such
// daemons through the existing checks: clients fall back to one-shot on the
// metadata mismatch and the server CLI reports the old daemon as stale, so
// stale semantics never keep serving silently.
// v3 (backlog unit 133): ping/pong is now a declared lifecycle arm and request
// command interiors are decoded at the socket boundary. A stale v2 daemon's
// fabricated query-result pong must be retired before the lifecycle probe can
// require the new pong arm, so version skew takes the stale-restart path.
export const CODE_INTEL_DAEMON_PROTOCOL_VERSION = 3;

// Wire-level error name the daemon tags on fallback responses (protocol-version
// mismatch / non-routable command). Consumers branch on it to choose graceful
// one-shot fallback over throwing, so producer and consumers must share one source.
export const DAEMON_FALLBACK_ERROR_NAME = "CodeIntelDaemonFallback";

// Lifecycle ping maps to its dedicated pong result below; this table binds only
// executable query commands to their IntelResult discriminator.
const RESULT_KIND_BY_COMMAND = {
  def: "definition",
  defName: "definition",
  dependents: "dependent",
  exports: "export",
  overview: undefined,
  refs: "reference",
  tests: "test",
} as const satisfies Record<ExecutableCliCommand["kind"], IntelResult["kind"] | undefined>;

type CodeIntelDaemonProtocolVersion = typeof CODE_INTEL_DAEMON_PROTOCOL_VERSION;

export type DaemonRoutableCommand = Extract<
  ExecutableCliCommand,
  { kind: "def" | "defName" | "dependents" | "exports" | "refs" | "tests" }
>;

type CodeIntelDaemonPingCommand = { kind: "ping" };

export type CodeIntelDaemonRequest = {
  command: CodeIntelDaemonPingCommand | DaemonRoutableCommand;
  id: string;
  protocolVersion: CodeIntelDaemonProtocolVersion;
};

export type CodeIntelDaemonQueryRequest = Omit<CodeIntelDaemonRequest, "command"> & {
  command: DaemonRoutableCommand;
};

export type CodeIntelDaemonError = {
  message: string;
  name: string;
};

export type CodeIntelDaemonPongResult = { kind: "pong" };

type CodeIntelDaemonQueryResponse = {
  id: string;
  ok: true;
  protocolVersion: CodeIntelDaemonProtocolVersion;
  result: CodeIntelQueryResult;
};

type CodeIntelDaemonPongResponse = {
  id: string;
  ok: true;
  protocolVersion: CodeIntelDaemonProtocolVersion;
  result: CodeIntelDaemonPongResult;
};

export type CodeIntelDaemonResponse =
  | CodeIntelDaemonPongResponse
  | CodeIntelDaemonQueryResponse
  | {
      error: CodeIntelDaemonError;
      id: string;
      ok: false;
      protocolVersion: CodeIntelDaemonProtocolVersion;
    };

const projectFilterSchema = z.enum([
  "client",
  "server",
  "shared",
]) satisfies z.ZodType<ProjectFilter>;

const sourceLocationSchema = z.strictObject({
  col: z.number(),
  file: z.string(),
  line: z.number(),
}) satisfies z.ZodType<SourceLocation>;

const definitionCommandSchema = z.strictObject({
  kind: z.literal("def"),
  location: sourceLocationSchema,
}) satisfies z.ZodType<Extract<ExecutableCliCommand, { kind: "def" }>>;

const definitionNameCommandSchema = z.strictObject({
  kind: z.literal("defName"),
  name: z.string(),
}) satisfies z.ZodType<Extract<ExecutableCliCommand, { kind: "defName" }>>;

const exportsCommandSchema = z.strictObject({
  file: z.string(),
  kind: z.literal("exports"),
}) satisfies z.ZodType<Extract<ExecutableCliCommand, { kind: "exports" }>>;

const dependentsCommandSchema = z.strictObject({
  depth: z.number(),
  excludeTests: z.boolean(),
  file: z.string(),
  kind: z.literal("dependents"),
  limit: z.number().optional(),
  project: projectFilterSchema.optional(),
}) satisfies z.ZodType<Extract<ExecutableCliCommand, { kind: "dependents" }>>;

const referencesCommandSchema = z.strictObject({
  kind: z.literal("refs"),
  limit: z.number().optional(),
  location: sourceLocationSchema,
}) satisfies z.ZodType<Extract<ExecutableCliCommand, { kind: "refs" }>>;

// JSON.stringify sends the CLI's unbounded tests depth (Infinity) as null;
// the wire decoder restores null to Infinity. daemon-protocol.test.ts pins
// this encode/decode convention.
const testsDepthSchema = z.union([
  z.number(),
  z.null().transform(() => Number.POSITIVE_INFINITY),
]) satisfies z.ZodType<number>;

const testsCommandSchema = z.strictObject({
  depth: testsDepthSchema,
  file: z.string(),
  kind: z.literal("tests"),
  limit: z.number().optional(),
  project: projectFilterSchema.optional(),
}) satisfies z.ZodType<Extract<ExecutableCliCommand, { kind: "tests" }>>;

const pingCommandSchema = z.strictObject({
  kind: z.literal("ping"),
}) satisfies z.ZodType<CodeIntelDaemonPingCommand>;

const daemonRequestCommandSchema = z.discriminatedUnion("kind", [
  definitionCommandSchema,
  definitionNameCommandSchema,
  exportsCommandSchema,
  dependentsCommandSchema,
  referencesCommandSchema,
  testsCommandSchema,
  pingCommandSchema,
]);

export const DAEMON_REQUEST_SCHEMA = z.strictObject({
  command: daemonRequestCommandSchema,
  id: z.string(),
  protocolVersion: z.literal(CODE_INTEL_DAEMON_PROTOCOL_VERSION),
}) satisfies z.ZodType<CodeIntelDaemonRequest>;

export type DaemonRequestDecodeOutcome =
  | { kind: "ok"; request: CodeIntelDaemonRequest }
  | { id: string; kind: "error"; reason: string };

export function decodeDaemonRequest(payload: string): DaemonRequestDecodeOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    return {
      id: "unknown",
      kind: "error",
      reason: `Invalid JSON request: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const id = isRecord(parsed) && typeof parsed.id === "string" ? parsed.id : "unknown";
  const result = DAEMON_REQUEST_SCHEMA.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues[0]?.message ?? "unknown request shape";
    return { id, kind: "error", reason: `Request does not match daemon protocol: ${detail}` };
  }
  return { kind: "ok", request: result.data };
}

export function buildPingRequest(id: string): CodeIntelDaemonRequest {
  return {
    command: { kind: "ping" },
    id,
    protocolVersion: CODE_INTEL_DAEMON_PROTOCOL_VERSION,
  };
}

export function isPongResult(value: unknown): value is CodeIntelDaemonPongResult {
  return isRecord(value) && value.kind === "pong";
}

export type ShallowDaemonQueryResult =
  | { hint: Record<string, unknown>; kind: "definitionNameMiss" }
  | {
      kind: "results";
      results: Array<Record<string, unknown> & { kind: IntelResult["kind"] }>;
    };

// Response validation deliberately stays shallow: protocolVersion lockstep is
// the defense for this same-repo, compiler-owned IPC boundary. Checking only
// envelopes and discriminators avoids parallel result schemas on a latency path;
// the client marks the single cast where it trusts the remaining arm interiors.
export function isDaemonQueryResult(
  value: unknown,
  command: ExecutableCliCommand,
): value is ShallowDaemonQueryResult {
  if (!isRecord(value)) return false;
  if (value.kind === "definitionNameMiss") {
    return command.kind === "defName" && isRecord(value.hint);
  }
  if (value.kind !== "results") return false;
  if (!Array.isArray(value.results)) return false;
  const expectedKind = RESULT_KIND_BY_COMMAND[command.kind];
  return (
    expectedKind !== undefined &&
    value.results.every((result) => isRecord(result) && result.kind === expectedKind)
  );
}
