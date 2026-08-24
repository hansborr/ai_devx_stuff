# 225. Use the canonical Markdown table escaper in zero-baseline reports

Status: Landed on fix/cq-169
Theme: Zero-baseline reporting bypasses canonical Markdown table escaping · Area: harness · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The zero-baseline report passes disposition reasons and exit paths through a
private Markdown table-cell helper that handles only pipes and line feeds.
Backslashes, Markdown punctuation, carriage returns, and angle brackets remain
active in the generated document, so ordinary lifecycle prose can alter cell
rendering or introduce unintended Markdown or HTML.

The lint-ratchet package already has a stronger canonical escaper. Keeping a
weaker copy in this report makes its output inconsistent with other generated
reports and means future escaping fixes will not reach every producer.

## Evidence

- `tools/lint-ratchet/src/governance/zero-baseline.ts:188-190` — the private
  `markdownCell` helper escapes pipes and replaces LF, but handles no other
  Markdown or HTML-sensitive characters.
- `tools/lint-ratchet/src/governance/zero-baseline.ts:196-199` — `nextAction`
  returns a disposition's `exitPath` or `reason` directly.
- `tools/lint-ratchet/src/governance/zero-baseline.ts:253-262` — the table
  renderer passes ratchet ids, rule ids, and `nextAction(row)` through the
  private helper before joining the six existing columns.
- `tools/lint-ratchet/src/kernel/markdown-escape.ts:1-10` — the canonical
  `escapeMarkdownTableCell` additionally escapes backslashes, Markdown
  punctuation, angle brackets, CR/LF runs, and pipes.
- `tools/lint-ratchet/src/kernel/zero-baseline-types.ts:7-10` — disposition
  `reason` and optional `exitPath` are unconstrained strings.

## Proposed direction

Import `escapeMarkdownTableCell` from `kernel/markdown-escape.ts`, replace the
three `markdownCell` uses in the zero-baseline table renderer with that helper,
and delete the private duplicate. Keep the summary lines, column headers,
column order, and row assembly unchanged.

Extend `zero-baseline.test.ts` with disposition text containing pipes, CRLF,
backslashes, backticks or other Markdown punctuation, and `<`/`>` characters.
Assert the exact escaped table row, including that CRLF becomes one in-cell
space and no input creates an additional physical row. Cover both the
`reason` fallback and the preferred `exitPath` path.

## Scope / caveats

- Preserve the current six-column report layout and all summary text. This is
  an escaping substitution, not a report redesign.
- Keep the checked-mode plain-text failure formatter and its output unchanged;
  it is outside the Markdown table path.
- Do not change disposition values, precedence, truncation, or canonical
  escaping semantics. The shared helper remains the sole policy owner.
