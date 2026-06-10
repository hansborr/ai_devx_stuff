// Shared markdown inline-code scanning for the docs-freshness sensors. Both
// `harness-freshness` (docs/ai-harness.md backtick paths) and `module-doc-paths`
// (MODULE.md backtick paths) need the same fenced-code-aware token walk; the path
// *qualification* differs per check, so only the token extraction lives here.

const INLINE_BACKTICK_RE = /`([^`\n]+)`/gu;
const FENCE_RE = /^ {0,3}```/u;

export type InlineCodeToken = {
  // The raw text between the backticks, verbatim (callers normalize/qualify it).
  readonly raw: string;
  // 1-based line number of the token's opening backtick.
  readonly line: number;
};

// Yields every inline-code span (`` `like this` ``) outside fenced code blocks,
// with its 1-based line. Fenced blocks are skipped so example/code snippets do not
// masquerade as live path references.
export function extractInlineCodeTokens(markdown: string): InlineCodeToken[] {
  const tokens: InlineCodeToken[] = [];
  let inFence = false;
  for (const [lineIndex, line] of markdown.split("\n").entries()) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const match of line.matchAll(INLINE_BACKTICK_RE)) {
      const raw = match[1];
      if (raw === undefined) continue;
      tokens.push({ raw, line: lineIndex + 1 });
    }
  }
  return tokens;
}
