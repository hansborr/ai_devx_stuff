import { ConfigError } from "./metrics.js";

// The rule-source closure hash is only as trustworthy as the textual import
// scan that builds it. Two import shapes cannot be followed textually and would
// silently drop a real dependency from the hash — a stale-identity lie:
//   1. dynamic `import()`/`require()` calls (resolve to nothing textually);
//   2. a second static import after `;` on the same physical line (the `^\s*`
//      anchor of the scan patterns matches only the first import per line).
// The guard refuses both, turning the static-ES-module, one-import-per-line
// convention the closure relies on into an enforced invariant. The keyword
// lookbehind `(?<![.\w$])` keeps ordinary identifiers that merely end in the
// keyword (`preRequire(`, `foo.import(`) from tripping it.
const DYNAMIC_IMPORT_OR_REQUIRE_CALL_PATTERN = /(?<![.\w$])(?:import|require)\s*\(/u;
const SECOND_STATIC_IMPORT_ON_LINE_PATTERN =
  /;[^\S\n]*(?:import(?:\s[^'"]+\sfrom\s+|\s*)|export\s[^'"]*?\sfrom\s+)["']/u;

// A `/…/flags` regex literal, but only in *value position* — where a `/` opens
// a regex rather than being division. The lookbehind requires the preceding
// non-space token to be an expression start (line start, an operator, `(`, `,`,
// `:`, `;`, `[`, `{`, `=>`, or a keyword like return/typeof/case): a `/` after a
// value (identifier, `)`, `]`, digit — e.g. `a / b`, `x /= 2`) is left as code,
// so real division is never masked. Rule sources are static, so these contexts
// cover the realistic shapes. The body tolerates escapes and character classes
// (which may themselves contain `/`). Masking regex contents closes two holes a
// string-only tokenizer leaves: an import-analyzing literal like `/import\s*\(/`
// no longer false-positives, and a lone quote inside a regex literal (`/"/`) no
// longer desyncs quote pairing for the rest of the file.
const REGEX_LITERAL_SOURCE =
  String.raw`(?<=(?:^|[=(,:;[{!&|?+\-*%^~<>]|\b(?:return|typeof|instanceof|in|of|yield|await|void|delete|do|else|case|new))\s*)` +
  String.raw`\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[a-z]*`;

// One comment, string/template literal, or (value-position) regex literal.
// Comments are matched two-char (`//`, `/*`); each string alternative tolerates
// escapes and an unterminated tail (`"?`/`'?`/`` `? ``) so a stray quote near
// EOF still consumes to the end instead of desyncing the scan.
const COMMENT_OR_LITERAL_TOKEN = new RegExp(
  [
    String.raw`\/\/[^\n]*`,
    String.raw`\/\*[\s\S]*?\*\/`,
    String.raw`"(?:\\.|[^"\\])*"?`,
    String.raw`'(?:\\.|[^'\\])*'?`,
    "`(?:\\\\.|[^`\\\\])*`?",
    REGEX_LITERAL_SOURCE,
  ].join("|"),
  "gu",
);

function blankNonNewline(text: string): string {
  return text.replaceAll(/[^\n]/gu, " ");
}

// Blank the *contents* of comments and string/template literals so the guard
// patterns see only code. Comments blank whole; literals keep their delimiters
// (the second-import pattern anchors on a specifier's opening quote) and blank
// the middle. Newlines survive throughout so line anchors stay aligned. This is
// what makes the guard string-aware: `import(`/`require(` written inside a
// string or template (a message, a factory-source literal) is not read as a
// call, and a string containing `//` (e.g. `"http://x"`) is not mistaken for a
// line comment that would erase a real `import(` after it on the same line.
// Deliberately bounded — it does not track regex literals or `${}` interpolation
// — enough to make the guard string-aware without a full module lexer.
function maskCommentsAndLiteralsForGuard(source: string): string {
  return source.replaceAll(COMMENT_OR_LITERAL_TOKEN, (token) => {
    const delimiter = token[0] ?? "";
    if (delimiter === "/") return blankNonNewline(token);
    const hasClosingDelimiter = token.length > 1 && token.endsWith(delimiter);
    const inner = hasClosingDelimiter ? token.slice(1, -1) : token.slice(1);
    return `${delimiter}${blankNonNewline(inner)}${hasClosingDelimiter ? delimiter : ""}`;
  });
}

// Fail closed on the two textually-unfollowable import shapes. Runs over
// `maskCommentsAndLiteralsForGuard(source)` so `import(`/`require(`/`//` bytes
// inside a string or comment can neither raise a false positive nor hide a real
// dynamic import behind a comment-like sequence in a preceding string literal.
// Takes the raw (not comment-stripped) source so the literal masking is intact.
export function assertScannableImports(path: string, source: string): void {
  const guardable = maskCommentsAndLiteralsForGuard(source);
  if (DYNAMIC_IMPORT_OR_REQUIRE_CALL_PATTERN.test(guardable)) {
    throw new ConfigError(
      `local rule source ${path} uses dynamic import()/require(); rule-source closures must be static ES modules so every dependency is captured in the identity hash`,
    );
  }
  if (SECOND_STATIC_IMPORT_ON_LINE_PATTERN.test(guardable)) {
    throw new ConfigError(
      `local rule source ${path} places more than one import on a single line; put each import on its own line so all are captured in the identity hash`,
    );
  }
}
