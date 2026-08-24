import type { DaemonRoutableCommand } from "./daemon-protocol.js";
import type { ExecutableCliCommand } from "./types.js";

const DAEMON_ROUTABLE_COMMAND_KINDS = [
  "def",
  "defName",
  "exports",
  "refs",
  "dependents",
  "tests",
] as const satisfies readonly DaemonRoutableCommand["kind"][];

export type GraphDaemonCommand = Extract<ExecutableCliCommand, { kind: "dependents" | "tests" }>;
export type SymbolDaemonCommand = Extract<
  ExecutableCliCommand,
  { kind: "def" | "defName" | "exports" | "refs" }
>;

export function isDaemonRoutableExecutableCommand(
  command: ExecutableCliCommand,
): command is DaemonRoutableCommand {
  return isDaemonRoutableCommandKind(command.kind);
}

export function isGraphCommand(command: ExecutableCliCommand): command is GraphDaemonCommand {
  return command.kind === "dependents" || command.kind === "tests";
}

export function isSymbolCommand(command: ExecutableCliCommand): command is SymbolDaemonCommand {
  return (
    command.kind === "def" ||
    command.kind === "defName" ||
    command.kind === "exports" ||
    command.kind === "refs"
  );
}

function isDaemonRoutableCommandKind(kind: ExecutableCliCommand["kind"]): boolean {
  return DAEMON_ROUTABLE_COMMAND_KINDS.some((routableKind) => routableKind === kind);
}
