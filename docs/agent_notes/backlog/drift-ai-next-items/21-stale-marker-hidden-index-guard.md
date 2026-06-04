# 21 - stale-marker hidden-index guard

Status: Parked
Track: C
Size: small
Depends on: none
Blocks: none

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
