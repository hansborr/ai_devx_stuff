# Drain: ratchet/core-complexity-drift-ai

Status: Ready for implementation
Date: 2026-05-23
Branch: `fix/drain-complexity-drift-ai` (create from `main`)
Ratchet: `ratchet/core-complexity-drift-ai` in `scripts/lint-ratchet-config.ts`
Baseline: `lint-ratchet.baseline.json` — 9 items, max complexity 21, ceiling 10

## Goal

Reduce all 9 remaining `complexity` findings to ≤ 10 (the ratchet ceiling)
through behavior-preserving refactors — extract same-file helpers, flatten
branching, or use early returns. Do not change observable behavior, output
format, or public API surface. After the drain, update
`lint-ratchet.baseline.json` to reflect the new counts (ideally 0 items).

## Items

Ordered by complexity (highest first). Each item names the function, its
current complexity, the file, and a concrete refactoring strategy.

### 1. `classifyLine` — complexity 21 → target ≤ 10

**File**: `scripts/drift-ai/comments.ts:87`

**What it does**: Character-by-character JS/TS line scanner that tracks
block-comment, line-comment, and string-literal state to classify whether a
line has code, comments, or both.

**Why it's complex**: A single `while` loop with nested `if` chains for each
lexer state (inBlockComment, inLineComment, inString) plus sub-branches for
escape sequences, string delimiters, and comment openers.

**Strategy**: Extract per-state advance helpers (block-comment, string,
code-char classification) so the main `while` loop becomes a flat dispatcher.

### 2. `runDriftAi` — complexity 18 → target ≤ 10

**File**: `scripts/drift-ai.ts:883`

**What it does**: Top-level CLI entrypoint — parses args, prepares the run
(changed vs current), resolves injectable defaults (jscpd, listDirectory,
readFile, suppressionsGit), calls buildReport, formats output, writes files.

**Why it's complex**: Sequential try/catch blocks, a scope-mode ternary, and
~8 conditional spreads for injectable defaults that each add a branch.

**Strategy**: Extract a `resolveRunDependencies(parsed, prepared, options)`
helper that owns all the `options.X ?? defaultX` conditionals. Main function
becomes: parse → prepare → resolve deps → buildReport → format → write.

### 3. `parseSuppressionDiff` — complexity 17 → target ≤ 10

**File**: `scripts/drift-ai/suppressions.ts:109`

**What it does**: Parses a unified diff, tracking file headers, hunk headers,
and added/context/deleted lines to extract suppression directives from added
lines.

**Why it's complex**: A `for` loop over diff lines with sequential
`if/startsWith` checks for diff grammar (`diff --git`, `+++`, `@@`, `+`,
` `, `-`, `\`) plus nested conditions for currentFile and changedPaths
membership.

**Strategy**: Extract line-classification and line-processing into helpers:

- `classifyDiffLine(line, inHunk)` → `{ kind: "file-header" | "new-file" |
  "hunk" | "added" | "context" | "deleted" | "meta" | "other", parsed? }` —
  pure classification, no mutation.
- `processDiffLine(classified, state)` → `{ state, findings? }` — applies
  the classified line to the running parse state (currentFile, inHunk,
  newLine, scanState).

The main loop becomes `classify → process → collect findings`. The
line-classification helper is a chain of early returns (~7 complexity but
very flat). The processing helper handles state transitions (~6 complexity).

### 4. `buildReport` — complexity 16 → target ≤ 10

**File**: `scripts/drift-ai.ts:624`

**What it does**: Iterates enabled checks, builds the `CheckContext` object
for each runner (with ~8 conditional spreads), collects findings, and
assembles the `DriftReport`.

**Why it's complex**: The `CHECK_RUNNERS[check]()` call receives a large
inline object with many `...(x === undefined ? {} : { x })` conditional
spreads, each adding a branch.

**Strategy**: Extract the per-check context assembly:

- `buildCheckContext(detectorScope, context, options)` → returns the fully
  assembled object that currently lives inline in the `for` loop. All the
  conditional spreads move here.

The main function becomes: filter checks → loop calling
`buildCheckContext` + runner → assemble report. Complexity drops to ~5–6.

### 5. `scanCommentSegments` — complexity 15 → target ≤ 10

**File**: `scripts/drift-ai/suppressions.ts:230`

**What it does**: Character-by-character scanner (similar to `classifyLine`)
that splits a source line into `CommentSegment[]` (line-comment and
block-comment text regions) while tracking block-comment and string-literal
state.

**Why it's complex**: Same pattern as `classifyLine` — a `while` loop with
nested `if` chains for block-comment, string, and code states.

**Strategy**: Very similar to item 1. Extract per-state advance helpers:

- `advanceBlockSegment(line, index)` → `{ segment?, newIndex, stillInBlock }`
  — scans for `*/`, returns the block-comment text segment if found.
- `advanceStringLiteral(line, index, delim)` → `{ newIndex, closed }` —
  skips escape sequences and the closing delimiter.

The main loop dispatches by state and calls helpers. Each helper is ≤ 4
complexity.

**Note**: `classifyLine` in `comments.ts` (item 1) and `scanCommentSegments`
in `suppressions.ts` (this item) are structurally near-identical lexer loops.
Do NOT consolidate them into a shared module — that is a separate drift
finding (backlog item) and changes the public API surface. Refactor each
independently with the same helper pattern; the similarity is acceptable.

### 6. `mapChangedFilesToScopes` — complexity 14 → target ≤ 10

**File**: `scripts/drift-ai/duplicates.ts:202`

**What it does**: Groups changed files into duplicate-scan scopes by
determining each file's scan root (configured or inferred), filtering by
status/extension/exclusion.

**Why it's complex**: A `for` loop with three sequential filter guards
(deleted, source-like, excluded) plus a root-resolution step with a fallback
chain, followed by map manipulation.

**Strategy**: Extract the per-file filter + root resolution:

- `resolveDuplicateScope(file, roots, excludeGlobs, supportedExtensions)` →
  `string | undefined` — returns the scope key for a file, or undefined if
  the file should be skipped. Contains the three guards and the
  `configuredRootFor ?? inferScopeRoot` chain.

The main function becomes: loop → resolve → bucket → sort. Complexity drops
to ~4.

### 7. `levenshteinBounded` — complexity 13 → target ≤ 10

**File**: `scripts/drift-ai/ghost-files.ts:155`

**What it does**: Classic bounded Levenshtein distance with early-exit
optimization (skips remaining rows when the minimum edit distance exceeds
the cap).

**Why it's complex**: Nested `for` loops over the DP matrix plus the
early-exit `rowMin` tracking, `?? 0` null coalescing on array accesses, and
the length-difference early return.

**Strategy**: This is an algorithm with inherently nested loops. Two options:

**Option A** (preferred): Extract the inner loop into a helper:
- `computeLevenshteinRow(a, b, i, prev, curr, cap)` → `{ row, rowMin }` —
  fills one row of the DP matrix and returns the minimum value seen. This
  moves the inner `for` loop and its 4–5 branches out of the outer function.

**Option B**: Accept the complexity as algorithmic and add an
`// eslint-disable-next-line complexity` with a reason comment. The function
is a well-known algorithm, tested, and unlikely to grow. This is acceptable
under the project's "type assertion at boundaries" principle — sometimes
the ceiling doesn't fit the code shape.

Recommend trying Option A first. If the extracted helper looks forced or
less readable, fall back to Option B with a suppression.

### 8. `findGhostMatches` — complexity 12 → target ≤ 10

**File**: `scripts/drift-ai/ghost-files.ts:211`

**What it does**: For a given new file, iterates peer paths in the same
directory and classifies each pair as a potential ghost-file match using
token comparison and edit distance.

**Why it's complex**: Early-return guards on the new file (excluded, not
source-like, entry-point stem, empty tokens) plus a `for` loop with similar
guards on each peer, then the `classifyMatch` call.

