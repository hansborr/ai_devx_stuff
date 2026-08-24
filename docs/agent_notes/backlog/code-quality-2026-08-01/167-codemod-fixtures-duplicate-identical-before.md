# 167. No-op codemod fixtures copy 324 lines into redundant after trees

Status: Landed on fix/cq-167
Theme: codemod fixture convention · Area: harness · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Codemod fixtures use two representations for an unchanged result. Expand-barrel permits a missing `after/` directory to mean “the output must still equal `before/`,” while the other runners require fixture authors to copy an identical tree into `after/`.

The copies add no oracle: reviewers must compare two trees only to discover that they are byte-identical. They also make an established no-op convention appear runner-specific, increasing the chance that new public-harness examples repeat the redundant form.

## Evidence

- A pin-local directory comparison finds exactly 90 fixture cases under `scripts/codemods/fixtures/`; 35 cases have byte-identical `before/` and `after/` trees containing 44 duplicated files and 324 duplicated lines.
- The measured distribution is 9 of 9 cases in `scripts/codemods/fixtures/concurrency-guard/`, 1 of 16 in `scripts/codemods/fixtures/expand-barrel/`, 4 of 14 in `scripts/codemods/fixtures/structured-logging-fix/`, 10 of 27 in `scripts/codemods/fixtures/trpc-shared-input/`, and 11 of 24 in `scripts/codemods/fixtures/trpc-shared-output/`.
- `scripts/codemods/expand-barrel.test.ts:61-64` already selects `after/` when present and falls back to `before/` when it is absent; both comparison sites use that selector at `:79` and `:102`.
- The other runners hard-require `after/` at `scripts/codemods/concurrency-guard.test.ts:74,79`, `scripts/codemods/structured-logging-fix.test.ts:88,111`, and `scripts/codemods/trpc-shared-schema-codemod.test.ts:124,149`.
- `scripts/codemods/lib/fixture-runner.test-helper.ts:6-14` already identifies these four test files as one shared fixture-runner family, and its directory assertion at `:99-107` compares both the relative file set and every file’s contents.

## Proposed direction

Move the missing-`after/`-means-unchanged fallback from `expand-barrel.test.ts:61-64` into `scripts/codemods/lib/fixture-runner.test-helper.ts`, adopt it in all four codemod runners, and delete the 35 byte-identical `after/` trees containing 44 files.

Expose one shared expected-root selector that returns `after/` when it exists and `before/` otherwise. Use it at every success and expected-failure comparison site in the four runners. Keep explicit `after/` trees wherever the expected output differs from the input.

## Scope / caveats

- A missing `after/` must still perform a full directory assertion against `before/`; it must never mean “skip output checking.”
- Delete only trees confirmed byte-identical by both relative path and file content. Fixture names such as `dry-run`, `noop`, `idempotent`, or `check-discovery` are not sufficient evidence by themselves.
- Preserve `case.json`, expected stdout/error metadata, run-twice behavior, and temporary-worktree setup. This work changes only how the expected filesystem tree is selected.
- Keep explicit changed-output trees even when only one byte or one path differs; the fallback is a no-op convention, not a partial-overlay mechanism.
