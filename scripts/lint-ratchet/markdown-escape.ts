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
