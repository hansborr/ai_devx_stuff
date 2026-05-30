# 20 — Shared path-util module (kill the copy-pasted helpers)

Status: Done
Track: A (architecture / single report)
Size: small
Depends on: none
Blocks: 21 (check-plugin registry), 50 (re-split duplicates/suppressions module pairs)

**Do this FIRST of the architecture track.** It is mechanical, removes a real
correctness bug, and gives task 21 a single home for the helpers it will move
around.

## Goal

Extract one canonical `scripts/drift-ai/path-util.ts` and replace every
copy-pasted private helper with an import from it. This is the duplication the
tool itself would flag — and one of the copies (`toPosix`) has **already
diverged**, so this is a correctness fix, not just tidiness.

## Background

Read [`01-shared-context.md`](./01-shared-context.md) and
[`02-seam-map.md`](./02-seam-map.md) first; together with this file they are
enough — you should not need the source docs.

The `local/max-lines` (300) ratchet forced three modules
(`duplicates`/`duplicates-runner`, `suppressions`/`suppressions-parse`,
`harness-freshness`/`harness-freshness-io`) to split in half, and private
helpers were copy-pasted across the split seam instead of extracted. Deeper
rationale: `../drift-ai-review/code-quality.md` High-1 and
`../drift-ai-improvements.md` B1.

The load-bearing fact: the `toPosix` variants are **not equivalent**, so the
`duplicates` and `comments` checks can normalize the same path differently. That
is a latent bug this task closes.

## Seams to touch

All from seam-map **§3 (Shared-helper duplication)**. Re-confirm every anchor
before editing — the seam map warns its line numbers drift as the source moves.
Verified current anchors in `duplicates-runner.ts` (2026-05-29): `toPosix` :201,
`isSourceLike` :205, `isExcludedFromDuplicates` :209, `configuredRootFor` :213,
`sortDuplicateFindings` :288, `changedFilesFromScope` :295. Grep for the
definition name rather than trusting the line number.

- **`toPosix` / `normalizeRepoPath`** (the canonical-pick decision):
  - `config-parsing.ts:60–65` — exported `normalizeRepoPath` (splits on
    `path.sep`, trims `./` and trailing slash). **This is the canonical
    normalization** — adopt it as `toPosix`'s body.
  - `duplicates-runner.ts:201` — private `toPosix` that already wraps
    `normalizeRepoPath` (so duplicates is already on the canonical path).
  - The other `toPosix` copies the review flagged (ghost-files does
    `replace(/\\/gu,"/").split(path.sep).join("/")`; comments does only
    `split(path.sep).join("/")`) are the **divergent** ones — they do NOT trim
    `./` or trailing slash. Grep `function toPosix` / `const toPosix` across
    `scripts/drift-ai/*.ts` to find every current site (the review counted 4)
    and route them all to the canonical version.
- **`isSourceLike`**:
  - `ghost-files-tokens.ts:67–72` (param `sourceExtensions`, default
    `SOURCE_LIKE_EXTS`) — **the more complete version; make this canonical.**
  - `duplicates-runner.ts:205` (param `supportedExtensions`).
- **`uniqSorted`**: defined `ghost-files-tokens.ts:82–84` (exported), imported by
  `ghost-files-match.ts:11`, `ghost-files-current.ts:9`. (Review also noted
  variants in `config.ts`/`config-parsing.ts` — grep to confirm and fold in.)
- **`changedFilesFromScope`**: byte-identical in `duplicates-runner.ts:295–306`
  and `ghost-files-changed.ts:86–97`. (Review noted a third `map`-shaped variant
  in `suppressions.ts` — fold it in only if behaviorally identical.)
- **Sort comparator**: `sortDuplicateFindings` (`duplicates-runner.ts:288–293`)
  and `sortFindings` (`ghost-files-findings.ts:53–58`) are the same logic —
  extract one comparator, e.g. `sortFindingsByFileMessage`.
- **`isExcludedFromDuplicates`** (`duplicates-runner.ts:209`), `configuredRootFor`
  (`duplicates-runner.ts:213`) — patterns parallel to `ghost-files-tokens.ts`
  `isExcludedPath` (58–65). Extract only if a single signature genuinely serves
  both; if they differ in inputs, leave them and note why (don't force a
  false-shared helper).

## What to do

1. Create `scripts/drift-ai/path-util.ts` exporting the canonical set:
   - `toPosix(value: string): string` — body = the `normalizeRepoPath`-based
     normalization (split on `path.sep`, trim leading `./`, trim trailing slash,
     normalize backslashes). Keep `normalizeRepoPath` in `config-parsing.ts` if
     other config helpers depend on it, and have it delegate to (or re-export)
     `path-util`'s `toPosix` so there is exactly one implementation.
   - `isSourceLike(value, sourceExtensions)` — the `ghost-files-tokens.ts`
     version.
   - `uniqSorted(values)` — moved from `ghost-files-tokens.ts`.
   - `changedFilesFromScope(scope)` — the byte-identical body.
   - `sortFindingsByFileMessage(a, b)` — the shared comparator.
2. Replace every copy with an import from `path-util.ts`. Delete the now-dead
   local definitions. Keep exports stable where other modules import a helper by
   name (re-export from the old module if a wide import surface makes a clean cut
   noisy — but prefer importing directly from `path-util`).
3. Confirm the duplicates and comments checks now share one `toPosix`, closing
   the divergence.

## Acceptance

- No duplicated definitions of `toPosix`, `isSourceLike`, `uniqSorted`,
  `changedFilesFromScope`, or the finding sort comparator remain (grep each name;
  one definition site each, in `path-util.ts`).
- Existing ghost-files and comments fixtures still pass unchanged.
- The whole drift-ai test suite is green.

## Open decisions

- **Where `normalizeRepoPath` lives.** Recommend: canonical body moves to
  `path-util.ts` as `toPosix`; `config-parsing.ts` keeps `normalizeRepoPath` as a
  thin re-export/alias so config-internal call sites don't churn. Don't duplicate
  the body.
- **Whether to fold `isExcludedFromDuplicates`/`configuredRootFor`.** Recommend:
  only if one signature cleanly serves both checks; otherwise leave them and add
  a one-line note. A forced shared helper is worse than honest duplication.
- **Comparator name.** Recommend `sortFindingsByFileMessage` (descriptive of the
  tie-break order: file then message).

## Testing

- Add `scripts/drift-ai/path-util.test.ts` that **pins the chosen `toPosix`
  normalization** with explicit cases: backslash separators (`a\\b\\c`), a
  leading `./` (`./a/b`), a trailing slash (`a/b/`), and a `path.sep`-joined
  input. This is the regression guard for the divergence this task fixes — assert
  the canonical (`./`-and-trailing-slash-trimming) behavior, so a future copy
  that reintroduces the weaker normalization fails the test.
- Run the existing drift-ai tests (`comments.test.ts`, `ghost-files.test.ts`,
  `duplicates.test.ts`, `suppressions.test.ts`, `scope.test.ts`,
  `current-inventory.test.ts`) before and after. Stage your changes and run
  `bun run verify:changed`, or run the drift-ai test files directly via the
  repo's vitest.

## Out of scope

- Re-splitting the `duplicates`/`duplicates-runner` and
  `suppressions`/`suppressions-parse` module pairs along a real responsibility
  axis (that is task 50 / Med-3, which becomes possible *after* this task).
- The shared comment/string lexer (Med-4) — different concern.
- The shared `safeRepoPath` reader / `formatFindingLines` renderer for
  `harness-freshness` (Med-1) — separate task; this task only handles the
  path/scope/sort helpers.
- Any check-dispatch changes (task 21).
