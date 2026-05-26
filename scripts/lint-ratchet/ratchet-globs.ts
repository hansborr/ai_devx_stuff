import type { LintRatchetConfig } from "../lint-ratchet-config.js";

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

export function globToRegExp(pattern: string): RegExp {
  let source = "^";
  let index = 0;
  while (index < pattern.length) {
    const char = pattern[index] ?? "";
    if (char === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        source += "(?:[^/]+/)*";
        index += 3;
      } else {
        source += ".*";
        index += 2;
      }
    } else if (char === "*") {
      source += "[^/]*";
      index += 1;
    } else if (char === "?") {
      source += "[^/]";
      index += 1;
    } else if (char === "{") {
      const alternative = braceAlternative(pattern, index);
      if (alternative === undefined) {
        source += "\\{";
        index += 1;
      } else {
        source += alternative.source;
        index = alternative.next;
      }
    } else {
      source += escapeRegExp(char);
      index += 1;
    }
  }
  return new RegExp(`${source}$`, "u");
}

export function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}

export function matchesRatchet(ratchet: LintRatchetConfig, trackedFile: string): boolean {
  return matchesAny(trackedFile, ratchet.files) && !matchesAny(trackedFile, ratchet.ignores);
}
