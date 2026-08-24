import { existsSync, realpathSync } from "node:fs";

import { errorMessage } from "../lib/error-message.js";
import {
  type DaemonSpawner,
  defaultDaemonScriptPath,
  defaultDaemonSpawner,
  isProcessAlive,
  stopProcess as stopDaemonProcess,
  type StopProcessOptions,
  waitForDaemonReady,
} from "./daemon-process.js";
import { CODE_INTEL_DAEMON_PROTOCOL_VERSION } from "./daemon-protocol.js";
import {
  clearDaemonState,
  type DaemonMetadata,
  type DaemonStateOptions,
  type DaemonStatePaths,
  readDaemonMetadata,
  readDaemonPid,
  resolveDaemonStatePaths,
} from "./daemon-state.js";
import { CodeIntelError } from "./errors.js";
import {
  type DaemonLifecycleProbe,
  type DaemonProcessIdentityProbe,
  defaultLifecycleProbe,
  defaultProcessIdentityProbe,
} from "./lifecycle-probe.js";

type ServerCliCommand = "restart" | "status" | "stop";

const PROCESS_ARG_OFFSET = 2;
const DAEMON_OUTPUT_PREFIX = "code-intel daemon: ";

export type ServerCliOptions = {
  daemonScriptPath?: string;
  isAlive?: (pid: number) => boolean;
  probeDaemon?: DaemonLifecycleProbe;
  repoRoot?: string;
  spawner?: DaemonSpawner;
  state?: DaemonStateOptions;
  stopProcess?: (options: StopProcessOptions) => Promise<boolean>;
  verifyProcessIdentity?: DaemonProcessIdentityProbe;
};

export type ServerCliResult = {
  exitCode: number;
  output: string;
};

type StopCommandResult = {
  exitCode: number;
  message: string;
};

function daemonResult(exitCode: number, message: string): ServerCliResult {
  return { exitCode, output: `${DAEMON_OUTPUT_PREFIX}${message}` };
}

