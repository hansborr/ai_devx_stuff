# 202. Let the comment-density sensor inspect the harness code it is meant to protect

Status: Not started
Theme: Harness self-analysis coverage · Area: cross-cutting · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Musi treats `scripts/` and `eslint-rules/` as first-class analysis roots, but
the comment-density check excludes both trees wholesale. The harness therefore
offers contributors an automated signal for over-narrated application code
while withholding that same signal from hundreds of files implementing the
public harness reference itself.

The detector is already conservatively calibrated and report-only. It also
already filters tests, fixtures, declarations, and non-source files, so
blanket tree exclusions discard substantially more coverage than is needed to
avoid known false positives.

## Evidence

- `drift-ai.config.json:2-7` — `scripts` and `eslint-rules` are two of the five
  configured analyzer roots.
- `drift-ai.config.json:32-34` — the comments check nevertheless excludes
  `"scripts/"` and `"eslint-rules/"` in their entirety.
- `scripts/drift-ai/comments.ts:110-123` — the detector independently excludes
  declaration files, `__tests__`, fixture directories, and
  `*.test|spec|fixture.*` files before scoring.
- `scripts/drift-ai/scope.ts:24-31` and
  `scripts/drift-ai/comments.ts:198-200` — only configured JS/TS source
  extensions enter the comments check.
- Applying those literal built-in rules to tracked files at the pin leaves
  **577** source-like files under `scripts/` and `eslint-rules/` hidden by the
  two configured prefixes. Seven are `*.test-helper.ts` files because that
  suffix is not among the exclusion regex alternatives at
  `scripts/drift-ai/comments.ts:121-123`; the earlier count of 570 incorrectly
  removed them as though it were.
- `scripts/drift-ai/comments.ts:19-27,203-219` — a file is reported only above
  120 effective code lines and at a comment ratio of at least 40%.
- `scripts/drift-ai/cli-args.ts:51-57` — findings remain report-only by default;
  failing on findings requires the explicit `--fail-on-findings` option.

## Proposed direction

Replace the blanket `"scripts/"` and `"eslint-rules/"` `excludePrefixes` with
a short, reviewed list of generated, vendored, or deliberately prose-heavy
exceptions, while keeping the comments check advisory.

Start with the exact-file exception
`"eslint-rules/concurrency-guard.js"` rather than its parent tree: its
load-bearing concurrency and type-boundary commentary is the kind the
detector's own repair hint says to preserve
(`eslint-rules/concurrency-guard.js:3-48,218-250`). Do not add speculative
exceptions for generated shell files or fixture trees that are already
non-source or filtered by the built-in rules.

Calibrate the resulting surface with the existing read-only command
`bun run drift:ai --scope current --root scripts --root eslint-rules --check comments`.
Review every finding, and add another exclusion only for a concrete false
positive, using the narrowest exact file or generated/vendored subdirectory
prefix and recording why it is exceptional.

## Scope / caveats

- Keep the 120-effective-line and 40% thresholds unchanged. This leaf adjusts
  coverage, not detector sensitivity or line-classification semantics.
- Do not add `--fail-on-findings` to any gate or promote the check beyond its
  current report-only role.
- Do not remove the detector's test, fixture, declaration, or source-extension
  filters. The seven `*.test-helper.ts` files are part of the accurate current
  count; changing that policy is a separate decision.
- `excludePrefixes` uses literal prefix matching
  (`scripts/drift-ai/config-match.ts:31-34`), so avoid directory-level entries
  when one exact file is the intended exception.
