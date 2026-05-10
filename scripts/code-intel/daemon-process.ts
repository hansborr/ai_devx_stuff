import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { CodeIntelError } from "./errors.js";

const DEFAULT_SPAWN_TIMEOUT_MS = 5000;
const DEFAULT_STOP_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 50;

export type DaemonSpawner = (repoRoot: string, scriptPath: string) => SpawnedDaemonHandle;

export type SpawnedDaemonHandle = {
  pid: number;
};

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw error;
  }
}

export function defaultDaemonScriptPath(): string {
  return path.join(import.meta.dirname, "daemon-server.ts");
}

export const defaultDaemonSpawner: DaemonSpawner = (repoRoot, scriptPath) => {
  const child = spawn("bun", [scriptPath, repoRoot], {
    cwd: repoRoot,
    detached: true,
    env: process.env,
    stdio: "ignore",
  });
  child.unref();
  if (typeof child.pid !== "number") {
    throw new CodeIntelError("Failed to spawn code-intel daemon: missing pid.");
  }
  return { pid: child.pid };
};

export type WaitForReadyOptions = {
  metadataPath: string;
  socketPath: string;
  pid: number;
  timeoutMs?: number;
  isAlive?: (pid: number) => boolean;
  fileExists?: (target: string) => boolean;
  sleepMs?: (ms: number) => Promise<void>;
};

export async function waitForDaemonReady(options: WaitForReadyOptions): Promise<void> {
  const isAlive = options.isAlive ?? isProcessAlive;
  const fileExists = options.fileExists ?? existsSync;
  const sleepMs = options.sleepMs ?? sleep;
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS);
  while (Date.now() < deadline) {
    if (!isAlive(options.pid)) {
      throw new CodeIntelError(
        `code-intel daemon (pid ${String(options.pid)}) exited before ready.`,
      );
    }
    if (fileExists(options.socketPath) && fileExists(options.metadataPath)) return;
    await sleepMs(POLL_INTERVAL_MS);
  }
  throw new CodeIntelError(
    `code-intel daemon did not become ready within ${String(options.timeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS)}ms.`,
  );
}

export type StopProcessOptions = {
  pid: number;
  timeoutMs?: number;
  isAlive?: (pid: number) => boolean;
  signal?: (pid: number, signal: NodeJS.Signals | number) => void;
  sleepMs?: (ms: number) => Promise<void>;
};

export async function stopProcess(options: StopProcessOptions): Promise<boolean> {
  const isAlive = options.isAlive ?? isProcessAlive;
  const signal = options.signal ?? sendSignal;
  const sleepMs = options.sleepMs ?? sleep;
  if (!isAlive(options.pid)) return false;
  signal(options.pid, "SIGTERM");
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS);
  while (Date.now() < deadline) {
    if (!isAlive(options.pid)) return true;
    await sleepMs(POLL_INTERVAL_MS);
  }
  signal(options.pid, "SIGKILL");
  return true;
}

function sendSignal(pid: number, signal: NodeJS.Signals | number): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    throw error;
  }
}

async function sleep(ms: number): Promise<void> {
  await delay(ms);
}
