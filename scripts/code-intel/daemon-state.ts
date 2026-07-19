import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, unlinkSync } from "node:fs";
import path from "node:path";

import { writeFileAtomicallySync } from "../lib/atomic-write.js";
import { CODE_INTEL_DAEMON_PROTOCOL_VERSION } from "./daemon-protocol.js";
import { CodeIntelError } from "./errors.js";
import { isRecord } from "./json-utils.js";

const REPO_KEY_LENGTH = 16;
const METADATA_INDENT = 2;

const DEFAULT_DAEMON_ROOT_DIR = "/tmp/musi-code-intel";

export type DaemonStatePaths = {
  metadataPath: string;
  pidPath: string;
  rootDir: string;
  socketPath: string;
  stateDir: string;
};

export type DaemonMetadata = {
  pid: number;
  protocolVersion: number;
  repoRealpath: string;
  repoRoot: string;
  socketPath: string;
  startedAt: string;
};

export type DaemonStateOptions = {
  realpathSync?: (target: string) => string;
  rootDir?: string;
};

export function computeRepoKey(repoRealpath: string): string {
  return createHash("sha256").update(repoRealpath).digest("hex").slice(0, REPO_KEY_LENGTH);
}

export function resolveDaemonStatePaths(
  repoRoot: string,
  options: DaemonStateOptions = {},
): DaemonStatePaths {
  const resolveRealpath = options.realpathSync ?? realpathSync;
  const repoRealpath = resolveRealpath(repoRoot);
  const rootDir = options.rootDir ?? DEFAULT_DAEMON_ROOT_DIR;
  const stateDir = path.join(rootDir, computeRepoKey(repoRealpath));
  return {
    metadataPath: path.join(stateDir, "daemon.json"),
    pidPath: path.join(stateDir, "daemon.pid"),
    rootDir,
    socketPath: path.join(stateDir, "daemon.sock"),
    stateDir,
  };
}

export function ensureStateDir(paths: DaemonStatePaths): void {
  mkdirSync(paths.stateDir, { recursive: true });
}

// Metadata + pidfile are each replaced atomically; the pair itself is
// still a two-file publication (pair atomicity is a non-goal).
export function writeDaemonMetadata(paths: DaemonStatePaths, metadata: DaemonMetadata): void {
  ensureStateDir(paths);
  writeFileAtomicallySync(
    paths.metadataPath,
    `${JSON.stringify(metadata, null, METADATA_INDENT)}\n`,
  );
  writeFileAtomicallySync(paths.pidPath, `${String(metadata.pid)}\n`);
}

export function readDaemonMetadata(paths: DaemonStatePaths): DaemonMetadata | undefined {
  if (!existsSync(paths.metadataPath)) return undefined;
  const text = readFileSync(paths.metadataPath, "utf8");
  const parsed: unknown = JSON.parse(text);
  if (!isDaemonMetadata(parsed)) {
    throw new CodeIntelError(`Invalid daemon metadata at ${paths.metadataPath}`);
  }
  return parsed;
}

export function readDaemonPid(paths: DaemonStatePaths): number | undefined {
  if (!existsSync(paths.pidPath)) return undefined;
  const text = readFileSync(paths.pidPath, "utf8").trim();
  if (text === "") return undefined;
  const pid = Number(text);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

export function clearDaemonState(paths: DaemonStatePaths): void {
  rmSync(paths.stateDir, { force: true, recursive: true });
}

export function unlinkSocketFile(paths: DaemonStatePaths): void {
  if (!existsSync(paths.socketPath)) return;
  try {
    unlinkSync(paths.socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; // type-assertion-boundary: interop - node:fs unlinkSync throws ErrnoException; narrowing to inspect .code and tolerate ENOENT races
  }
}

export type BuildDaemonMetadataInput = {
  paths: DaemonStatePaths;
  pid: number;
  repoRealpath: string;
  repoRoot: string;
  startedAt?: Date;
};

export function buildDaemonMetadata(input: BuildDaemonMetadataInput): DaemonMetadata {
  return {
    pid: input.pid,
    protocolVersion: CODE_INTEL_DAEMON_PROTOCOL_VERSION,
    repoRealpath: input.repoRealpath,
    repoRoot: input.repoRoot,
    socketPath: input.paths.socketPath,
    startedAt: (input.startedAt ?? new Date()).toISOString(),
  };
}

function isDaemonMetadata(value: unknown): value is DaemonMetadata {
  if (!isRecord(value)) return false;
  return (
    typeof value.pid === "number" &&
    typeof value.protocolVersion === "number" &&
    typeof value.repoRealpath === "string" &&
    typeof value.repoRoot === "string" &&
    typeof value.socketPath === "string" &&
    typeof value.startedAt === "string"
  );
}
