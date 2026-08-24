// Path policy and fixture analysis intentionally use two segment-pattern
// dialects. Policy selectors treat `*` as their only pattern character; `?`
// and `[` are rejected, while `]` and ordinary RegExp punctuation are escaped
// as literals. Fixture shell globs treat `*`, `?`, and `[` as syntax and leave
// `]` available to close a bracket expression; their bracket handling is the
// existing JavaScript RegExp character-class approximation, not exact shell
// semantics. In both dialects `*` cannot consume `/`, fixture `?` cannot
// consume `/`, and literal separators in a pattern match separators exactly.

const shellGlobSyntaxPattern = /[*?[]/u;
const unsupportedStarOnlySyntaxPattern = /[?[]/u;
const regexSpecialCharacters = /[\\^$+?.()|[\]{}]/gu;

const escapeRegexLiteral = (value: string): string => value.replace(regexSpecialCharacters, "\\$&");

/** True when fixture analysis must treat a value as shell-glob-shaped. */
export function hasShellGlobSyntax(value: string): boolean {
  return shellGlobSyntaxPattern.test(value);
}

/** Match the deliberately narrow `*`-only language used by path policy. */
export function matchStarOnlySegmentPattern(value: string, pattern: string): boolean {
  if (unsupportedStarOnlySyntaxPattern.test(pattern)) {
    throw new Error(`star-only segment pattern contains unsupported syntax: ${pattern}`);
  }
  const expression = pattern.split("*").map(escapeRegexLiteral).join("[^/]*");
  return new RegExp(`^${expression}$`, "u").test(value);
}

/** Compile the fixture analyzer's current RegExp approximation of a shell glob. */
export function compileShellSegmentGlob(pattern: string): RegExp {
  const escaped = pattern.replaceAll(/[.+^${}()|\\]/gu, String.raw`\$&`);
  return new RegExp(`^${escaped.replaceAll("*", "[^/]*").replaceAll("?", "[^/]")}$`, "u");
}
