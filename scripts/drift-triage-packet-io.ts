import { spawnSync } from "node:child_process";
import { join } from "node:path";

import type { TriagePacketBundle, TriagePacketProvenance } from "./drift-ai/triage-packet-types.js";
import { renderPacket } from "./drift-ai/triage-packets.js";
import { captureGitStateFingerprint, type GitRunner, gitStatusPorcelainArgs } from "./lib/git.js";

const JSON_INDENT = 2;

export type RepoProvenance = Pick<
  TriagePacketProvenance,
  "gitHead" | "gitDirty" | "stateFingerprint"
>;

export function writePacketBundle(
  packetDir: string,
  bundle: TriagePacketBundle,
  writeFile: (filePath: string, contents: string) => void,
): void {
  for (const packet of bundle.packets) {
    writeFile(join(packetDir, `${packet.packetId}.json`), renderPacket(packet));
  }
  writeFile(join(packetDir, "manifest.json"), JSON.stringify(bundle.manifest, null, JSON_INDENT));
}

export function resolveRepoProvenance(excludedPaths: readonly string[] = []): RepoProvenance {
  const repoRoot = runGit(["rev-parse", "--show-toplevel"]);
  const gitHead = runGit(["rev-parse", "HEAD"], repoRoot);
  const status = runGit(
    repoRoot === null ? ["status", "--porcelain"] : gitStatusPorcelainArgs(repoRoot, excludedPaths),
    repoRoot,
  );
  const stateFingerprint =
    repoRoot === null ? null : captureGitStateFingerprint(systemGitRunner, repoRoot, excludedPaths);
  return { gitHead, gitDirty: status === null ? null : status.length > 0, stateFingerprint };
}

const systemGitRunner: GitRunner = (args) => {
  const output = runRawGit(args);
  if (output === null) throw new Error("git probe failed");
  return output;
};

function runGit(args: readonly string[], cwd?: string | null): string | null {
  return runRawGit(args, cwd)?.trim() ?? null;
}

function runRawGit(args: readonly string[], cwd?: string | null): string | null {
  const result = spawnSync("git", args, { cwd: cwd ?? undefined, encoding: "utf8" });
  if (result.status !== 0 || result.error !== undefined) return null;
  return result.stdout;
}