export async function runServerCli(
  args: string[] = process.argv.slice(PROCESS_ARG_OFFSET),
  options: ServerCliOptions = {},
): Promise<void> {
  try {
    const result = await runServerCliCommand(args, options);
    if (result.output.length > 0) {
      const writeTo = result.exitCode === 0 ? console.log : console.error;
      writeTo(result.output);
    }
    if (result.exitCode !== 0) process.exitCode = result.exitCode;
  } catch (error) {
    if (error instanceof CodeIntelError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

export async function runServerCliCommand(
  args: string[],
  options: ServerCliOptions = {},
): Promise<ServerCliResult> {
  const command = parseServerCliCommand(args);
  const repoRoot = options.repoRoot ?? process.cwd();
  const paths = resolveDaemonStatePaths(repoRoot, options.state);
  if (command === "status") return statusCommand(repoRoot, paths, options);
  if (command === "stop") {
    const stop = await stopCommand(repoRoot, paths, options);
    return daemonResult(stop.exitCode, stop.message);
  }
  return restartCommand(repoRoot, paths, options);
}

function parseServerCliCommand(args: string[]): ServerCliCommand {
  const first = args[0];
  if (first === undefined) throw new CodeIntelError(serverUsage());
  if (first === "--help" || first === "-h") throw new CodeIntelError(serverUsage());
  if (args.length > 1) {
    throw new CodeIntelError(`Unexpected arguments after ${first}.\n${serverUsage()}`);
  }
  if (first === "status" || first === "stop" || first === "restart") return first;
  throw new CodeIntelError(`Unknown server command: ${first}\n${serverUsage()}`);
}

function serverUsage(): string {
  return [
    "Usage:",
    "  bun run code:intel:server -- status",
    "  bun run code:intel:server -- stop",
    "  bun run code:intel:server -- restart",
    "",
    "State directory: /tmp/musi-code-intel/<repo-key>/",
    "Normal queries do not auto-start the daemon; use restart to start manually.",
  ].join("\n");
}

async function statusCommand(
  repoRoot: string,
  paths: DaemonStatePaths,
  options: ServerCliOptions,
): Promise<ServerCliResult> {
  const state = readLifecycleMetadata(paths);
  if (state.kind === "absent") {
    if (existsSync(paths.pidPath) || existsSync(paths.socketPath)) {
      return daemonResult(0, `stale partial state (${paths.stateDir})`);
    }
    return daemonResult(0, `absent (${paths.stateDir})`);
  }
  if (state.kind === "invalid") {
    return daemonResult(0, `invalid state (${state.reason}, state ${paths.stateDir})`);
  }
  const validation = await validateLifecycleDaemon(repoRoot, paths, state.metadata, options);
  if (validation.kind === "stale") {
    return daemonResult(
      0,
      `stale (pid ${String(state.metadata.pid)} ${validation.reason}, state ${paths.stateDir})`,
    );
  }
  if (validation.kind === "unverified") {
    return daemonResult(
      0,
      `busy or unverified (pid ${String(state.metadata.pid)} ${validation.reason}, state ${paths.stateDir})`,
    );
  }
  return daemonResult(0, `running (pid ${String(state.metadata.pid)}, socket ${paths.socketPath})`);
}

async function stopCommand(
  repoRoot: string,
  paths: DaemonStatePaths,
  options: ServerCliOptions,
): Promise<StopCommandResult> {
  const state = readLifecycleMetadata(paths);
  if (state.kind === "absent") return stopAbsentState(paths);
  if (state.kind === "invalid") {
    clearDaemonState(paths);
    return { exitCode: 0, message: `cleared invalid state (${state.reason})` };
  }
  const validation = await validateLifecycleDaemon(repoRoot, paths, state.metadata, options);
  if (validation.kind === "stale") {
    clearDaemonState(paths);
    return {
      exitCode: 0,
      message: `cleared stale state (pid ${String(state.metadata.pid)} ${validation.reason})`,
    };
  }
  if (validation.kind === "unverified") {
    return stopUnverifiedDaemon(
      repoRoot,
      paths,
      { metadata: state.metadata, reason: validation.reason },
      options,
    );
  }
  return stopRunningDaemon(paths, state.metadata, options, "");
}

async function stopRunningDaemon(
  paths: DaemonStatePaths,
  metadata: DaemonMetadata,
  options: ServerCliOptions,
  suffix: string,
): Promise<StopCommandResult> {
  const isAlive = options.isAlive ?? isProcessAlive;
  const stopProcess = options.stopProcess ?? stopDaemonProcess;
  const stopped = await stopProcess({ isAlive, pid: metadata.pid });
  clearDaemonState(paths);
  if (!stopped) {
    return {
      exitCode: 0,
      message: `cleared stale state (pid ${String(metadata.pid)} exited before stop)`,
    };
  }
  return { exitCode: 0, message: `stopped (pid ${String(metadata.pid)})${suffix}` };
}

async function stopUnverifiedDaemon(
  repoRoot: string,
  paths: DaemonStatePaths,
  daemon: UnverifiedDaemon,
  options: ServerCliOptions,
): Promise<StopCommandResult> {
  const { metadata, reason } = daemon;
  const verifyProcessIdentity = options.verifyProcessIdentity ?? defaultProcessIdentityProbe;
  const scriptPath = options.daemonScriptPath ?? defaultDaemonScriptPath();
  const identity = await verifyProcessIdentity(metadata, repoRoot, scriptPath);
  if (identity.kind !== "verified") {
    return {
      exitCode: 1,
      message: `state preserved (pid ${String(metadata.pid)} ${reason}; ${identity.reason})`,
    };
  }
  return stopRunningDaemon(paths, metadata, options, " after verifying process identity");
}

async function restartCommand(
  repoRoot: string,
  paths: DaemonStatePaths,
  options: ServerCliOptions,
): Promise<ServerCliResult> {
  const stop = await stopCommand(repoRoot, paths, options);
  if (stop.exitCode !== 0) {
    return daemonResult(stop.exitCode, `restart skipped; ${stop.message}`);
  }
  const spawner = options.spawner ?? defaultDaemonSpawner;
  const scriptPath = options.daemonScriptPath ?? defaultDaemonScriptPath();
  const handle = spawner(realpathSync(repoRoot), scriptPath);
  await waitForDaemonReady({
    isAlive: options.isAlive,
    metadataPath: paths.metadataPath,
    pid: handle.pid,
    socketPath: paths.socketPath,
  });
  return daemonResult(0, `started (pid ${String(handle.pid)}, socket ${paths.socketPath})`);
}

type LifecycleMetadataRead =
  | { kind: "absent" }
  | { kind: "invalid"; reason: string }
  | { kind: "valid"; metadata: DaemonMetadata };

type LifecycleDaemonValidation =
  | { kind: "running" }
  | { kind: "stale" | "unverified"; reason: string };

type UnverifiedDaemon = { metadata: DaemonMetadata; reason: string };

function readLifecycleMetadata(paths: DaemonStatePaths): LifecycleMetadataRead {
  try {
    const metadata = readDaemonMetadata(paths);
    return metadata ? { kind: "valid", metadata } : { kind: "absent" };
  } catch (error) {
    return { kind: "invalid", reason: errorMessage(error) };
  }
}

function stopAbsentState(paths: DaemonStatePaths): StopCommandResult {
  const pid = readDaemonPid(paths);
  if (pid === undefined && !existsSync(paths.pidPath) && !existsSync(paths.socketPath)) {
    return { exitCode: 0, message: `no state to stop (${paths.stateDir})` };
  }
  clearDaemonState(paths);
  return { exitCode: 0, message: `cleared partial state (${paths.stateDir})` };
}

async function validateLifecycleDaemon(
  repoRoot: string,
  paths: DaemonStatePaths,
  metadata: DaemonMetadata,
  options: ServerCliOptions,
): Promise<LifecycleDaemonValidation> {
  const staticValidation = validateLifecycleMetadata(repoRoot, paths, metadata);
  if (staticValidation.kind !== "running") return staticValidation;
  const isAlive = options.isAlive ?? isProcessAlive;
  if (!isAlive(metadata.pid)) return { kind: "stale", reason: "not running" };
  const probe = options.probeDaemon ?? defaultLifecycleProbe;
  try {
    const probeResult = await probe(paths, metadata);
    if (probeResult.ok) return { kind: "running" };
    return { kind: probeResult.failureKind, reason: probeResult.reason };
  } catch (error) {
    return {
      kind: "unverified",
      reason: `probe failed: ${errorMessage(error)}`,
    };
  }
}

function validateLifecycleMetadata(
  repoRoot: string,
  paths: DaemonStatePaths,
  metadata: DaemonMetadata,
): LifecycleDaemonValidation {
  if (metadata.protocolVersion !== CODE_INTEL_DAEMON_PROTOCOL_VERSION) {
    return { kind: "stale", reason: "protocol version mismatch" };
  }
  if (metadata.repoRealpath !== realpathSync(repoRoot)) {
    return { kind: "stale", reason: "repo mismatch" };
  }
  if (metadata.socketPath !== paths.socketPath) {
    return { kind: "stale", reason: "socket path mismatch" };
  }
  return { kind: "running" };
}
