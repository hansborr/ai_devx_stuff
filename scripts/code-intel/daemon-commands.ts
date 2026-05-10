import type { ExecutableCliCommand } from "./types.js";

const DAEMON_ROUTABLE_COMMAND_KINDS: readonly string[] = [
  "def",
  "defName",
  "exports",
  "refs",
  "dependents",
  "tests",
];

export type GraphDaemonCommand = Extract<ExecutableCliCommand, { kind: "dependents" | "tests" }>;
export type SymbolDaemonCommand = Extract<
  ExecutableCliCommand,
  { kind: "def" | "defName" | "exports" | "refs" }
>;

export function isDaemonRoutableCommand(command: {
  kind: string;
}): command is ExecutableCliCommand {
  return isDaemonRoutableCommandKind(command.kind);
}

export function isDaemonRoutableExecutableCommand(command: ExecutableCliCommand): boolean {
  return isDaemonRoutableCommandKind(command.kind);
}

export function isGraphCommand(command: ExecutableCliCommand): command is GraphDaemonCommand {
  return command.kind === "dependents" || command.kind === "tests";
}

function isDaemonRoutableCommandKind(kind: string): boolean {
  return DAEMON_ROUTABLE_COMMAND_KINDS.includes(kind);
}
