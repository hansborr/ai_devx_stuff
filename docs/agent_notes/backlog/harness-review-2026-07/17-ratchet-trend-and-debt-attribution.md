# 17. Debt is only observable as a snapshot — add `lint:ratchet:trend` from baseline git history and `--by-directory` summary grouping

Status: Done — `lint:ratchet:trend` (`package.json`) and `--by-directory` (`cli.ts`) shipped (`3b79af88`, `583e8357`); retained as historical design context.
Lens: ratchet · Area: reporting · Severity: low-med · Size: S-M · Confidence: high
Theme: debt-observability · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
`lint:ratchet:summary` prints a snapshot of the committed baseline (per-ratchet file count + total findings) and the debt log records only *accepted worsenings* (`--allow-worse` regressions and orphan removals — routine drains and improvement locks write nothing, by documented design). So there is no way to answer the campaign questions that matter when draining heavy debt across contributors: "is `strict-boolean-expressions-shared` actually going down month over month?", "which drain lanes moved the needle?", "which directory holds the remaining tailwind-value debt?". All the data already exists — every floor movement is a commit to `lint-ratchet.baseline.json`, and items are keyed by repo-relative file paths — it is just never aggregated.

## Evidence
- `/workspace/scripts/lint-ratchet/lint-ratchet-summary.ts:46-58` — rows are `{ fileCount, totalFindings }` folded from `test.items` of the single committed baseline; `:145-151` — reads only `baselinePath`, no history. Snapshot-only, verified.
- `/workspace/scripts/lint-ratchet/baseline-update-apply.ts:84-93` + `docs/guides/lint-ratchet.md:560-575` — debt log written only for accepted-worse updates; "routine tightening updates, improvement locks, and proven `--retire-ratchet` retirements write nothing". So the log cannot serve as a drain history.
- `/workspace/scripts/lint-ratchet/baseline-validation.ts:126-154` — `parseLintRatchetBaselineStructure` is the *structural* parser: it validates shape/version only and does NOT require the current registry to match, so historical baseline versions (with since-renamed or retired ratchet ids) parse cleanly. This is the property that makes a history walker cheap and safe.
- `lint-ratchet.baseline.json` items are repo-relative paths (e.g. `packages/client/src/components/campaign/chat/chat-panel.tsx`), so a directory fold is a trivial `dirname`-prefix grouping over existing data.

## Proposed direction
Two independent, zero-new-state additions:
1. `lint:ratchet:trend` (new CLI mode following the `cli.ts:39-48` pattern): walk `git log --format='%H %cI' -- lint-ratchet.baseline.json` (optionally `--since <date>` / `--max <n>`), `git show <sha>:lint-ratchet.baseline.json` each, parse with `parseLintRatchetBaselineStructure`, fold per-ratchet totals with the same reducer as `summarizeLintRatchetBaseline`, and print one row per (commit, ratchet) or a compact per-ratchet sparkline table (first/last/min/max/current). Read-only, no ESLint, no new committed files.
2. `--by-directory [depth]` on the existing `--summary` mode: group each ratchet's `items` by path prefix at the requested depth (default e.g. 3: `packages/client/src`) and print findings per directory, largest first. This is the "where do I point the next drain lane" view.

## Scope / caveats
- Trend reads history through the git CLI (`execFileSync` pattern already established in `git-tracked-files.ts:6-16`); it must tolerate unparseable historical versions (pre-`version: 1` shapes, merge-mangled blobs from driverless clones) by skipping the commit with a warning rather than failing.
- Renames of ratchet ids across history appear as one series ending and another starting; do not attempt id-mapping in v1 — print both.
- Two separable commits: (1) `--by-directory` summary grouping (pure fold + flag parsing + tests), (2) the `trend` mode (git plumbing + formatter + tests). Either lands alone.
- Keep both informational (never exit non-zero on findings), matching the documented posture of `--summary` (`docs/guides/lint-ratchet.md:504-512`).
