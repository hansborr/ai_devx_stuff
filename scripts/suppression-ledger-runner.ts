// Default `RegisterRunner`: spawns one register scanner with `--identities-out`
// pointed at a temp file and hands back what it wrote. The register's own
// stdout (its PASS/FAIL policy report) is discarded here — that verdict belongs
// to the `suppressions` slot, which runs the same scripts for policy. Only
// stderr is kept, because that is where an unchecked failure explains itself.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { RegisterRunResult } from "./suppression-ledger-core.js";

const SPAWN_FAILURE_EXIT = 2;

interface RunRegisterOptions {
  readonly script: string;
  readonly cwd: string;
  readonly changedBase: string | undefined;
}

function registerArgs(options: RunRegisterOptions, identitiesPath: string): string[] {
  const args = [resolve(options.cwd, options.script)];
  if (options.changedBase !== undefined) args.push("--changed", options.changedBase);
  args.push("--identities-out", identitiesPath, options.cwd);
  return args;
}

function readIdentities(identitiesPath: string): string {
  try {
    return readFileSync(identitiesPath, "utf8");
  } catch {
    // The register exited before it opened the sink (bad usage, not a repo).
    // An empty emission is reported as unparseable by the caller.
    return "";
  }
}

export async function runRegisterForIdentities(
  options: RunRegisterOptions,
): Promise<RegisterRunResult> {
  const directory = mkdtempSync(join(tmpdir(), "musi-suppression-ledger-"));
  const identitiesPath = join(directory, "identities.tsv");

  return new Promise<RegisterRunResult>((settle) => {
    const child = spawn("bash", registerArgs(options, identitiesPath), {
      cwd: options.cwd,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error: Error) => {
      rmSync(directory, { recursive: true, force: true });
      settle({ exitCode: SPAWN_FAILURE_EXIT, identities: "", stderr: error.message });
    });
    child.on("close", (code) => {
      const identities = readIdentities(identitiesPath);
      rmSync(directory, { recursive: true, force: true });
      settle({ exitCode: code ?? SPAWN_FAILURE_EXIT, identities, stderr });
    });
  });
}
