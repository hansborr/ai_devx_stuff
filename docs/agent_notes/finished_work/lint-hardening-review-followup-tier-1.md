# Lint-hardening review follow-up — Tier 1

Branch: `feature/lint-hardening-review-followup`
Landed: 2026-05-17

## Outcome

Six small follow-up fixes from the post-merge review of Leaf 12 Pass C
shipped as one bundled PR. Ten commits on top of `ffd68fb0`, all six standard
gates plus `verify:changed` exited 0.

## Commits (oldest first)

1. `dbeb45ff fix(lint): type-assertion-boundary accepts JSDoc, .spec.ts, and wider positions`
2. `e28fcc54 fix(commit): commitlint recognizes single-word trailer names` (reverted)
3. `057155e7 fix(sensor): sensor-blob-size labels block findings as BLOCK`
4. `ea6f43cd refactor(test): drop redundant result.success branches after Leaf 15`
5. `b74fd7d4 test(generate-lint-guidance): smoke test detects stale generated doc`
6. `944779fc ci: gate docs:lint-guidance:check in workflow`
7. `39b0f4ca Revert "fix(commit): commitlint recognizes single-word trailer names"`
8. `efd23ec2 fix(doctor): count BLOCK lines from sensor-blob-size in summary`
9. `e0b8ed82 fix(lint): type-assertion-boundary accepts multi-line JSDoc shapes`
10. `ad069759 chore(router): delete dead sorceryPoint.use and recover procedures`

## Decisions worth preserving

- **Commitlint trailer regex left as-is.** The scout's premise was wrong:
  `@commitlint/parse@21.0.1` already routes `Fixes:`/`Closes:`/`Refs:`/
  `BREAKING CHANGE:` to `parsed.footer` (body length 0). I verified this by
  feeding test commits through the parser directly. Widening the hyphen group
  to `*` regressed legitimate body paragraphs starting with single-word
  capitalized labels followed by `:` (e.g., `Why:`-style bullets). The widened
  version was reverted and the original regex stands.
- **Tier 1 item 5 split across two commits** (`057155e7` for the label,
  `efd23ec2` for the `doctor.sh` counter). The `doctor.sh` grep would have
  silently swallowed the relabel without the second commit — the report would
  say "0 warnings" while sensor-blob-size emitted `BLOCK:` lines.
- **Multi-line JSDoc support added in a follow-up** (`e0b8ed82`). The first
  pass's `\*?` only consumed one `*`, but block-comment `.value` strings start
  with `*\n * ...` for multi-line JSDoc; the second `*` failed the prefix
  test. Widened to `^[\s*]*type-assertion-boundary:` so any leading
  whitespace-and-asterisk mix is accepted. `LINE_BOUNDARY_COMMENT_PATTERN`
  separately rejects line comments with stray `*`.
- **Two adjacent Knip cleanups landed in the dead-procedure commit.** The
  Leaf 12 scout (`scripts/scout/leaf-12-type-assertion-scout.ts`) was a
  one-shot already-used file, and `PathIgnored` in
  `scripts/drift-ai/harness-freshness.ts` had no external importers. Both
  were Knip findings opened by item 1's deletions; the commit scope absorbs
  them rather than spawning a separate housekeeping commit.

## Tier 2 follow-ups (deferred)

Three larger PRs are scoped in `in_progress/lint-hardening-review-followup-pr-{1,2,3}-*.md`:

1. Rule contract test — guardrail for `type-assertion-boundary` so future
   changes don't silently widen acceptance.
2. Harness manifest — fold `drift:ai harness-freshness` into a single
   canonical manifest the rest of the harness reads from.
3. Machine-readable diagnostics — convert remaining textual diagnostics in
   the sensor surface to structured records.

Each is independently scoped; none should be promoted without explicit human
direction.