**Strategy**: Extract the new-file eligibility check:

- `prepareGhostCandidate(filePath, sourceExtensions)` → `{ tokens, strong,
  normalized } | undefined` — returns undefined if the file is excluded, not
  source-like, an entry-point stem, or has no tokens. Returns the
  precomputed token data otherwise.

Apply the same helper to peers inside the loop (it already does the same
checks). The main function becomes: prepare candidate → loop peers →
prepare peer → classifyMatch → collect. Complexity drops to ~5–6.

### 9. `formatText` — complexity 11 → target ≤ 10

**File**: `scripts/drift-ai.ts:712`

**What it does**: Renders a `DriftReport` as human-readable text with a
header (scope-dependent), file count, skipped checks, and per-finding
WARN/FIX lines.

**Why it's complex**: Just barely over the ceiling. The scope-mode branch
for the header, the skipped-checks branch, the zero-findings branch (with
a nested enabled-checks-empty check), and the per-finding hint branch.

**Strategy**: Extract the header rendering:

- `formatTextHeader(report)` → `string[]` — returns the 1–3 header lines
  (scope mode, roots, file count, skipped checks). This moves ~5 branches
  out.

The main function becomes: header + findings loop. Complexity drops to ~4–5.

## Execution Plan

Work on one file at a time. Each file's changes should be a single commit.
Recommended order groups items by file to minimize context switching:

**Commit 1** — `scripts/drift-ai/comments.ts` (item 1)
**Commit 2** — `scripts/drift-ai/suppressions.ts` (items 3, 5)
**Commit 3** — `scripts/drift-ai/duplicates.ts` (item 6)
**Commit 4** — `scripts/drift-ai/ghost-files.ts` (items 7, 8)
**Commit 5** — `scripts/drift-ai.ts` (items 2, 4, 9)

## Constraints

- **Behavior-preserving only.** No changes to output format, CLI arguments,
  public exports, or test expectations (beyond lint config). If a test
  breaks, the refactor changed behavior — fix the refactor, not the test.
- **Same-file helpers.** Extract helpers within the same file. Do not create
  new modules or move functions between files.
- **No shared lexer consolidation.** `classifyLine` and `scanCommentSegments`
  are structurally similar but live in different detectors. Do not merge them.
- **Suppression only as last resort.** Use `eslint-disable-next-line
  complexity` only for `levenshteinBounded` if extraction makes it less
  readable, and only with a `// algorithmic DP — inherently nested` reason.
- **Update the baseline.** After all refactors, run `bun run lint:ratchet`
  and update `lint-ratchet.baseline.json`. The ratchet item count should
  drop from 9 to 0 (or 1 if levenshtein is suppressed).

## Verification

Per-commit: `bun run lint -- --max-warnings=0`, `bun run typecheck`, and
the relevant `scripts/drift-ai*.test.ts` files via Vitest.

Final: `bun run lint:ratchet`, `bun run lint:ratchet:check-baseline`,
`bun run verify:changed`. Spot-check CLI text output against `main` for
both `--scope changed` and `--scope current --check ghost-files`.

## Exit Criteria

- `ratchet/core-complexity-drift-ai` drops to 0 items (or 1 if
  `levenshteinBounded` uses a suppression with reason).
- `lint-ratchet.baseline.json` updated. All existing tests pass unchanged.
- CLI output byte-for-byte identical to `main`.
