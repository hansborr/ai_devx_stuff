import type { GhostFileMatch } from "./ghost-files-match.js";
import type { DriftFinding } from "./types.js";

export const GHOST_FILES_REPAIR_HINT_PREFIX =
  "check whether the existing module should be extended. Run:";

export function ghostMessage(match: GhostFileMatch): string {
  const tokens = match.sharedTokens.length > 0 ? match.sharedTokens.join(", ") : "(low overlap)";
  return `looks like a sibling of ${match.peerPath} (${match.kind}; shared tokens: ${tokens})`;
}

export function repairHint(peerPath: string): string {
  return `${GHOST_FILES_REPAIR_HINT_PREFIX} bun run code:intel -- dependents ${peerPath}`;
}

export function currentPairFinding(match: GhostFileMatch): DriftFinding {
  const pair = orderedPair(match.newPath, match.peerPath);
  return {
    check: "ghost-files",
    file: pair.left,
    message: currentPairMessage(pair.left, pair.right, match),
    hint: currentPairHint(pair.left, pair.right),
    relatedFiles: [pair.left, pair.right],
  };
}

function currentPairMessage(left: string, right: string, match: GhostFileMatch): string {
  const tokens = match.sharedTokens.length > 0 ? match.sharedTokens.join(", ") : "(low overlap)";
  return `${left} ↔ ${right} -- suspicious sibling pair (${match.kind}; shared tokens: ${tokens})`;
}

function currentPairHint(left: string, right: string): string {
  return [
    "review whether the pair should be merged, renamed, or documented as intentionally separate.",
    `Run: bun run code:intel -- dependents ${left}; bun run code:intel -- dependents ${right}`,
  ].join(" ");
}

export function oversizedBucketHint(): string {
  return "rerun with --root <narrower path> or tighten ignore globs in drift-ai.config.json.";
}

export function pairKey(left: string, right: string): string {
  const pair = orderedPair(left, right);
  return `${pair.left}\u0000${pair.right}`;
}

export function relatedFiles(left: string, right: string): readonly string[] {
  const pair = orderedPair(left, right);
  return [pair.left, pair.right];
}

export function sortFindings(findings: readonly DriftFinding[]): DriftFinding[] {
  return [...findings].sort(
    (left, right) =>
      left.file.localeCompare(right.file, "en") || left.message.localeCompare(right.message, "en"),
  );
}

function orderedPair(
  left: string,
  right: string,
): { readonly left: string; readonly right: string } {
  return left <= right ? { left, right } : { left: right, right: left };
}
