import type { CodeIntelQueryResult, ExecutableCliCommand } from "./types.js";

export const CODE_INTEL_DAEMON_PROTOCOL_VERSION = 1;

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
