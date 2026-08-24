import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createConnection, type Socket } from "node:net";

import { errorMessage } from "../lib/error-message.js";
import { isRecord } from "../lib/records.js";
import { isDaemonRoutableExecutableCommand } from "./daemon-commands.js";
import { isProcessAlive } from "./daemon-process.js";
import {
  CODE_INTEL_DAEMON_PROTOCOL_VERSION,
  type CodeIntelDaemonRequest,
  DAEMON_FALLBACK_ERROR_NAME,
  isDaemonQueryResult,
} from "./daemon-protocol.js";
import {
  type DaemonStateOptions,
  type DaemonStatePaths,
  readDaemonMetadata,
  resolveDaemonStatePaths,
} from "./daemon-state.js";
import { CodeIntelError } from "./errors.js";
import type { CodeIntelQueryResult, ExecutableCliCommand } from "./types.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const REFS_REQUEST_TIMEOUT_MS = 30000;

export type DaemonClientOptions = {
  isAlive?: (pid: number) => boolean;
  repoRoot?: string;
  state?: DaemonStateOptions;
  timeoutMs?: number;
  transport?: DaemonTransport;
};

export type DaemonTransport = (
  socketPath: string,
  payload: string,
  timeoutMs: number,
) => Promise<string>;

export type DaemonOutcome =
  | { kind: "result"; result: CodeIntelQueryResult }
  | { kind: "fallback"; reason: string };

export async function requestDaemonQuery(
  command: ExecutableCliCommand,
  options: DaemonClientOptions = {},
): Promise<DaemonOutcome> {
  if (!isDaemonRoutableExecutableCommand(command)) {
    return { kind: "fallback", reason: `unsupported command: ${command.kind}` };
  }

  const repoRoot = options.repoRoot ?? process.cwd();
  const paths = resolveDaemonStatePaths(repoRoot, options.state);
  const handshake = checkDaemonReady(paths, options.isAlive ?? isProcessAlive);
  if (handshake.kind === "fallback") return handshake;

  const requestId = randomUUID();
  const envelope: CodeIntelDaemonRequest = {
    command,
    id: requestId,
    protocolVersion: CODE_INTEL_DAEMON_PROTOCOL_VERSION,
  };

  const transport = options.transport ?? defaultDaemonTransport;
  const timeoutMs = options.timeoutMs ?? requestTimeoutForCommand(command);

  let raw: string;
  try {
    raw = await transport(paths.socketPath, JSON.stringify(envelope), timeoutMs);
  } catch (error) {
    return transportFailureOutcome(command, timeoutMs, error);
  }

  return interpretResponse(raw, requestId, command);
}

function transportFailureOutcome(
  command: ExecutableCliCommand,
  timeoutMs: number,
  error: unknown,
): DaemonOutcome {
  if (command.kind === "refs" && error instanceof DaemonRequestTimeoutError) {
    throw new CodeIntelError(
      `Daemon refs query timed out after ${String(timeoutMs)}ms; the daemon may still be warming its reference project. Retry the query instead of duplicating the cold refs scan in one-shot mode.`,
    );
  }
  return { kind: "fallback", reason: `transport: ${errorMessage(error)}` };
}

function checkDaemonReady(
  paths: DaemonStatePaths,
  isAlive: (pid: number) => boolean,
): DaemonOutcome | { kind: "ok" } {
  let metadata: ReturnType<typeof readDaemonMetadata>;
  try {
    metadata = readDaemonMetadata(paths);
  } catch (error) {
    return { kind: "fallback", reason: `metadata: ${errorMessage(error)}` };
  }
  if (!metadata) return { kind: "fallback", reason: "daemon absent" };
  if (metadata.protocolVersion !== CODE_INTEL_DAEMON_PROTOCOL_VERSION) {
    return { kind: "fallback", reason: "protocol version mismatch" };
  }
  if (!isAlive(metadata.pid)) return { kind: "fallback", reason: "daemon not running" };
  if (!existsSync(paths.socketPath)) return { kind: "fallback", reason: "socket missing" };
  return { kind: "ok" };
}

function interpretResponse(
  raw: string,
  expectedId: string,
  command: ExecutableCliCommand,
): DaemonOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { kind: "fallback", reason: `invalid response: ${errorMessage(error)}` };
  }
  if (!isRecord(parsed)) return { kind: "fallback", reason: "non-object response" };
  const protocolVersion = parsed.protocolVersion;
  if (
    typeof protocolVersion !== "number" ||
    protocolVersion !== CODE_INTEL_DAEMON_PROTOCOL_VERSION
  ) {
    return { kind: "fallback", reason: "response protocol mismatch" };
  }
  if (parsed.id !== expectedId) return { kind: "fallback", reason: "response id mismatch" };
  if (parsed.ok === true) {
    if (!isDaemonQueryResult(parsed.result, command)) {
      throw new CodeIntelError(
        `Daemon returned a malformed success response for ${command.kind}. Run \`bun run code:intel:server -- restart\` and retry.`,
      );
    }
    // type-assertion-boundary: json - the same-repo daemon response is protocol-versioned and discriminator-checked above; result-arm interiors deliberately remain compiler-owned to keep the latency path shallow
    const result = parsed.result as CodeIntelQueryResult;
    return { kind: "result", result };
  }
  return interpretErrorResponse(parsed);
}

function interpretErrorResponse(parsed: Record<string, unknown>): DaemonOutcome {
  if (parsed.ok !== false || !isRecord(parsed.error)) {
    return { kind: "fallback", reason: "malformed error response" };
  }
  // type-assertion-boundary: json - daemon error envelope parsed from JSON; only message/name fields are read
  const errorRecord = parsed.error as { message?: unknown; name?: unknown };
  const errorName = typeof errorRecord.name === "string" ? errorRecord.name : "Error";
  const message =
    typeof errorRecord.message === "string" ? errorRecord.message : "unknown daemon error";
  if (errorName === DAEMON_FALLBACK_ERROR_NAME) {
    return { kind: "fallback", reason: message };
  }
  throw new CodeIntelError(message);
}

export class DaemonRequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`daemon request timed out after ${String(timeoutMs)}ms`);
    this.name = "DaemonRequestTimeoutError";
  }
}

export const defaultDaemonTransport: DaemonTransport = async (socketPath, payload, timeoutMs) =>
  new Promise<string>((resolve, reject) => {
    const socket: Socket = createConnection(socketPath);
    const chunks: string[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new DaemonRequestTimeoutError(timeoutMs));
    }, timeoutMs);

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    };

    socket.setEncoding("utf8");
    socket.on("error", fail);
    socket.on("data", (chunk: string) => {
      chunks.push(chunk);
    });
    socket.on("end", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(chunks.join(""));
    });
    socket.on("connect", () => {
      socket.write(`${payload}\n`);
    });
  });

function requestTimeoutForCommand(command: ExecutableCliCommand): number {
  if (command.kind === "refs") return REFS_REQUEST_TIMEOUT_MS;
  return DEFAULT_REQUEST_TIMEOUT_MS;
}
