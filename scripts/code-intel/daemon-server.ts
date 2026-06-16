import { createServer, type Server, type Socket } from "node:net";
import { pathToFileURL } from "node:url";

import { isDaemonRoutableCommand } from "./daemon-commands.js";
import {
  CODE_INTEL_DAEMON_PROTOCOL_VERSION,
  type CodeIntelDaemonError,
  type CodeIntelDaemonRequest,
  type CodeIntelDaemonResponse,
  DAEMON_FALLBACK_ERROR_NAME,
} from "./daemon-protocol.js";
import { executeDaemonQuery } from "./daemon-query.js";
import {
  buildDaemonMetadata,
  clearDaemonState,
  type DaemonStatePaths,
  ensureStateDir,
  resolveDaemonStatePaths,
  unlinkSocketFile,
  writeDaemonMetadata,
} from "./daemon-state.js";
import { GraphCache } from "./graph-cache.js";
import { isRecord } from "./json-utils.js";
import { ProjectCache } from "./project-cache.js";

const FALLBACK_RESPONSE_ID = "unknown";

export type RunDaemonOptions = {
  paths: DaemonStatePaths;
  projectCache?: ProjectCache;
  repoRealpath: string;
  repoRoot: string;
  graphCache?: GraphCache;
  pid?: number;
  signalEvents?: NodeJS.Signals[];
  startedAt?: Date;
};

export type RunningDaemon = {
  paths: DaemonStatePaths;
  pid: number;
  shutdown: (reason?: string) => Promise<void>;
};

const DEFAULT_SIGNAL_EVENTS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

export async function runDaemon(options: RunDaemonOptions): Promise<RunningDaemon> {
  const pid = options.pid ?? process.pid;
  const paths = options.paths;
  const graphCache = options.graphCache ?? new GraphCache(options.repoRoot);
  const projectCache = options.projectCache ?? new ProjectCache(options.repoRoot);
  ensureStateDir(paths);
  unlinkSocketFile(paths);

  return new Promise<RunningDaemon>((resolve, reject) => {
    const server = createServer((socket) => {
      handleConnection(socket, options.repoRoot, graphCache, projectCache);
    });
    server.once("error", reject);
    server.listen(paths.socketPath, () => {
      writeDaemonMetadata(
        paths,
        buildDaemonMetadata({
          paths,
          pid,
          repoRealpath: options.repoRealpath,
          repoRoot: options.repoRoot,
          startedAt: options.startedAt,
        }),
      );
      const handle = createHandle(
        server,
        paths,
        pid,
        options.signalEvents ?? DEFAULT_SIGNAL_EVENTS,
      );
      resolve(handle);
    });
  });
}

function handleConnection(
  socket: Socket,
  repoRoot: string,
  graphCache: GraphCache,
  projectCache: ProjectCache,
): void {
  let buffer = "";
  let handled = false;
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    if (handled) return;
    buffer += chunk;
    const newlineIndex = buffer.indexOf("\n");
    if (newlineIndex === -1) return;
    handled = true;
    const requestPayload = buffer.slice(0, newlineIndex);
    const response = handleRequestPayload(requestPayload, repoRoot, graphCache, projectCache);
    try {
      socket.end(`${JSON.stringify(response)}\n`);
    } catch {
      socket.destroy();
    }
  });
  socket.on("error", () => {
    // Errors are reported back to the client via the response envelope when we
    // can; on socket faults there is nothing useful to do here.
  });
}

function handleRequestPayload(
  payload: string,
  repoRoot: string,
  graphCache: GraphCache,
  projectCache: ProjectCache,
): CodeIntelDaemonResponse {
  const parseOutcome = parseEnvelope(payload);
  if (parseOutcome.kind === "error") {
    return errorResponse(parseOutcome.id, parseOutcome.error);
  }
  const parsed = parseOutcome.envelope;
  if (parsed.protocolVersion !== CODE_INTEL_DAEMON_PROTOCOL_VERSION) {
    return errorResponse(parsed.id, {
      message: `Unsupported protocol version ${String(parsed.protocolVersion)}; expected ${String(
        CODE_INTEL_DAEMON_PROTOCOL_VERSION,
      )}.`,
      name: DAEMON_FALLBACK_ERROR_NAME,
    });
  }
  if (parsed.command.kind === "ping") return pongResponse(parsed.id);
  if (!isDaemonRoutableCommand(parsed.command)) {
    return errorResponse(parsed.id, {
      message: `Daemon does not handle ${parsed.command.kind} queries.`,
      name: DAEMON_FALLBACK_ERROR_NAME,
    });
  }
  const envelope: CodeIntelDaemonRequest = {
    command: parsed.command,
    id: parsed.id,
    protocolVersion: CODE_INTEL_DAEMON_PROTOCOL_VERSION,
  };
  return executeDaemonQuery(envelope, repoRoot, graphCache, projectCache);
}

