import {
  type GraphDaemonCommand,
  isGraphCommand,
  type SymbolDaemonCommand,
} from "./daemon-commands.js";
import {
  CODE_INTEL_DAEMON_PROTOCOL_VERSION,
  type CodeIntelDaemonError,
  type CodeIntelDaemonRequest,
  type CodeIntelDaemonResponse,
} from "./daemon-protocol.js";
import { CodeIntelError } from "./errors.js";
import type { GraphCache } from "./graph-cache.js";
import type { ProjectCache } from "./project-cache.js";
import { executeCodeIntelQuery } from "./query-executor.js";
import type { CodeIntelQueryResult } from "./types.js";

export function executeDaemonQuery(
  envelope: CodeIntelDaemonRequest,
  repoRoot: string,
  graphCache: GraphCache,
  projectCache: ProjectCache,
): CodeIntelDaemonResponse {
  try {
    const result: CodeIntelQueryResult = isGraphCommand(envelope.command)
      ? executeGraphQuery(envelope.command, repoRoot, graphCache)
      : executeSymbolQuery(envelope.command, repoRoot, projectCache);
    return {
      id: envelope.id,
      ok: true,
      protocolVersion: CODE_INTEL_DAEMON_PROTOCOL_VERSION,
      result,
    };
  } catch (error) {
    return errorResponse(envelope.id, {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof CodeIntelError ? "CodeIntelError" : "Error",
    });
  }
}

function executeGraphQuery(
  command: GraphDaemonCommand,
  repoRoot: string,
  graphCache: GraphCache,
): CodeIntelQueryResult {
  const cached = graphCache.ensure();
  return executeCodeIntelQuery(command, {
    graph: cached.graph,
    repoRoot,
    resolver: cached.resolver,
  });
}

function executeSymbolQuery(
  command: SymbolDaemonCommand,
  repoRoot: string,
  projectCache: ProjectCache,
): CodeIntelQueryResult {
  const cached = projectCache.ensure();
  if (command.kind === "defName") {
    return executeCodeIntelQuery(command, {
      graphProject: cached.graphProject,
      repoRoot,
      resolver: cached.resolver,
    });
  }
  if (command.kind === "refs") {
    return executeCodeIntelQuery(command, {
      referenceProject: projectCache.referenceProject(cached),
      repoRoot,
      resolver: cached.resolver,
    });
  }
  const file = command.kind === "def" ? command.location.file : command.file;
  return executeCodeIntelQuery(command, {
    project: projectCache.projectForFile(file, cached),
    repoRoot,
    resolver: cached.resolver,
  });
}

function errorResponse(id: string, error: CodeIntelDaemonError): CodeIntelDaemonResponse {
  return {
    error,
    id,
    ok: false,
    protocolVersion: CODE_INTEL_DAEMON_PROTOCOL_VERSION,
  };
}
