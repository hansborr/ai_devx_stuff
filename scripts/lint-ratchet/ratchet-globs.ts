// The glob-bearing subset shared by a registry ratchet and a committed baseline
// test, so the single matcher serves both without importing either concrete
// type. Both expose `files`/`ignores` as relative-glob arrays.
export interface RatchetGlobScope {
  readonly files: readonly string[];
  readonly ignores: readonly string[];
}

const GLOBSTAR_LENGTH = 2;
const GLOBSTAR_SLASH_LENGTH = 3;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function braceAlternative(
  pattern: string,
  start: number,
): { readonly source: string; readonly next: number } | undefined {
  const end = pattern.indexOf("}", start + 1);
  if (end === -1) return undefined;
  const parts = pattern
    .slice(start + 1, end)
    .split(",")
    .map((part) => escapeRegExp(part));
  return { source: `(?:${parts.join("|")})`, next: end + 1 };
}

interface GlobToken {
  readonly source: string;
  readonly next: number;
  readonly segmentStart: boolean;
}

function globstarToken(pattern: string, index: number): GlobToken {
  if (pattern[index + GLOBSTAR_LENGTH] === "/") {
    return {
      source: "(?:(?!\\.)[^/]+/)*",
      next: index + GLOBSTAR_SLASH_LENGTH,
      segmentStart: true,
    };
  }
  return { source: ".*", next: index + GLOBSTAR_LENGTH, segmentStart: false };
}

function braceToken(pattern: string, index: number): GlobToken {
  const alternative = braceAlternative(pattern, index);
  return alternative === undefined
    ? { source: "\\{", next: index + 1, segmentStart: false }
    : { ...alternative, segmentStart: false };
}

function segmentWildcardToken(char: "*" | "?", index: number, segmentStart: boolean): GlobToken {
  if (char === "*") {
    return {
      source: segmentStart ? "[^/.][^/]*" : "[^/]*",
      next: index + 1,
      segmentStart: false,
    };
  }
  return {
    source: segmentStart ? "[^/.]" : "[^/]",
    next: index + 1,
    segmentStart: false,
  };
}

export function globToRegExp(pattern: string): RegExp {
  let source = "^";
  let index = 0;
  let segmentStart = true;
  while (index < pattern.length) {
    const char = pattern[index] ?? "";
    if (char === "/") {
      source += "/";
      index += 1;
      segmentStart = true;
    } else if (char === "*" && pattern[index + 1] === "*") {
      const token = globstarToken(pattern, index);
      source += token.source;
      index = token.next;
      segmentStart = token.segmentStart;
    } else if (char === "*" || char === "?") {
      const token = segmentWildcardToken(char, index, segmentStart);
      source += token.source;
      index = token.next;
      segmentStart = token.segmentStart;
    } else if (char === "{") {
      const token = braceToken(pattern, index);
      source += token.source;
      index = token.next;
      segmentStart = token.segmentStart;
    } else {
      source += escapeRegExp(char);
      index += 1;
      segmentStart = false;
    }
  }
  return new RegExp(`${source}$`, "u");
}

export function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}

export function matchesRatchet(ratchet: RatchetGlobScope, trackedFile: string): boolean {
  return matchesAny(trackedFile, ratchet.files) && !matchesAny(trackedFile, ratchet.ignores);
}

export function matchingTrackedFiles(
  ratchet: RatchetGlobScope,
  trackedFiles: readonly string[],
): readonly string[] {
  return trackedFiles.filter((trackedFile) => matchesRatchet(ratchet, trackedFile));
}
