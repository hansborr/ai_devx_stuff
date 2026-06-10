# 21 - stale-marker hidden-index guard

Status: Done
Track: C
Size: small
Depends on: none
Blocks: none

## Completion notes (2026-06-04)

- `scripts/drift-ai/coldspots-stale-markers.ts`: blame safety now goes through
  `blameSkipReason()`, which checks `markerFileDirty()` first (the common case) and
  then `markerFileHiddenIndex()` via `git ls-files -v -- <path>`. A `S` tag
  (skip-worktree) or any lowercase tag (assume-unchanged) marks the file unsafe; a
  failed probe is conservatively treated as unsafe, mirroring the existing dirty-probe
  catch. The probe only runs for marker-bearing files and only when ages are otherwise
  available (blobless clones still skip blame wholesale upstream), so the cost gate is
  preserved.
- `BuiltRow.skippedDirtyBlame: boolean` became `blameSkip: "dirty" | "hidden-index" | null`
  so the disclosure can split the counts. `degradations()`/`emptyReason()` gained a
  separate hidden-index note and clause; dirty wording is unchanged.
- No `DriftFinding`/section-shape change — `StaleMarkerSection.degradations` is still a
  `string[]`, so `coldspots-format.ts` and the README needed no edits (the README does
  not enumerate stale-marker degradation reasons).
- Tests: reducer-level fake-git cases for normal/skip-worktree/assume-unchanged/probe
  failure plus a no-probe-on-blobless guard in `coldspots-stale-markers.test.ts`; the
  `coldspots.test.ts` runner fake gained an `ls-files` responder returning `H`.

## Goal

Make the `coldspots --lens stale-markers` blame step degrade when a file has git
hidden-index flags such as `assume-unchanged` or `skip-worktree`.

## Background

The stale-marker lens already avoids trusting blame for dirty worktree files, but
ordinary `git status --porcelain` does not reveal all local divergence. Hidden
index flags can make worktree marker line numbers differ from `HEAD` while status
appears clean.

## Seams to touch

- `scripts/drift-ai/coldspots-stale-markers.ts`
- `scripts/drift-ai/coldspots-blame.ts`, only if the guard belongs near blame
- `scripts/drift-ai/coldspots-stale-markers.test.ts`
- `scripts/drift-ai/coldspots-blame.test.ts`, only if parser/runner seams change
- `scripts/drift-ai/README.md`, only if output/disclosure text changes.

## What to do

1. Before running blame for a stale-marker candidate, check hidden index flags via
   `git ls-files -v -- <path>` or an equivalent injected git runner.
2. Treat `assume-unchanged` and `skip-worktree` paths as unsafe for blame.
3. Preserve existing degradation behavior: unsafe files skip blame and do not
   qualify from marker counts alone.
4. Disclose skipped/age-unknown markers the same way other stale-marker
   degradation is disclosed.
5. Keep the check cheap; only run the extra git probe for files that already
   contain marker comments.

## Testing

- Add fake-git tests for normal files, assume-unchanged, skip-worktree, and git
  probe failure.
- Run focused coldspots stale-marker tests.

## Out of scope

- Rewriting dirty-file detection generally.
- Comparing every scanned file with `HEAD:<path>` unless the simpler flag probe
  is insufficient.