type ParsedRequestEnvelope = {
  command: { kind: string };
  id: string;
  protocolVersion: number;
};

type ParsedEnvelopeOutcome =
  | { kind: "ok"; envelope: ParsedRequestEnvelope }
  | { kind: "error"; id: string; error: CodeIntelDaemonError };

function parseEnvelope(payload: string): ParsedEnvelopeOutcome {
  if (payload.length === 0) {
    return {
      kind: "error",
      id: FALLBACK_RESPONSE_ID,
      error: { message: "Empty request payload.", name: "Error" },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    return {
      kind: "error",
      id: FALLBACK_RESPONSE_ID,
      error: {
        message: `Invalid JSON request: ${error instanceof Error ? error.message : String(error)}`,
        name: "Error",
      },
    };
  }
  if (!isRecord(parsed)) {
    return {
      kind: "error",
      id: FALLBACK_RESPONSE_ID,
      error: { message: "Request must be a JSON object.", name: "Error" },
    };
  }
  const id = typeof parsed.id === "string" ? parsed.id : FALLBACK_RESPONSE_ID;
  if (typeof parsed.protocolVersion !== "number") {
    return {
      kind: "error",
      id,
      error: { message: "Request envelope is missing a numeric protocolVersion.", name: "Error" },
    };
  }
  if (!isRecord(parsed.command) || typeof parsed.command.kind !== "string") {
    return {
      kind: "error",
      id,
      error: { message: "Request envelope is missing a command.", name: "Error" },
    };
  }
  // type-assertion-boundary: json - request envelope parsed from JSON and shape-validated above (isRecord + command/protocolVersion checks); cast just narrows to the validated envelope type
  return { kind: "ok", envelope: parsed as unknown as ParsedRequestEnvelope };
}

function errorResponse(id: string, error: CodeIntelDaemonError): CodeIntelDaemonResponse {
  return {
    error,
    id,
    ok: false,
    protocolVersion: CODE_INTEL_DAEMON_PROTOCOL_VERSION,
  };
}

function pongResponse(id: string): CodeIntelDaemonResponse {
  return {
    id,
    ok: true,
    protocolVersion: CODE_INTEL_DAEMON_PROTOCOL_VERSION,
    result: { kind: "results", header: "pong", results: [] },
  };
}

function createHandle(
  server: Server,
  paths: DaemonStatePaths,
  pid: number,
  signals: NodeJS.Signals[],
): RunningDaemon {
  let shuttingDown = false;
  const handle: RunningDaemon = {
    paths,
    pid,
    shutdown: async (_reason?: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
      unlinkSocketFile(paths);
      clearDaemonState(paths);
    },
  };
  for (const signal of signals) {
    process.once(signal, () => {
      void handle.shutdown(signal).then(() => {
        process.exit(0);
      });
    });
  }
  return handle;
}

async function runFromCli(repoRoot: string): Promise<void> {
  const { realpathSync } = await import("node:fs");
  const repoRealpath = realpathSync(repoRoot);
  const paths = resolveDaemonStatePaths(repoRoot);
  await runDaemon({ paths, repoRealpath, repoRoot });
}

const ENTRYPOINT_ARG_INDEX = 1;
const REPO_ARG_INDEX = 2;
const MISSING_ARG_EXIT_CODE = 2;

if (isMainModule()) {
  const repoRoot = process.argv[REPO_ARG_INDEX];
  if (!repoRoot) {
    console.error("daemon-server: missing required <repoRoot> argument.");
    process.exit(MISSING_ARG_EXIT_CODE);
  }
  void runFromCli(repoRoot);
}

function isMainModule(): boolean {
  const entry = process.argv[ENTRYPOINT_ARG_INDEX];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}
