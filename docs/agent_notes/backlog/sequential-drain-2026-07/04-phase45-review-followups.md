# Phase 4/5 review follow-ups

Status: Open leaves (small)
Created: 2026-07-16
Source: 4-model pre-land review of `feat/sd-q45-integration` (grok/codex/opus/fable)
and the confirm-then-fix pass. Context commits: 1e42101b..a73675af.

Low-priority residue that survived the fix pass deliberately.

## 1. Derive the pre-push scan trigger from the scanner's extension source

The `.husky/pre-push` near-duplicates trigger regex and
`BUILT_IN_SOURCE_EXTENSIONS` (`scripts/drift-ai/scope.ts`) are coupled by a
comment only (1e42101b). A future extension added in `scope.ts` (or via
`drift-ai.config.json` `additionalSourceExtensions`) will not propagate to
the hook. Either derive the hook's list from the config/scope source at
generation time, or add a `harness:check` assertion pinning the two in
sync.

## 2. Sibling-worktree note for the non-HEAD push guard

The boundary gate now fails closed when the pushed tip is not the current
HEAD (01312f7e). A repo with the target branch checked out in a sibling
worktree still cannot validate that branch from this worktree — the pusher
must push from the branch's own worktree. Acceptable; add a one-line hint
to the hook message if the pattern recurs in practice.
