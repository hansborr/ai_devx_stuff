import type { GhostFileMatch } from "./ghost-files-match.js";
import { sortFindingsByFileMessage } from "./path-util.js";
import type { DriftFinding } from "./types.js";

export const GHOST_FILES_REPAIR_HINT_PREFIX =
  "check whether the existing module should be extended.";

// Placeholder substituted with the file path when rendering a dependents hint.
const DEPENDENTS_HINT_PLACEHOLDER = "{path}";

// Repo-agnostic default for the "find what depends on this file" hint. A repo can
// override it with checks["ghost-files"].dependentsHint to wire in its own tooling
// (e.g. Musi sets a `bun run code:intel` command). Deliberately tool-neutral so it
// stays useful on an arbitrary target repo.
export const DEFAULT_DEPENDENTS_HINT = "Check what imports {path}";

function renderDependentsHint(template: string, filePath: string): string {
  return template.split(DEPENDENTS_HINT_PLACEHOLDER).join(filePath);
}

export function ghostMessage(match: GhostFileMatch): string {
  const tokens = match.sharedTokens.length > 0 ? match.sharedTokens.join(", ") : "(low overlap)";
  return `looks like a sibling of ${match.peerPath} (${match.kind}; shared tokens: ${tokens})`;
}

export function repairHint(peerPath: string, dependentsHint: string): string {
  return `${GHOST_FILES_REPAIR_HINT_PREFIX} ${renderDependentsHint(dependentsHint, peerPath)}`;
}

export function currentPairFinding(match: GhostFileMatch, dependentsHint: string): DriftFinding {
  const pair = orderedPair(match.newPath, match.peerPath);
  return {
    check: "ghost-files",
    file: pair.left,
    message: currentPairMessage(pair.left, pair.right, match),
    hint: currentPairHint(pair.left, pair.right, dependentsHint),
    relatedFiles: [pair.left, pair.right],
  };
}

function currentPairMessage(left: string, right: string, match: GhostFileMatch): string {
  const tokens = match.sharedTokens.length > 0 ? match.sharedTokens.join(", ") : "(low overlap)";
  return `${left} ↔ ${right} -- suspicious sibling pair (${match.kind}; shared tokens: ${tokens})`;
}

function currentPairHint(left: string, right: string, dependentsHint: string): string {
  // The same template is applied once per peer path (a locked decision); a
  // command-style hint reads as two runnable segments.
  return [
    "review whether the pair should be merged, renamed, or documented as intentionally separate.",
    `${renderDependentsHint(dependentsHint, left)}; ${renderDependentsHint(dependentsHint, right)}`,
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

export { sortFindingsByFileMessage as sortFindings };

function orderedPair(
  left: string,
  right: string,
): { readonly left: string; readonly right: string } {
  return left <= right ? { left, right } : { left: right, right: left };
}
