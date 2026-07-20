// Minimal lexical scope scanner for fixture-copy commands. It recognizes both
// POSIX-style and `function`-keyword declarations, retains nested scope, joins
// continued shell lines, and excludes heredoc bodies from static inspection.
// Anonymous brace groups (`|| { ... }` guards, redirected `{ ... } > file`
// groups, and brace-shaped lines inside multi-line quoted strings, which stay
// balanced for JSON-like content) are tracked as unnamed frames so their
// closers never pop an enclosing function scope. Strings are not modelled;
// unbalanced braces inside quoted text can still skew the scope, which is the
// accepted limit of a lexical scanner.

const standardFunctionDeclarationPattern = /^\s*([A-Za-z_]\w*)\s*\(\)\s*\{/u;
const keywordFunctionDeclarationPattern = /^\s*function\s+([A-Za-z_]\w*)\s*(?:\(\)\s*)?\{/u;
// A bare `}` line ends the innermost frame — a function or an anonymous group.
const scopeEndPattern = /^\s*\}\s*(?:#.*)?$/u;
// `{` at end of line (bare, `|| {`, `&& {`, `cmd | {`) opens an anonymous group.
const groupOpenPattern = /\{$/u;
// `}` with a suffix (`} > file`, `},`, `}'`) only ever closes an anonymous
// group: repo functions conventionally end with a bare `}` line.
const groupCloseWithSuffixPattern = /^\s*\}/u;
const heredocStartPattern = /<<-?\s*['"]?([A-Za-z_]\w*)['"]?/u;

export interface ScopedShellLine {
  readonly functionScope: readonly string[];
  readonly line: string;
}

/** A named frame is a shell function; `undefined` is an anonymous brace group. */
type ScopeFrame = string | undefined;

function capturedName(match: RegExpMatchArray): string {
  const name = match[1];
  if (name === undefined) throw new Error("expected shell function-name capture");
  return name;
}

function declaredFunctionName(line: string): string | undefined {
  for (const pattern of [keywordFunctionDeclarationPattern, standardFunctionDeclarationPattern]) {
    const match = pattern.exec(line);
    if (match !== null) return capturedName(match);
  }
  return undefined;
}

function updateScopeFrames(line: string, frames: ScopeFrame[], declaredFunction?: string): void {
  if (declaredFunction !== undefined) {
    const openingBrace = line.indexOf("{");
    const closesOnSameLine = line.indexOf("}", openingBrace + 1) >= 0;
    if (!closesOnSameLine) frames.push(declaredFunction);
    return;
  }
  if (scopeEndPattern.test(line)) {
    if (frames.length > 0) frames.pop();
    return;
  }
  const trimmed = line.trim();
  if (groupOpenPattern.test(trimmed) && !trimmed.startsWith("#")) {
    frames.push(undefined);
    return;
  }
  if (groupCloseWithSuffixPattern.test(line) && frames.length > 0 && frames.at(-1) === undefined) {
    frames.pop();
  }
}

function namedFrames(frames: readonly ScopeFrame[]): string[] {
  return frames.filter((frame): frame is string => frame !== undefined);
}

export function collectScopedShellLines(source: string): readonly ScopedShellLine[] {
  const lines = source.replaceAll(/\\\r?\n/gu, " ").split(/\r?\n/u);
  const scopedLines: ScopedShellLine[] = [];
  const frames: ScopeFrame[] = [];
  let heredocDelimiter: string | undefined;

  for (const line of lines) {
    if (heredocDelimiter !== undefined) {
      if (line.trim() === heredocDelimiter) heredocDelimiter = undefined;
      continue;
    }

    const declaredFunction = declaredFunctionName(line);
    const lineScope =
      declaredFunction === undefined
        ? namedFrames(frames)
        : [...namedFrames(frames), declaredFunction];
    scopedLines.push({ functionScope: lineScope, line });

    const heredocMatch = heredocStartPattern.exec(line);
    if (heredocMatch !== null) heredocDelimiter = capturedName(heredocMatch);
    updateScopeFrames(line, frames, declaredFunction);
  }
  return scopedLines;
}
