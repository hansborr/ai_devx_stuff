import path from "node:path";

import { toPosix } from "./path-util.js";

export { isSourceLike, SOURCE_LIKE_EXTS, toPosix, uniqSorted } from "./path-util.js";

export const DEFAULT_GHOST_FILE_WEAK_TOKENS: readonly string[] = [
  "helper",
  "util",
  "service",
  "router",
  "component",
  "type",
  "schema",
  "model",
  "manager",
  "handler",
];

const DEFAULT_WEAK_TOKEN_SET: ReadonlySet<string> = new Set(DEFAULT_GHOST_FILE_WEAK_TOKENS);

const PEER_EXCLUDE_PATTERNS: readonly RegExp[] = [
  /\.test\.[cm]?[jt]sx?$/u,
  /\.spec\.[cm]?[jt]sx?$/u,
  /\.fixture\.[cm]?[jt]sx?$/u,
  /\.d\.ts$/u,
];

const SINGULAR_INVARIANTS = new Set<string>(["series", "species", "news"]);

export function tokenize(basename: string): string[] {
  const ext = path.extname(basename);
  const stem = ext.length > 0 ? basename.slice(0, -ext.length) : basename;
  if (stem.length === 0) return [];
  const segments = stem.split(/[^a-zA-Z0-9]+/u).filter((part) => part.length > 0);
  const tokens: string[] = [];
  for (const segment of segments) {
    const matches = segment.match(/[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+/gu);
    const parts = matches && matches.length > 0 ? matches : [segment];
    for (const part of parts) tokens.push(part.toLowerCase());
  }
  return tokens;
}

export function singularize(token: string): string {
  if (SINGULAR_INVARIANTS.has(token)) return token;
  if (token.length > 3 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && /(?:[sxz]|sh|ch)es$/u.test(token)) return token.slice(0, -2);
  if (token.length > 2 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

export function isExcludedSibling(filename: string): boolean {
  for (const pattern of PEER_EXCLUDE_PATTERNS) {
    if (pattern.test(filename)) return true;
  }
  return false;
}

export function isExcludedPath(filePath: string): boolean {
  const posix = toPosix(filePath);
  const segments = posix.split("/");
  if (segments.includes("__tests__")) return true;
  if (segments.includes("fixtures") || segments.includes("__fixtures__")) return true;
  const basename = segments[segments.length - 1] ?? "";
  return isExcludedSibling(basename);
}

export function normalizedTokens(basename: string): string[] {
  return tokenize(basename).map(singularize);
}

export function strongTokens(
  tokens: readonly string[],
  weakTokens: ReadonlySet<string> = DEFAULT_WEAK_TOKEN_SET,
): string[] {
  return tokens.filter((token) => !weakTokens.has(token));
}

export function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

// Members of `a` that are also in `b`, in `a`'s order, deduped. Both membership
// and dedup use Sets so the cost stays linear rather than the quadratic
// `Array.includes` scan a hand-rolled version invites.
export function intersection(a: readonly string[], b: readonly string[]): string[] {
  const lookup = new Set(b);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of a) {
    if (lookup.has(item) && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}
