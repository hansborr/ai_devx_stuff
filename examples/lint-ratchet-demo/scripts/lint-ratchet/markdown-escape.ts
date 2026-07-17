export function escapeMarkdownText(value: string): string {
  return value
    .replace(/[\\`[\]()*_!]/gu, "\\$&")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(/[\r\n]+/gu, " ");
}

export function escapeMarkdownTableCell(value: string): string {
  return escapeMarkdownText(value).replaceAll("|", "\\|");
}

function normalizeMarkdownCodeText(value: string): string {
  return value.replaceAll(/[\r\n]+/gu, " ");
}

function longestBacktickRun(value: string): number {
  return Math.max(0, ...[...value.matchAll(/`+/gu)].map((match) => match[0].length));
}

export function markdownCode(value: string): string {
  const code = normalizeMarkdownCodeText(value);
  const delimiter = "`".repeat(longestBacktickRun(code) + 1);
  return delimiter.length === 1
    ? `${delimiter}${code}${delimiter}`
    : `${delimiter} ${code} ${delimiter}`;
}

/**
 * Escape prose that intentionally contains inline-code spans. Finding `why` /
 * `howToFix` strings are authored with backticked commands (`` Run `bun run
 * lint:fix` ``); running {@link escapeMarkdownText} over the whole string would
 * backslash-escape those backticks and render the commands as literal text.
 * This preserves single-backtick code spans — re-emitting them through
 * {@link markdownCode} so their fencing stays safe — and escapes only the prose
 * between them, keeping the `<`/`>` entity and newline handling for that prose.
 */
export function escapeMarkdownProse(value: string): string {
  let result = "";
  let lastIndex = 0;
  for (const match of value.matchAll(/`[^`]+`/gu)) {
    const start = match.index;
    result += escapeMarkdownText(value.slice(lastIndex, start));
    result += markdownCode(match[0].slice(1, -1));
    lastIndex = start + match[0].length;
  }
  result += escapeMarkdownText(value.slice(lastIndex));
  return result;
}
