# 14. Shared TS script substrate — first-adopter slices only

Status: Slices 1-3 Done 2026-07-07 (slice 1 branch chore/arch-14-git-runner,
merged; slices 2-3 branch chore/arch-14-git-substrate-s2). Further callers
migrate opportunistically, one per slice.
Size: M (per slice) · Severity: med · Risk: per-tool regression risk, low blast
radius per slice
Source: 00-report.md T6 / B2

## Progress

- **Slice 1 (Done 2026-07-07)** — Promoted the drift-ai `GitRunner` and the
  low-level git parsers to `scripts/lib/git.ts` (superset API: injectable
  `GitRunner`, `defaultGitRunner`, `resolveRepoRoot`, generic `parseNameStatus`
  returning raw code + path entries, and `mergeBase` returning
  `string | undefined`). drift-ai's `git-changed-scope.ts` is the sole consumer
  and re-exports/adapts them (`ChangedFile` mapping + `DriftAiError` policy on
  top); behavior unchanged, verified by focused tests plus a `--include-scope`
  diff of drift:ai output against pre-migration `main`. Landed as one code
  commit (`scripts/lib/git.ts`, `scripts/lib/git.test.ts`, and the
  `scripts/drift-ai/git-changed-scope.ts` adoption together — the changed-scope
  commit gate aborts on unstaged source, so the new lib and its sole consumer
  stage as one unit) plus this docs update.
- **Slice 2 (Done 2026-07-07)** — Migrated `lint-coverage-map-check-io.ts` onto
  `scripts/lib/git.ts` (logs-audit turned out to have no git plumbing, so
  lint-coverage-map was the git-caller of the two suggested). Two additive,
  drift-ai-preserving superset extensions: `defaultGitRunner({ cwd })` and
  `listTrackedFiles(git)` (unsorted; callers order tracked files differently).
  `loadTrackedFiles`/`loadStagedMapText` keep identical semantics; verified by
  a new focused test plus the existing staged integration tests, and a
  `lint-coverage-map-check` run diffed byte-for-byte against pre-migration main.
- **Slice 3 (Done 2026-07-07)** — Added `scripts/lib/cli.ts` (shared `parseCliArgs`
  arg loop + `parseFormatValue` text|json contract + `matchesOption`/`isHelpFlag`,
  layered over `cli-option-values.ts`). Adopted in harness:audit and logs:audit
  (full loop replacement) and code:intel (`parseFormatValue` + `matchesOption` in
  `parseGlobalOptions`). drift:ai's internal arg matrix left alone. The
  HarnessDiagnostics envelope output was already shared
  (`scripts/harness/harness-diagnostics-output.ts`), so cli.ts does not duplicate
  it. Behavior preserved: an arg-parsing battery diffed byte-for-byte against
  pre-migration main across all three tools, plus their existing suites and new
  `cli.test.ts`.

## Problem

Git plumbing is spawned independently in 19 TS files — drift-ai has a real
injectable `GitRunner` (`scripts/drift-ai/git-changed-scope.ts:54-64`) that
stops at the drift-ai boundary; lint-ratchet, logs-audit, sensor-blob-size,
lint-coverage-map each re-implement merge-base/name-status/tracked-files.
Three full arg-parser frameworks exist above one shared value-reader
(`scripts/cli-option-values.ts`).

## Scope — explicitly incremental

This is **not** a "migrate 19 callers" mission; dispatch one slice at a time:

1. Promote `GitRunner` to `scripts/lib/git.ts` (superset API — each caller
   has subtly different name-status/rename handling) with drift-ai as the
   first consumer, unchanged behavior.
2. Migrate one non-drift-ai caller (suggest lint-coverage-map or logs-audit)
   as the proof slice, with per-tool regression tests.
3. Add `scripts/lib/cli.ts` (arg loop + `--format` + `HarnessDiagnostics`
   envelope output) and adopt in the three simple tools (code-intel,
   logs-audit, harness-audit) first; leave drift-ai's internal arg matrix
   alone initially.

Further callers migrate opportunistically, one per slice, each with its own
verification.

## Verification

- Per-slice: the migrated tool's focused tests green plus one manual
  invocation diffed against pre-migration output.
