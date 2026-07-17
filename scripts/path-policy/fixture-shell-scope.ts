// Minimal lexical scope scanner for fixture-copy commands. It recognizes both
// POSIX-style and `function`-keyword declarations, retains nested scope, joins
// continued shell lines, and excludes heredoc bodies from static inspection.

const standardFunctionDeclarationPattern = /^\s*([A-Za-z_]\w*)\s*\(\)\s*\{/u;
const keywordFunctionDeclarationPattern = /^\s*function\s+([A-Za-z_]\w*)\s*(?:\(\)\s*)?\{/u;
const functionEndPattern = /^\s*\}\s*(?:#.*)?$/u;
const heredocStartPattern = /<<-?\s*['"]?([A-Za-z_]\w*)['"]?/u;

export interface ScopedShellLine {
  readonly functionScope: readonly string[];
  readonly line: string;
}

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

function updateFunctionScope(
  line: string,
  functionScope: string[],
  declaredFunction?: string,
): void {
  if (declaredFunction !== undefined) {
    const openingBrace = line.indexOf("{");
    const closesOnSameLine = line.indexOf("}", openingBrace + 1) >= 0;
    if (!closesOnSameLine) functionScope.push(declaredFunction);
    return;
  }
  if (functionScope.length > 0 && functionEndPattern.test(line)) functionScope.pop();
}

export function collectScopedShellLines(source: string): readonly ScopedShellLine[] {
  const lines = source.replaceAll(/\\\r?\n/gu, " ").split(/\r?\n/u);
  const scopedLines: ScopedShellLine[] = [];
  const functionScope: string[] = [];
  let heredocDelimiter: string | undefined;

  for (const line of lines) {
    if (heredocDelimiter !== undefined) {
      if (line.trim() === heredocDelimiter) heredocDelimiter = undefined;
      continue;
    }

    const declaredFunction = declaredFunctionName(line);
    const lineScope =
      declaredFunction === undefined ? [...functionScope] : [...functionScope, declaredFunction];
    scopedLines.push({ functionScope: lineScope, line });

    const heredocMatch = heredocStartPattern.exec(line);
    if (heredocMatch !== null) heredocDelimiter = capturedName(heredocMatch);
    updateFunctionScope(line, functionScope, declaredFunction);
  }
  return scopedLines;
}
