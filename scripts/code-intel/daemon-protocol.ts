import type { CodeIntelQueryResult, ExecutableCliCommand } from "./types.js";

export const CODE_INTEL_DAEMON_PROTOCOL_VERSION = 1;

// Wire-level error name the daemon tags on fallback responses (protocol-version
// mismatch / non-routable command). Consumers branch on it to choose graceful
// one-shot fallback over throwing, so producer and consumers must share one source.
export const DAEMON_FALLBACK_ERROR_NAME = "CodeIntelDaemonFallback";

type CodeIntelDaemonProtocolVersion = typeof CODE_INTEL_DAEMON_PROTOCOL_VERSION;

export type CodeIntelDaemonRequest = {
  command: ExecutableCliCommand;
  id: string;
  protocolVersion: CodeIntelDaemonProtocolVersion;
};

export type CodeIntelDaemonError = {
  message: string;
  name: string;
};

export type CodeIntelDaemonResponse =
  | {
      id: string;
      ok: true;
      protocolVersion: CodeIntelDaemonProtocolVersion;
      result: CodeIntelQueryResult;
    }
  | {
      error: CodeIntelDaemonError;
      id: string;
      ok: false;
      protocolVersion: CodeIntelDaemonProtocolVersion;
    };
