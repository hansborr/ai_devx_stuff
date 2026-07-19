// Owns "what state was the repo in when this scan ran": generated-artifact
// exclusions plus the repo-snapshot capture/completion logic scanners share.
import { captureGitStateFingerprint, gitRepoRootArgs, gitStatusPorcelainArgs } from "../lib/git.js";
import { defaultGitRunner, type GitRunner } from "./git-changed-scope.js";
import type { PrototypeScanProvenance } from "./prototype-advisory.js";

const STANDARD_TRIAGE_GENERATED_ARTIFACTS = [
  "drift-all.json",
  "semgrep-candidates.json",
  "dolos-candidates.json",
] as const;

/**
 * Keep provenance probes blind to the standard report set as well as any
 * caller-declared output paths. Scanners and packet generation must use this
 * same set or one report can make a sibling advisory look stale.
 */
export function triageGeneratedArtifactExclusions(
  additionalPaths: readonly string[] = [],
): string[] {
  return [...new Set([...STANDARD_TRIAGE_GENERATED_ARTIFACTS, ...additionalPaths])];
}

export type PrototypeScanSnapshot = {
  readonly provenance: Pick<PrototypeScanProvenance, "gitHead" | "gitDirty" | "stateFingerprint">;
  readonly stateToken: string | null;
};

export function capturePrototypeScanSnapshot(
  injectedGit: GitRunner | undefined,
  repoRoot: string,
  excludedPaths: readonly string[],
): PrototypeScanSnapshot {
  const git = injectedGit ?? defaultGitRunner();
  const gitHead = runGitProbe(git, gitRepoRootArgs(repoRoot, ["rev-parse", "HEAD"]));
  const status = runGitProbe(
    git,
    gitRepoRootArgs(repoRoot, gitStatusPorcelainArgs(repoRoot, excludedPaths)),
  );
  const stateFingerprint = captureGitStateFingerprint(git, repoRoot, excludedPaths);
  const normalizedHead = gitHead === null || gitHead.length === 0 ? null : gitHead;
  const baseStateToken =
    normalizedHead === null || status === null ? null : `${normalizedHead}\0${status}`;
  return {
    provenance: {
      gitHead: normalizedHead,
      gitDirty: status === null ? null : status.length > 0,
      stateFingerprint,
    },
    stateToken:
      baseStateToken === null || stateFingerprint === null
        ? null
        : `${baseStateToken}\0${stateFingerprint}`,
  };
}

export function completedScanProvenance(
  before: PrototypeScanSnapshot,
  after: PrototypeScanSnapshot,
): PrototypeScanProvenance {
  return {
    ...before.provenance,
    changedDuringScan:
      before.stateToken === null || after.stateToken === null
        ? null
        : before.stateToken !== after.stateToken,
  };
}

function runGitProbe(git: GitRunner, args: readonly string[]): string | null {
  try {
    const output = git(args).trim();
    return output.length > 0 ? output : "";
  } catch {
    return null;
  }
}
