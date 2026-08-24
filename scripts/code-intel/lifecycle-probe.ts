import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import { errorMessage } from "../lib/error-message.js";
import { isRecord } from "../lib/records.js";
import { DaemonRequestTimeoutError, defaultDaemonTransport } from "./daemon-client.js";
import {
  buildPingRequest,
  CODE_INTEL_DAEMON_PROTOCOL_VERSION,
  isPongResult,
} from "./daemon-protocol.js";
import type { DaemonMetadata, DaemonStatePaths } from "./daemon-state.js";

const LIFECYCLE_PROBE_TIMEOUT_MS = 1000;
const LIFECYCLE_PROBE_ID = "lifecycle-probe";

type DaemonLifecycleFailureKind = "stale" | "unverified";

export type DaemonLifecycleProbeResult =
  | { ok: true }
  | { failureKind: DaemonLifecycleFailureKind; ok: false; reason: string };

export type DaemonLifecycleProbe = (
  paths: DaemonStatePaths,
  metadata: DaemonMetadata,
) => Promise<DaemonLifecycleProbeResult>;

export type DaemonProcessIdentityResult =
  | { kind: "verified" }
  | { kind: "unverified"; reason: string };

export type DaemonProcessIdentityProbe = (
  metadata: DaemonMetadata,
  repoRoot: string,
  scriptPath: string,
) => DaemonProcessIdentityResult | Promise<DaemonProcessIdentityResult>;

export async function defaultLifecycleProbe(
  paths: DaemonStatePaths,
  _metadata: DaemonMetadata,
): Promise<DaemonLifecycleProbeResult> {
  if (!existsSync(paths.socketPath)) {
    return { failureKind: "stale", ok: false, reason: "socket missing" };
  }
  const payload = JSON.stringify(buildPingRequest(LIFECYCLE_PROBE_ID));
  try {
    const raw = await defaultDaemonTransport(paths.socketPath, payload, LIFECYCLE_PROBE_TIMEOUT_MS);
    return parseLifecycleProbe(raw);
  } catch (error) {
    return {
      failureKind: lifecycleFailureKindForError(error),
      ok: false,
      reason: `probe failed: ${errorMessage(error)}`,
    };
  }
}

export function defaultProcessIdentityProbe(
  metadata: DaemonMetadata,
  repoRoot: string,
  scriptPath: string,
): DaemonProcessIdentityResult {
  const cmdlinePath = path.join("/proc", String(metadata.pid), "cmdline");
  if (!existsSync(cmdlinePath)) {
    return { kind: "unverified", reason: "process identity unavailable" };
  }
  try {
    const args = readFileSync(cmdlinePath, "utf8").split("\0").filter(Boolean);
    if (args.length === 0) {
      return { kind: "unverified", reason: "process command line is empty" };
    }
    if (hasMatchingProcessIdentity(args, repoRoot, scriptPath)) return { kind: "verified" };
    return { kind: "unverified", reason: "process command does not match code-intel daemon" };
  } catch (error) {
    return { kind: "unverified", reason: `process identity failed: ${errorMessage(error)}` };
  }
}

function parseLifecycleProbe(raw: string): DaemonLifecycleProbeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      failureKind: "unverified",
      ok: false,
      reason: `invalid probe response: ${errorMessage(error)}`,
    };
  }
  if (!isRecord(parsed)) {
    return { failureKind: "unverified", ok: false, reason: "non-object probe response" };
  }
  if (parsed.id !== LIFECYCLE_PROBE_ID) {
    return { failureKind: "unverified", ok: false, reason: "probe id mismatch" };
  }
  if (parsed.protocolVersion !== CODE_INTEL_DAEMON_PROTOCOL_VERSION) {
    return { failureKind: "stale", ok: false, reason: "probe protocol mismatch" };
  }
  if (parsed.ok === true) {
    if (isPongResult(parsed.result)) return { ok: true };
    return { failureKind: "unverified", ok: false, reason: "unexpected probe response" };
  }
  return {
    failureKind: "unverified",
    ok: false,
    reason:
      parsed.ok === false && isRecord(parsed.error)
        ? "unexpected probe response"
        : "malformed probe response",
  };
}

function lifecycleFailureKindForError(error: unknown): DaemonLifecycleFailureKind {
  if (error instanceof DaemonRequestTimeoutError) return "unverified";
  return "stale";
}

function hasMatchingProcessIdentity(args: string[], repoRoot: string, scriptPath: string): boolean {
  return matchesProcessArg(args, scriptPath) && matchesProcessArg(args, realpathSync(repoRoot));
}

function matchesProcessArg(args: string[], expectedPath: string): boolean {
  const expectedRealpath = realpathIfPossible(expectedPath);
  for (const arg of args) {
    if (arg === expectedPath || arg === expectedRealpath) return true;
    if (realpathIfPossible(arg) === expectedRealpath) return true;
  }
  return false;
}

function realpathIfPossible(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}
