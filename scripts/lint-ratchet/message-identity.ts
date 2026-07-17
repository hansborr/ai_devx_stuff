import { repoRoot } from "./paths.js";

const REPO_ROOT_TOKEN = "<repo-root>";
const CODE_FRAME_SOURCE_LINE_PATTERN = /^\s+\d+\s+\|/u;
const CODE_FRAME_TARGET_LINE_PATTERN = /^>\s+\d+\s+\|/u;
const CODE_FRAME_POINTER_LINE_PATTERN = /^\s+\|\s+\^/u;

export interface MessageIdentityLocation {
  readonly filePath: string;
  readonly line?: number;
  readonly column?: number;
}

function normalizeRepoRoot(value: string, repoRootPath: string): string {
  // String.replaceAll("") inserts the token between every character, riddling the
  // identity. An empty repo root has nothing to normalize, so pass the value through.
  if (repoRootPath.length === 0) return value;
  return value.replaceAll(repoRootPath, REPO_ROOT_TOKEN);
}

function isCodeFrame(lines: readonly string[]): boolean {
  if (lines.length === 0) return false;
  let hasSourceLine = false;
  let hasTargetLine = false;
  let hasPointerLine = false;

  for (const line of lines) {
    if (CODE_FRAME_SOURCE_LINE_PATTERN.test(line)) {
      hasSourceLine = true;
      continue;
    }
    if (CODE_FRAME_TARGET_LINE_PATTERN.test(line)) {
      hasTargetLine = true;
      continue;
    }
    if (CODE_FRAME_POINTER_LINE_PATTERN.test(line)) {
      hasPointerLine = true;
      continue;
    }
    return false;
  }

  return hasSourceLine && hasTargetLine && hasPointerLine;
}

function normalizedMessageForIdentity(
  message: string,
  location: MessageIdentityLocation,
  repoRootPath: string,
): string {
  const normalizedMessage = normalizeRepoRoot(message, repoRootPath);
  if (location.line === undefined || location.column === undefined) return normalizedMessage;

  const locationLine = `${normalizeRepoRoot(location.filePath, repoRootPath)}:${String(location.line)}:${String(location.column)}`;
  const lines = normalizedMessage.split("\n");
  const locationLineIndex = lines.lastIndexOf(locationLine);
  if (locationLineIndex < 0 || !isCodeFrame(lines.slice(locationLineIndex + 1))) {
    return normalizedMessage;
  }

  const semanticLines = lines.slice(0, locationLineIndex);
  if (semanticLines.at(-1) === "") semanticLines.pop();
  return semanticLines.join("\n");
}

export function messageIdentityForFinding(
  message: string | undefined,
  messageId: string | undefined,
  location: MessageIdentityLocation,
  repoRootPath: string = repoRoot,
): string | undefined {
  // Deliberate: when a rule supplies a messageId we key identity on the messageId
  // alone and drop the rendered message. The messageId is ESLint's canonical,
  // machine-independent identity for a diagnostic *kind*; the message is a human
  // rendering derived from it. For every message-count ratchet rule here the render
  // is a pure function of the messageId (local/type-assertion-boundary has static
  // messages; vitest/valid-expect fills its one placeholder from the fixed ratchet
  // options), so folding the message in adds no discrimination — while a
  // hypothetical rule with per-site placeholders (identifier names, counts) would
  // make this fingerprint flap on benign edits, the opposite of the stability this
  // module exists to provide. The equal-count swap detection is preserved where it
  // is meaningful: add/remove changes the count, and swapping across messageIds
  // changes the per-path identity multiset (see equalCountMessageSwapInfo). Only a
  // same-messageId, same-count swap is intentionally invisible, and for these rules
  // that is placeholder noise, not a semantically distinct violation. Introduced
  // intentionally in c2865a59; do not narrow back to {messageId, message} without
  // re-normalizing the message and re-baselining every messageId fingerprint.
  if (messageId !== undefined) return JSON.stringify({ messageId });
  if (message === undefined) return undefined;
  return JSON.stringify({
    message: normalizedMessageForIdentity(message, location, repoRootPath),
  });
}
